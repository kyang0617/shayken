// Unit tests for the pure rules engine. No server needed: build a RoomState, call a rule,
// check the result. Run with `npm test`.

import { describe, expect, it } from "vitest";
import type { CardId, CardInstance } from "../../shared/cards";
import { brewDamage } from "../../shared/brew";
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
		turn: null, winner: null, lastThrow: null, reap: null,
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

describe("brewDamage", () => {
	const brew = (...ids: CardId[]) => ids.map(card);

	it("sums each ingredient's damage", () => {
		expect(brewDamage(brew("fire_salt", "nightshade", "wyrm_bile"))).toBe(2 + 3 + 5);
	});

	it("counts ingredients with no throw effect toward position but adds no damage", () => {
		expect(brewDamage(brew("troll_moss"))).toBe(0);
		expect(brewDamage(brew("troll_moss", "quicksilver", "distillate"))).toBe(3); // 3rd ingredient: +1 x 3
	});

	it("multiplier only doubles what was added before it", () => {
		expect(brewDamage(brew("fire_salt", "nightshade", "philosophers_salt"))).toBe((2 + 3) * 2);
		expect(brewDamage(brew("philosophers_salt", "fire_salt", "nightshade"))).toBe(0 * 2 + 2 + 3);
		expect(brewDamage(brew("fire_salt", "philosophers_salt", "nightshade"))).toBe(2 * 2 + 3);
	});

	it("per-ingredient catalyst is worth more the later it's added", () => {
		expect(brewDamage(brew("distillate", "fire_salt", "fire_salt"))).toBe(1 + 2 + 2);
		expect(brewDamage(brew("fire_salt", "fire_salt", "distillate"))).toBe(2 + 2 + 3);
	});

	it("combines catalysts in order", () => {
		// (2 + 1*2) * 2 = 8  vs  2 * 2 + 1*3 = 7
		expect(brewDamage(brew("fire_salt", "distillate", "philosophers_salt"))).toBe(8);
		expect(brewDamage(brew("fire_salt", "philosophers_salt", "distillate"))).toBe(7);
	});

	it("stacks multiple multipliers", () => {
		expect(brewDamage(brew("fire_salt", "philosophers_salt", "philosophers_salt"))).toBe(2 * 4);
	});

	it("rewards holding: one big throw beats the same cards thrown separately", () => {
		const together = brewDamage(brew("fire_salt", "nightshade", "distillate"));
		const apart = brewDamage(brew("fire_salt")) + brewDamage(brew("nightshade")) + brewDamage(brew("distillate"));
		expect(together).toBeGreaterThan(apart);
	});
});

describe("throwing", () => {
	/** Seat 0 is active with `brewIds` already in the brew; seat 1 has a deck to draw from. */
	function roomWithBrew(brewIds: CardId[]): RoomState {
		const room = roomWithHand(["honey_mead"]);
		room.players[0]!.brew = brewIds.map(card);
		room.players[1]!.deck = Array.from({ length: 10 }, () => card("fire_salt"));
		return room;
	}

	it("deals the brew's damage, empties it into discard, records it, and passes the turn", () => {
		const room = roomWithBrew(["fire_salt", "nightshade"]);
		const thrown = room.players[0]!.brew.map((c) => c.iid);
		expect(endTurn(room, 0, TURN_MS, NOW, true).ok).toBe(true);
		expect(room.players[1]!.health).toBe(STARTING_HEALTH - 5);
		expect(room.players[0]!.brew).toHaveLength(0);
		expect(room.players[0]!.discard.map((c) => c.iid)).toEqual(expect.arrayContaining(thrown));
		expect(room.lastThrow).toMatchObject({ seat: 0, turn: 1, damage: 5 });
		expect(room.lastThrow!.cards.map((c) => c.iid)).toEqual(thrown);
		expect(room.turn!.seat).toBe(1);
	});

	it("ending without throwing holds the brew", () => {
		const room = roomWithBrew(["fire_salt"]);
		endTurn(room, 0, TURN_MS, NOW);
		expect(room.players[0]!.brew).toHaveLength(1);
		expect(room.players[1]!.health).toBe(STARTING_HEALTH);
		expect(room.lastThrow).toBeNull();
	});

	it("rejects throwing an empty brew without ending the turn", () => {
		const room = roomWithBrew([]);
		expect(endTurn(room, 0, TURN_MS, NOW, true)).toMatchObject({ ok: false, code: "EMPTY_BREW" });
		expect(room.turn!.seat).toBe(0);
	});

	it("rejects throwing on the opponent's turn", () => {
		const room = roomWithBrew(["fire_salt"]);
		room.players[1]!.brew = [card("fire_salt")];
		expect(endTurn(room, 1, TURN_MS, NOW, true)).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
		expect(room.players[0]!.health).toBe(STARTING_HEALTH);
	});

	it("reducing the opponent to 0 wins the match, and health doesn't go negative", () => {
		const room = roomWithBrew(["wyrm_bile", "philosophers_salt"]); // 10 damage
		room.players[1]!.health = 7;
		endTurn(room, 0, TURN_MS, NOW, true);
		expect(room.players[1]!.health).toBe(0);
		expect(room).toMatchObject({ status: "finished", winner: 0, turn: null });
	});

	it("a throw that leaves the opponent alive keeps the match going", () => {
		const room = roomWithBrew(["fire_salt"]);
		room.players[1]!.health = 3;
		endTurn(room, 0, TURN_MS, NOW, true);
		expect(room.players[1]!.health).toBe(1);
		expect(room.status).toBe("playing");
	});
});
