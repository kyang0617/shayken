// Unit tests for the pure rules engine. No server needed: build a RoomState, call a rule,
// check the result. Run with `npm test`.

import { describe, expect, it } from "vitest";
import type { CardId, CardInstance } from "../../shared/cards";
import { brewDamage, damageAfterShield, explosionDamage } from "../../shared/brew";
import { DECK_SIZE, STARTER_DECK } from "../../shared/decks";
import { ESSENCE_PER_TURN, HAND_SIZE, SHIELD_STEPS, STARTING_HEALTH } from "../../shared/rules";
import { concede, endTurn, newPlayer, playCard, rematch, startMatch } from "../../src/rules";
import type { RoomState } from "../../src/state";

const TURN_MS = 60_000;
const NOW = 1_000_000;

let nextIid = 0;
const card = (cardId: CardId): CardInstance => ({ iid: `t${nextIid++}`, cardId });
const ids = (cards: CardInstance[]) => cards.map((c) => c.cardId);

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
	/**
	 * Seat 0 is active with `brewIds` already in the brew; seat 1 has a deck to draw from.
	 * Seat 1 starts with no shield so these tests see raw brew damage; "spell shield" covers it.
	 */
	function roomWithBrew(brewIds: CardId[], targetShield = 0): RoomState {
		const room = roomWithHand(["honey_mead"]);
		room.players[0]!.brew = brewIds.map(card);
		room.players[1]!.deck = Array.from({ length: 10 }, () => card("fire_salt"));
		room.players[1]!.shield = targetShield;
		return room;
	}

	it("deals the brew's damage, empties it into discard, records it, and passes the turn", () => {
		const room = roomWithBrew(["fire_salt", "nightshade"]);
		const thrown = room.players[0]!.brew.map((c) => c.iid);
		expect(endTurn(room, 0, TURN_MS, NOW, true).ok).toBe(true);
		expect(room.players[1]!.health).toBe(STARTING_HEALTH - 5);
		expect(room.players[0]!.brew).toHaveLength(0);
		expect(room.players[0]!.discard.map((c) => c.iid)).toEqual(expect.arrayContaining(thrown));
		expect(room.lastThrow).toMatchObject({ seat: 0, turn: 1, damage: 5, blocked: 0 });
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

describe("spell shield", () => {
	/** Seat 0 is active and about to throw `brewIds` at seat 1, who has the starting shield. */
	function throwAt(brewIds: CardId[], shield = SHIELD_STEPS[0]): RoomState {
		const room = roomWithHand([]);
		room.players[0]!.brew = brewIds.map(card);
		room.players[1]!.deck = Array.from({ length: 10 }, () => card("fire_salt"));
		room.players[1]!.shield = shield;
		endTurn(room, 0, TURN_MS, NOW, true);
		return room;
	}

	it("everyone starts on the first step", () => {
		expect(newPlayer("t").shield).toBe(50);
	});

	it("damageAfterShield blocks the percentage and rounds what gets through up", () => {
		expect(damageAfterShield(10, 50)).toBe(5);
		expect(damageAfterShield(5, 50)).toBe(3); // 2.5 -> 3
		expect(damageAfterShield(5, 25)).toBe(4); // 3.75 -> 4
		expect(damageAfterShield(1, 50)).toBe(1); // a hit always deals at least 1
		expect(damageAfterShield(7, 0)).toBe(7);
		expect(damageAfterShield(0, 50)).toBe(0);
	});

	it("each damaging hit is softened by the current step, then drops it: 50% -> 25% -> 0%", () => {
		const first = throwAt(["wyrm_bile", "phoenix_feather"]); // 10 damage
		expect(first.players[1]!.health).toBe(STARTING_HEALTH - 5);
		expect(first.lastThrow).toMatchObject({ damage: 5, blocked: 5 });
		expect(first.players[1]!.shield).toBe(25);

		const second = throwAt(["wyrm_bile", "phoenix_feather"], 25);
		expect(second.players[1]!.health).toBe(STARTING_HEALTH - 8); // 7.5 -> 8
		expect(second.players[1]!.shield).toBe(0);

		const third = throwAt(["wyrm_bile", "phoenix_feather"], 0);
		expect(third.players[1]!.health).toBe(STARTING_HEALTH - 10);
		expect(third.players[1]!.shield).toBe(0); // stays at the last step
	});

	it("a throw that deals no damage doesn't break the shield", () => {
		const room = throwAt(["troll_moss"]); // a free 0-damage ingredient
		expect(room.players[1]!.health).toBe(STARTING_HEALTH);
		expect(room.players[1]!.shield).toBe(50);
	});

	it("only the target's shield changes", () => {
		const room = throwAt(["fire_salt"]);
		expect(room.players[0]!.shield).toBe(50);
	});

	it("a shielded hit can still be lethal", () => {
		const room = roomWithHand([]);
		room.players[0]!.brew = [card("wyrm_bile")]; // 5 -> 3 through a 50% shield
		room.players[1]!.health = 3;
		endTurn(room, 0, TURN_MS, NOW, true);
		expect(room.players[1]!.health).toBe(0);
		expect(room).toMatchObject({ status: "finished", winner: 0 });
	});
});

describe("disruption", () => {
	/**
	 * Seat 0 is active on turn 1 holding `hand`, with plenty of essence; seat 1 has a brew and
	 * essence to hit. Both decks are stocked so turns can pass.
	 */
	function setup(hand: CardId[], oppBrew: CardId[] = []): RoomState {
		const room = roomWithHand(hand, 20, Array.from({ length: 20 }, () => "fire_salt" as CardId));
		const opp = room.players[1]!;
		opp.brew = oppBrew.map(card);
		opp.deck = Array.from({ length: 20 }, () => card("fire_salt"));
		opp.essence = 5;
		return room;
	}
	const playFirst = (room: RoomState) => playCard(room, 0, room.players[0]!.hand[0].iid);

	it("Curdle discards the first ingredient of the opponent's brew into their discard pile", () => {
		const room = setup(["curdle"], ["fire_salt", "nightshade", "philosophers_salt"]);
		expect(playFirst(room)).toEqual({ ok: true });
		expect(ids(room.players[1]!.brew)).toEqual(["nightshade", "philosophers_salt"]);
		expect(ids(room.players[1]!.discard)).toEqual(["fire_salt"]);
	});

	it("disruption with nothing to hit is still playable and does nothing", () => {
		const room = setup(["curdle"]);
		expect(playFirst(room)).toEqual({ ok: true });
		expect(room.players[1]!.discard).toEqual([]);
	});

	it("Sludge Flask adds a Sludge token that subtracts 3 from the running total, never below 0", () => {
		const room = setup(["sludge_flask"], ["wyrm_bile"]);
		playFirst(room);
		const brew = room.players[1]!.brew;
		expect(ids(brew)).toEqual(["wyrm_bile", "sludge"]);
		expect(brewDamage(brew)).toBe(2);
		// Order matters: a ×2 added after the Sludge doubles the reduced total.
		expect(brewDamage([card("wyrm_bile"), card("sludge"), card("philosophers_salt")])).toBe(4);
		expect(brewDamage([card("sludge"), card("fire_salt")])).toBe(2); // 0 - 3 -> 0, + 2
	});

	it("token iids are unique across the match", () => {
		const room = setup(["sludge_flask", "sludge_flask"]);
		playFirst(room);
		playFirst(room);
		const [a, b] = room.players[1]!.brew;
		expect(a.iid).not.toBe(b.iid);
	});

	it("tokens vanish instead of going to the discard pile, whether thrown or curdled", () => {
		const room = setup([]);
		room.turn!.seat = 1;
		room.players[1]!.brew = [card("sludge"), card("wyrm_bile")];
		endTurn(room, 1, TURN_MS, NOW, true);
		expect(ids(room.players[1]!.discard)).toEqual(["wyrm_bile"]);

		const curdled = setup(["curdle"], ["sludge"]);
		playFirst(curdled);
		expect(curdled.players[1]!.brew).toEqual([]);
		expect(curdled.players[1]!.discard).toEqual([]);
	});

	it("Siphon drains 2 essence, never below 0", () => {
		const room = setup(["siphon", "siphon", "siphon"]);
		playFirst(room);
		expect(room.players[1]!.essence).toBe(3);
		playFirst(room);
		playFirst(room);
		expect(room.players[1]!.essence).toBe(0);
	});

	it("Bitter Draught raises the opponent's costs by 2 for their next turn only", () => {
		const room = setup(["bitter_draught"]);
		playFirst(room);
		endTurn(room, 0, TURN_MS, NOW);
		const opp = room.players[1]!;
		expect(opp.hexes!.costUp).toBe(2);
		opp.hand = [card("nightshade")]; // costs 2 -> 4
		opp.essence = 3;
		expect(playCard(room, 1, opp.hand[0].iid)).toMatchObject({ ok: false, code: "NOT_ENOUGH_ESSENCE" });
		opp.essence = 4;
		expect(playCard(room, 1, opp.hand[0].iid)).toEqual({ ok: true });
		expect(opp.essence).toBe(0);
		endTurn(room, 1, TURN_MS, NOW);
		expect(opp.hexes).toEqual({ costUp: 0, drawLimit: null, sealed: false });
	});

	it("a hex never affects the caster or the turn it was played in", () => {
		const room = setup(["bitter_draught", "nightshade"]);
		playFirst(room);
		const before = room.players[0]!.essence;
		playFirst(room);
		expect(room.players[0]!.essence).toBe(before - 2);
		expect(room.players[1]!.hexes!.costUp).toBe(0); // queued, not active yet
		expect(room.players[1]!.nextHexes!.costUp).toBe(2);
	});

	it("Fog limits the opponent's next draw to 2 cards", () => {
		const room = setup(["fog"]);
		playFirst(room);
		endTurn(room, 0, TURN_MS, NOW);
		expect(room.players[1]!.hand).toHaveLength(2);
	});

	it("Seal stops the opponent throwing on their next turn, but they can still hold", () => {
		const room = setup(["seal"], ["wyrm_bile"]);
		playFirst(room);
		endTurn(room, 0, TURN_MS, NOW);
		expect(endTurn(room, 1, TURN_MS, NOW, true)).toMatchObject({ ok: false, code: "THROW_SEALED" });
		expect(room.players[1]!.brew).toHaveLength(1);
		expect(endTurn(room, 1, TURN_MS, NOW)).toEqual({ ok: true });
		expect(room.players[1]!.hexes!.sealed).toBe(false);
	});

	it("Choking Smoke deals its damage when thrown and hexes the opponent's next turn", () => {
		const room = setup([]);
		room.players[0]!.brew = [card("choking_smoke")];
		room.players[1]!.shield = 0;
		endTurn(room, 0, TURN_MS, NOW, true);
		expect(room.players[1]!.health).toBe(STARTING_HEALTH - 3);
		expect(room.players[1]!.hexes!.costUp).toBe(1); // their turn has started
	});
});

describe("volatile brews", () => {
	/** Seat 0 plays Unstable Fumes on turn 1 at seat 1, whose brew is `oppBrew`. */
	function fumed(oppBrew: CardId[]): RoomState {
		const room = roomWithHand(["unstable_fumes"], 5, Array.from({ length: 20 }, () => "fire_salt" as CardId));
		const opp = room.players[1]!;
		opp.brew = oppBrew.map(card);
		opp.deck = Array.from({ length: 20 }, () => card("fire_salt"));
		playCard(room, 0, room.players[0]!.hand[0].iid);
		return room;
	}

	it("explosionDamage is half the brew's throw damage, rounded up", () => {
		expect(explosionDamage([card("wyrm_bile")])).toBe(3); // 5 / 2 -> 3
		expect(explosionDamage([card("wyrm_bile"), card("phoenix_feather"), card("philosophers_salt")])).toBe(10);
		expect(explosionDamage([])).toBe(0);
	});

	it("the fuse runs out at the start of the target's turn after next", () => {
		const room = fumed(["wyrm_bile", "phoenix_feather"]); // 10 damage
		expect(room.players[1]!.explodesOnTurn).toBe(4);
		endTurn(room, 0, TURN_MS, NOW); // turn 2: seat 1 holds
		endTurn(room, 1, TURN_MS, NOW);
		expect(room.players[1]!.brew).toHaveLength(2); // turn 3: still there
		endTurn(room, 0, TURN_MS, NOW); // turn 4 starts: boom
		const opp = room.players[1]!;
		expect(opp.health).toBe(STARTING_HEALTH - 5); // half of 10; the 50% shield doesn't apply
		expect(opp.shield).toBe(50); // and doesn't break
		expect(opp.brew).toEqual([]);
		expect(ids(opp.discard)).toContain("wyrm_bile");
		expect(opp.explodesOnTurn).toBe(null);
		expect(room.lastExplosion).toMatchObject({ seat: 1, turn: 4, damage: 5 });
		expect(room.turn).toMatchObject({ seat: 1, number: 4 });
	});

	it("throwing on the next turn defuses it", () => {
		const room = fumed(["wyrm_bile"]);
		endTurn(room, 0, TURN_MS, NOW);
		endTurn(room, 1, TURN_MS, NOW, true);
		expect(room.players[1]!.explodesOnTurn).toBe(null);
		room.players[1]!.brew = [card("fire_salt")]; // a new brew is stable
		endTurn(room, 0, TURN_MS, NOW);
		expect(room.lastExplosion).toBeUndefined();
	});

	it("fizzles on an empty cauldron", () => {
		const room = fumed([]);
		expect(room.players[1]!.explodesOnTurn).toBe(null);
		room.players[1]!.brew = [card("wyrm_bile")]; // what goes in later is stable
		endTurn(room, 0, TURN_MS, NOW);
		endTurn(room, 1, TURN_MS, NOW);
		endTurn(room, 0, TURN_MS, NOW);
		expect(room.lastExplosion).toBeUndefined();
		expect(room.players[1]!.health).toBe(STARTING_HEALTH);
	});

	it("the fuse goes out when Curdle empties the cauldron", () => {
		const room = fumed(["wyrm_bile"]);
		room.players[0]!.hand.push(card("curdle"));
		playCard(room, 0, room.players[0]!.hand[0].iid);
		expect(room.players[1]!.brew).toEqual([]);
		expect(room.players[1]!.explodesOnTurn).toBe(null);
	});

	it("the fuse keeps burning when Curdle leaves ingredients", () => {
		const room = fumed(["wyrm_bile", "fire_salt"]);
		room.players[0]!.hand.push(card("curdle"));
		playCard(room, 0, room.players[0]!.hand[0].iid);
		expect(room.players[1]!.brew).toHaveLength(1);
		expect(room.players[1]!.explodesOnTurn).toBe(4);
	});

	it("a lethal explosion ends the match in the other player's favour", () => {
		const room = fumed(["wyrm_bile"]);
		room.players[1]!.health = 2;
		endTurn(room, 0, TURN_MS, NOW);
		endTurn(room, 1, TURN_MS, NOW);
		endTurn(room, 0, TURN_MS, NOW);
		expect(room).toMatchObject({ status: "finished", winner: 0, turn: null });
		expect(room.players[1]!.health).toBe(0);
	});

});

describe("rematch", () => {
	/** A finished match: seat 1 conceded on turn 1, with some state left over. */
	function finished(): RoomState {
		const room = roomWithHand(["wyrm_bile"]);
		playCard(room, 0, room.players[0]!.hand[0].iid);
		room.players[1]!.health = 7;
		concede(room, 1);
		room.expiresAt = NOW + 1000;
		return room;
	}

	it("is only allowed once the match is over", () => {
		const room = roomWithHand(["fire_salt"]);
		expect(rematch(room, 0, TURN_MS, NOW)).toMatchObject({ ok: false, code: "NOT_FINISHED" });
		expect(rematch(newRoom(), 0, TURN_MS, NOW)).toMatchObject({ ok: false, code: "NOT_FINISHED" });
	});

	it("one vote waits for the other player", () => {
		const room = finished();
		expect(rematch(room, 0, TURN_MS, NOW).ok).toBe(true);
		expect(rematch(room, 0, TURN_MS, NOW).ok).toBe(true); // asking twice is harmless
		expect(room.rematchVotes).toEqual([true, false]);
		expect(room.status).toBe("finished");
	});

	it("both votes start a fresh match with the same seats and tokens", () => {
		const room = finished();
		rematch(room, 1, TURN_MS, NOW);
		rematch(room, 0, TURN_MS, NOW);
		expect(room).toMatchObject({ status: "playing", winner: null, lastThrow: null, lastExplosion: null, rematchVotes: [false, false] });
		expect(room.expiresAt).toBeUndefined();
		expect(room.turn).toMatchObject({ number: 1, endsAt: NOW + TURN_MS });
		expect(room.players.map((p) => p!.token)).toEqual(["tok0", "tok1"]);
		for (const p of room.players) {
			expect(p!.health).toBe(STARTING_HEALTH);
			expect(p!.shield).toBe(SHIELD_STEPS[0]);
			expect(p!.brew).toEqual([]);
			expect(p!.hand.length + p!.deck.length).toBe(DECK_SIZE);
		}
		const active = room.players[room.turn!.seat]!;
		expect(active.hand).toHaveLength(HAND_SIZE);
		expect(active.essence).toBe(ESSENCE_PER_TURN);
	});
});
