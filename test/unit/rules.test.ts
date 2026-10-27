// Unit tests for the pure rules engine. No server needed: build a RoomState, call a rule,
// check the result. Run with `npm test`.

import { describe, expect, it } from "vitest";
import type { CardId, CardInstance } from "../../shared/cards";
import { DECK_SIZE, STARTER_DECK } from "../../shared/decks";
import { ESSENCE_PER_TURN, HAND_SIZE, STARTING_HEALTH } from "../../shared/rules";
import { concede, endTurn, newPlayer, playCard, startMatch } from "../../src/rules";
import type { RoomState } from "../../src/state";

const TURN_MS = 60_000;
const NOW = 1_000_000;

let nextIid = 0;
const card = (cardId: CardId): CardInstance => ({ iid: `t${nextIid++}`, cardId });

function newRoom(): RoomState {
	return {
		code: "TEST01", createdAt: 0, status: "waiting",
		players: [newPlayer("tok0"), newPlayer("tok1")],
		turn: null, winner: null, reap: null,
	};
}

/** A room mid-match where seat 0 is active with a chosen hand and essence. */
function roomWithHand(hand: CardId[], essence = 3, deck: CardId[] = []): RoomState {
	const room = newRoom();
	room.status = "playing";
	room.turn = { seat: 0, number: 1, endsAt: NOW + TURN_MS };
	const p = room.players[0]!;
	p.hand = hand.map(card);
	p.deck = deck.map(card);
	p.essence = essence;
	return room;
}

describe("starter deck", () => {
	it(`has ${DECK_SIZE} cards`, () => expect(STARTER_DECK).toHaveLength(DECK_SIZE));
});

describe("startMatch", () => {
	it("starts turn 1 for one player with a full hand and starting essence", () => {
		const room = newRoom();
		startMatch(room, TURN_MS, NOW);
		expect(room.status).toBe("playing");
		const active = room.turn!.seat;
		const a = room.players[active]!;
		const b = room.players[active === 0 ? 1 : 0]!;
		expect(room.turn).toEqual({ seat: active, number: 1, endsAt: NOW + TURN_MS });
		expect(a.hand).toHaveLength(HAND_SIZE);
		expect(a.deck).toHaveLength(DECK_SIZE - HAND_SIZE);
		expect(a.essence).toBe(ESSENCE_PER_TURN);
		expect(b.hand).toHaveLength(0);
		expect(b.deck).toHaveLength(DECK_SIZE);
		expect(a.health).toBe(STARTING_HEALTH);
	});

	it("picks both seats as first player over many matches", () => {
		const firsts = new Set(Array.from({ length: 50 }, () => {
			const room = newRoom();
			startMatch(room, TURN_MS, NOW);
			return room.turn!.seat;
		}));
		expect(firsts).toEqual(new Set([0, 1]));
	});
});

describe("playCard legality", () => {
	it("rejects the inactive player", () => {
		const room = roomWithHand(["fire_salt"]);
		room.players[1]!.hand = [card("fire_salt")];
		expect(playCard(room, 1, room.players[1]!.hand[0].iid)).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
	});

	it("rejects a card that isn't in your hand (e.g. the opponent's)", () => {
		const room = roomWithHand(["fire_salt"]);
		room.players[1]!.hand = [card("fire_salt")];
		expect(playCard(room, 0, room.players[1]!.hand[0].iid)).toMatchObject({ ok: false, code: "CARD_NOT_IN_HAND" });
		expect(playCard(room, 0, "made-up")).toMatchObject({ ok: false, code: "CARD_NOT_IN_HAND" });
	});

	it("rejects playing the same card twice", () => {
		const room = roomWithHand(["fire_salt"]);
		const iid = room.players[0]!.hand[0].iid;
		expect(playCard(room, 0, iid).ok).toBe(true);
		expect(playCard(room, 0, iid)).toMatchObject({ ok: false, code: "CARD_NOT_IN_HAND" });
	});

	it("rejects a card you can't afford, without changing state", () => {
		const room = roomWithHand(["wyrm_bile"], 2);
		const before = structuredClone(room);
		expect(playCard(room, 0, room.players[0]!.hand[0].iid)).toMatchObject({ ok: false, code: "NOT_ENOUGH_ESSENCE" });
		expect(room).toEqual(before);
	});

	it("rejects actions when the match isn't running", () => {
		const room = newRoom();
		expect(playCard(room, 0, "x")).toMatchObject({ ok: false, code: "NOT_PLAYING" });
		expect(endTurn(room, 0, TURN_MS, NOW)).toMatchObject({ ok: false, code: "NOT_PLAYING" });
		expect(concede(room, 0)).toMatchObject({ ok: false, code: "NOT_PLAYING" });
	});
});

describe("playCard effects", () => {
	it("attack: pays cost and goes into the brew", () => {
		const room = roomWithHand(["nightshade"], 3);
		const p = room.players[0]!;
		const iid = p.hand[0].iid;
		playCard(room, 0, iid);
		expect(p.essence).toBe(1);
		expect(p.hand).toHaveLength(0);
		expect(p.brew.map((c) => c.iid)).toEqual([iid]);
		expect(p.discard).toHaveLength(0);
	});

	it("skill: resolves immediately and is discarded", () => {
		const room = roomWithHand(["moonwater"], 1);
		const p = room.players[0]!;
		playCard(room, 0, p.hand[0].iid);
		expect(p.essence).toBe(2); // 1 - 1 + 2
		expect(p.discard).toHaveLength(1);
		expect(p.brew).toHaveLength(0);
	});

	it("skill with addToBrew: both gives essence and goes into the brew", () => {
		const room = roomWithHand(["quicksilver"], 1);
		const p = room.players[0]!;
		playCard(room, 0, p.hand[0].iid);
		expect(p.essence).toBe(1);
		expect(p.brew).toHaveLength(1);
		expect(p.discard).toHaveLength(0);
	});

	it("draw: takes from the top of the deck", () => {
		const room = roomWithHand(["honey_mead"], 1, ["fire_salt", "moonwater", "nightshade"]);
		const p = room.players[0]!;
		const top2 = p.deck.slice(0, 2).map((c) => c.iid);
		playCard(room, 0, p.hand[0].iid);
		expect(p.hand.map((c) => c.iid)).toEqual(top2);
		expect(p.deck).toHaveLength(1);
	});

	it("draw: reshuffles the discard pile when the deck is empty, but not the card being played", () => {
		const room = roomWithHand(["honey_mead"], 1);
		const p = room.players[0]!;
		p.discard = [card("fire_salt"), card("frost_lichen")];
		const honey = p.hand[0].iid;
		playCard(room, 0, honey);
		expect(p.hand.map((c) => c.cardId).sort()).toEqual(["fire_salt", "frost_lichen"]);
		expect(p.discard.map((c) => c.iid)).toEqual([honey]);
	});

	it("draw: stops quietly when deck and discard are both empty", () => {
		const room = roomWithHand(["honey_mead"], 1);
		playCard(room, 0, room.players[0]!.hand[0].iid);
		expect(room.players[0]!.hand).toHaveLength(0);
	});

	it("power: goes to powers and applies at the start of later turns", () => {
		const room = roomWithHand(["starlight_dust", "mandrake_root"], 5);
		room.players[0]!.deck = Array.from({ length: 12 }, () => card("fire_salt"));
		room.players[1]!.deck = Array.from({ length: 12 }, () => card("fire_salt"));
		const p = room.players[0]!;
		playCard(room, 0, p.hand[0].iid);
		playCard(room, 0, p.hand[0].iid);
		expect(p.powers).toHaveLength(2);
		expect(p.essence).toBe(0);

		endTurn(room, 0, TURN_MS, NOW);
		endTurn(room, 1, TURN_MS, NOW);
		expect(p.essence).toBe(ESSENCE_PER_TURN + 1);
		expect(p.hand).toHaveLength(HAND_SIZE + 1);
	});
});

describe("endTurn", () => {
	it("discards the hand, keeps essence, and starts the opponent's turn", () => {
		const room = roomWithHand(["fire_salt", "nightshade"], 5);
		room.players[1]!.deck = Array.from({ length: 10 }, () => card("fire_salt"));
		const p = room.players[0]!;
		playCard(room, 0, p.hand[0].iid); // essence 5 -> 4

		const later = NOW + 10_000;
		expect(endTurn(room, 0, TURN_MS, later).ok).toBe(true);
		expect(p.hand).toHaveLength(0);
		expect(p.discard).toHaveLength(1);
		expect(p.essence).toBe(4);
		expect(room.turn).toEqual({ seat: 1, number: 2, endsAt: later + TURN_MS });
		expect(room.players[1]!.hand).toHaveLength(HAND_SIZE);
		expect(room.players[1]!.essence).toBe(ESSENCE_PER_TURN);
	});

	it("rejects ending the opponent's turn", () => {
		const room = roomWithHand([]);
		expect(endTurn(room, 1, TURN_MS, NOW)).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
	});

	it("essence accumulates across turns", () => {
		const room = roomWithHand([], 0);
		room.players[0]!.essence = 0;
		endTurn(room, 0, TURN_MS, NOW);
		endTurn(room, 1, TURN_MS, NOW);
		endTurn(room, 0, TURN_MS, NOW);
		endTurn(room, 1, TURN_MS, NOW);
		expect(room.players[0]!.essence).toBe(ESSENCE_PER_TURN * 2);
	});
});

describe("concede", () => {
	it("ends the match with the other player as winner, on either player's turn", () => {
		const room = roomWithHand([]);
		expect(concede(room, 1).ok).toBe(true);
		expect(room).toMatchObject({ status: "finished", winner: 0, turn: null });
		expect(playCard(room, 0, "x")).toMatchObject({ ok: false, code: "NOT_PLAYING" });
	});
});
