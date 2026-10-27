// The rules engine: pure functions that change RoomState. No I/O, no sockets, no storage —
// the GameRoom calls these, then saves and broadcasts. Keeping them pure is what lets
// test/unit/rules.test.ts check the rules without running a server.
//
// Every action re-checks legality itself. Never assume the client only sends legal moves.

import { brewDamage } from "../shared/brew";
import { CARDS, type CardDef, type CardInstance, type Effect } from "../shared/cards";
import { STARTER_DECK } from "../shared/decks";
import type { ErrorCode, Seat } from "../shared/protocol";
import { ESSENCE_PER_TURN, HAND_SIZE, STARTING_HEALTH } from "../shared/rules";
import { randomInt, shuffle } from "./random";
import type { PlayerState, RoomState } from "./state";

export type ActionResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

const OK: ActionResult = { ok: true };
const fail = (code: ErrorCode, message: string): ActionResult => ({ ok: false, code, message });

export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function newPlayer(token: string): PlayerState {
	return { token, health: STARTING_HEALTH, essence: 0, deck: [], hand: [], discard: [], brew: [], powers: [] };
}

/** Both seats are filled: shuffle each deck, flip for who goes first, start turn 1. */
export function startMatch(room: RoomState, turnMs: number, now: number): void {
	for (const [seat, player] of room.players.entries()) {
		const deck = STARTER_DECK.map((cardId, i): CardInstance => ({ iid: `p${seat}-${i}`, cardId }));
		player!.deck = shuffle(deck);
	}
	room.status = "playing";
	startTurn(room, randomInt(2) as Seat, 1, turnMs, now);
}

export function playCard(room: RoomState, seat: Seat, iid: string): ActionResult {
	const notActive = checkActive(room, seat);
	if (notActive) return notActive;
	const player = room.players[seat]!;

	// Look the card up in *this player's* hand. An iid from the opponent's brew, a made-up
	// iid, or a card already played all fail here.
	const index = player.hand.findIndex((c) => c.iid === iid);
	if (index === -1) return fail("CARD_NOT_IN_HAND", "That card is not in your hand");
	const card = player.hand[index];
	const def: CardDef = CARDS[card.cardId];
	if (player.essence < def.cost) return fail("NOT_ENOUGH_ESSENCE", `${def.name} costs ${def.cost} essence`);

	player.hand.splice(index, 1);
	player.essence -= def.cost;

	for (const effect of def.effects) resolve(player, effect);

	// Place the card after resolving, so a "draw" that reshuffles the discard pile can't
	// draw this same card straight back.
	if (def.effects.some((e) => e.kind === "addToBrew")) player.brew.push(card);
	else if (def.type === "power") player.powers.push(card);
	else player.discard.push(card);
	return OK;
}

/**
 * End `seat`'s turn, optionally throwing their brew first. A turn that times out ends with
 * throwBrew = false: the brew is held, because a timeout shouldn't make the choice for you.
 */
export function endTurn(room: RoomState, seat: Seat, turnMs: number, now: number, throwBrew = false): ActionResult {
	const notActive = checkActive(room, seat);
	if (notActive) return notActive;
	const player = room.players[seat]!;

	if (throwBrew) {
		if (player.brew.length === 0) return fail("EMPTY_BREW", "Your brew is empty");
		const damage = brewDamage(player.brew);
		const target = room.players[otherSeat(seat)]!;
		target.health = Math.max(0, target.health - damage);
		room.lastThrow = { seat, turn: room.turn!.number, cards: player.brew, damage };
		// Thrown ingredients go to the discard pile, so they come back when the deck reshuffles.
		player.discard.push(...player.brew);
		player.brew = [];
		if (target.health === 0) {
			finish(room, seat);
			return OK;
		}
	}

	// Unplayed cards are discarded; essence carries over.
	player.discard.push(...player.hand);
	player.hand = [];
	startTurn(room, otherSeat(seat), room.turn!.number + 1, turnMs, now);
	return OK;
}

export function concede(room: RoomState, seat: Seat): ActionResult {
	if (room.status !== "playing") return fail("NOT_PLAYING", "The match is not in progress");
	finish(room, otherSeat(seat));
	return OK;
}

// ---- Internals ----

function finish(room: RoomState, winner: Seat): void {
	room.status = "finished";
	room.winner = winner;
	room.turn = null;
}

function startTurn(room: RoomState, seat: Seat, number: number, turnMs: number, now: number): void {
	const player = room.players[seat]!;
	player.essence += ESSENCE_PER_TURN + fromPowers(player, "essencePerTurn");
	draw(player, HAND_SIZE + fromPowers(player, "drawPerTurn"));
	room.turn = { seat, number, endsAt: now + turnMs };
}

/** Returns an error result if `seat` may not act right now, otherwise null. */
function checkActive(room: RoomState, seat: Seat): ActionResult | null {
	if (room.status !== "playing" || !room.turn) return fail("NOT_PLAYING", "The match is not in progress");
	if (room.turn.seat !== seat) return fail("NOT_YOUR_TURN", "It is not your turn");
	return null;
}

/** On-play effects. Per-turn effects are passive and read by `fromPowers` at turn start. */
function resolve(player: PlayerState, effect: Effect): void {
	switch (effect.kind) {
		case "gainEssence":
			player.essence += effect.amount;
			break;
		case "draw":
			draw(player, effect.amount);
			break;
		case "addToBrew": // handled when the card is placed
		case "essencePerTurn":
		case "drawPerTurn":
			break;
	}
}

/** Draw from the top; when the deck runs out, shuffle the discard pile in as the new deck. */
function draw(player: PlayerState, count: number): void {
	for (let i = 0; i < count; i++) {
		if (player.deck.length === 0) {
			if (player.discard.length === 0) return; // everything is in hand, brew or powers
			player.deck = shuffle(player.discard);
			player.discard = [];
		}
		player.hand.push(player.deck.shift()!);
	}
}

/** Sum of a per-turn effect across the player's active powers. */
function fromPowers(player: PlayerState, kind: "essencePerTurn" | "drawPerTurn"): number {
	let total = 0;
	for (const card of player.powers) {
		const def: CardDef = CARDS[card.cardId];
		for (const effect of def.effects) if (effect.kind === kind) total += effect.amount;
	}
	return total;
}
