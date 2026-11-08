// The rules engine: pure functions that change RoomState. No I/O, no sockets, no storage —
// the GameRoom calls these, then saves and broadcasts. Keeping them pure is what lets
// test/unit/rules.test.ts check the rules without running a server.
//
// Every action re-checks legality itself. Never assume the client only sends legal moves.

import { brewDamage, damageAfterShield, explosionDamage } from "../shared/brew";
import { CARDS, type CardDef, type CardInstance, type Disruption, type Effect, type ThrowEffect } from "../shared/cards";
import { STARTER_DECK } from "../shared/decks";
import type { ErrorCode, Hexes, Seat } from "../shared/protocol";
import { ESSENCE_PER_TURN, HAND_SIZE, SHIELD_STEPS, STARTING_HEALTH, VOLATILE_FUSE_TURNS } from "../shared/rules";
import { randomInt, shuffle } from "./random";
import type { PlayerState, RoomState } from "./state";

export type ActionResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

const OK: ActionResult = { ok: true };
const fail = (code: ErrorCode, message: string): ActionResult => ({ ok: false, code, message });

export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export const noHexes = (): Hexes => ({ costUp: 0, drawLimit: null, sealed: false });

export function newPlayer(token: string): PlayerState {
	return {
		token, health: STARTING_HEALTH, essence: 0, shield: SHIELD_STEPS[0], deck: [], hand: [], discard: [], brew: [], powers: [],
		nextHexes: noHexes(), hexes: noHexes(), explodesOnTurn: null,
	};
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
	// A cost hex (Bitter Draught) raises the price of every card this turn.
	const cost = def.cost + (player.hexes?.costUp ?? 0);
	if (player.essence < cost) return fail("NOT_ENOUGH_ESSENCE", `${def.name} costs ${cost} essence`);

	player.hand.splice(index, 1);
	player.essence -= cost;
	room.lastPlay = { seat, turn: room.turn!.number, card };

	for (const effect of def.effects) resolve(room, seat, effect);

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
		if (player.hexes?.sealed) return fail("THROW_SEALED", "Your cauldron is sealed this turn");
		const raw = brewDamage(player.brew);
		const target = room.players[otherSeat(seat)]!;
		// The shield in place when the throw lands softens it, *then* drops a step: first hit
		// halved, second quartered, third full. Only a damaging throw breaks a step, or a free
		// 0-damage brew could strip shields. (`?? 0`: rooms saved before shields existed.)
		const shield = target.shield ?? 0;
		const damage = damageAfterShield(raw, shield);
		if (raw > 0) target.shield = nextShieldStep(shield);
		target.health = Math.max(0, target.health - damage);
		room.lastThrow = { seat, turn: room.turn!.number, cards: player.brew, damage, blocked: raw - damage };
		if (target.health === 0) {
			emptyBrew(player);
			finish(room, seat);
			return OK;
		}
		// Ingredients' disruption riders (Choking Smoke) land after the damage. Collected first
		// because some of them change the opponent's brew, never the thrower's.
		const riders = player.brew.flatMap((c) => (CARDS[c.cardId] as CardDef).onThrow ?? []);
		emptyBrew(player);
		for (const effect of riders) resolve(room, seat, effect);
	}

	// Unplayed cards are discarded; essence carries over. Hexes on this turn are used up.
	player.discard.push(...player.hand);
	player.hand = [];
	player.hexes = noHexes();
	startTurn(room, otherSeat(seat), room.turn!.number + 1, turnMs, now);
	return OK;
}

export function concede(room: RoomState, seat: Seat): ActionResult {
	if (room.status !== "playing") return fail("NOT_PLAYING", "The match is not in progress");
	finish(room, otherSeat(seat));
	return OK;
}

// ---- Internals ----

/** The next shield step down; stays at the last step (no shield) once there. */
function nextShieldStep(shield: number): number {
	return SHIELD_STEPS[SHIELD_STEPS.indexOf(shield) + 1] ?? SHIELD_STEPS[SHIELD_STEPS.length - 1];
}

function finish(room: RoomState, winner: Seat): void {
	room.status = "finished";
	room.winner = winner;
	room.turn = null;
}

function startTurn(room: RoomState, seat: Seat, number: number, turnMs: number, now: number): void {
	const player = room.players[seat]!;
	room.turn = { seat, number, endsAt: now + turnMs };
	// The hexes the opponent queued up now apply, for this turn only.
	player.hexes = player.nextHexes ?? noHexes();
	player.nextHexes = noHexes();
	if (explode(room, seat)) return; // the explosion knocked them out
	player.essence += ESSENCE_PER_TURN + fromPowers(player, "essencePerTurn");
	const count = HAND_SIZE + fromPowers(player, "drawPerTurn");
	draw(player, Math.min(count, player.hexes.drawLimit ?? count));
}

/**
 * If `seat`'s brew is Volatile and its fuse has run out, it explodes: they take part of its
 * damage (shields don't help) and the brew is gone. Returns true if that ended the match.
 */
function explode(room: RoomState, seat: Seat): boolean {
	const player = room.players[seat]!;
	const at = player.explodesOnTurn ?? null;
	if (at === null || room.turn!.number < at) return false;
	player.explodesOnTurn = null;
	if (player.brew.length === 0) return false; // nothing left in the cauldron to blow up
	const damage = explosionDamage(player.brew);
	player.health = Math.max(0, player.health - damage);
	room.lastExplosion = { seat, turn: room.turn!.number, cards: player.brew, damage };
	emptyBrew(player);
	if (player.health > 0) return false;
	finish(room, otherSeat(seat));
	return true;
}

/** The brew leaves the cauldron: real cards to the discard pile, tokens out of the game. */
function emptyBrew(player: PlayerState): void {
	player.discard.push(...player.brew.filter((c) => !(CARDS[c.cardId] as CardDef).token));
	player.brew = [];
	player.explodesOnTurn = null; // a new brew starts out stable
}

/** Returns an error result if `seat` may not act right now, otherwise null. */
function checkActive(room: RoomState, seat: Seat): ActionResult | null {
	if (room.status !== "playing" || !room.turn) return fail("NOT_PLAYING", "The match is not in progress");
	if (room.turn.seat !== seat) return fail("NOT_YOUR_TURN", "It is not your turn");
	return null;
}

/**
 * Effects of a card played (or a brew thrown) by `seat`. Per-turn effects are passive and read
 * by `fromPowers` at turn start; damage is brewDamage's job.
 */
function resolve(room: RoomState, seat: Seat, effect: Effect | ThrowEffect): void {
	const player = room.players[seat]!;
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
		case "damage":
		case "damagePerIngredient":
		case "multiplyDamage":
			break;
		default:
			disrupt(room, otherSeat(seat), effect);
	}
}

/** A disruption effect landing on `targetSeat`. Each one does nothing if there's nothing to hit. */
function disrupt(room: RoomState, targetSeat: Seat, effect: Disruption): void {
	const target = room.players[targetSeat]!;
	const hexes = (target.nextHexes ??= noHexes());
	switch (effect.kind) {
		case "removeOpponentIngredient": {
			const removed = effect.position === "first" ? target.brew.shift() : target.brew.pop();
			if (removed && !(CARDS[removed.cardId] as CardDef).token) target.discard.push(removed);
			if (target.brew.length === 0) target.explodesOnTurn = null; // nothing left to blow up
			break;
		}
		case "addToOpponentBrew":
			room.tokensMade = (room.tokensMade ?? 0) + 1;
			target.brew.push({ iid: `token-${room.tokensMade}`, cardId: effect.token });
			break;
		case "drainEssence":
			target.essence = Math.max(0, target.essence - effect.amount);
			break;
		case "destabilizeBrew": {
			// Counted from now: the target gets their next turn to throw, then it goes off. A
			// second dose doesn't reset an already-burning fuse. An empty cauldron can't be made
			// Volatile: it fizzles, rather than leaving a hidden fuse for whatever goes in next.
			if (target.brew.length === 0) break;
			const at = room.turn!.number + VOLATILE_FUSE_TURNS;
			target.explodesOnTurn = Math.min(target.explodesOnTurn ?? at, at);
			break;
		}
		case "hexCost":
			hexes.costUp += effect.amount;
			break;
		case "hexDraw":
			hexes.drawLimit = Math.min(hexes.drawLimit ?? effect.limit, effect.limit);
			break;
		case "hexSeal":
			hexes.sealed = true;
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
