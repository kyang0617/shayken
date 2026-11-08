// The full, secret state of one match. Only the GameRoom ever sees all of it; clients get a
// filtered PlayerView (see viewFor in game-room.ts).

import type { CardInstance } from "../shared/cards";
import type { ExplosionRecord, Hexes, PlayRecord, Seat, ThrowRecord } from "../shared/protocol";

export interface PlayerState {
	token: string;
	health: number;
	essence: number;
	shield: number; // percent of throw damage blocked; one of SHIELD_STEPS
	deck: CardInstance[]; // index 0 is the top; order is hidden from everyone
	hand: CardInstance[];
	discard: CardInstance[];
	brew: CardInstance[]; // ingredients waiting to be thrown; emptied into discard on throw
	powers: CardInstance[]; // active for the rest of the match
	// Hexes are put on you by the opponent for your *next* turn (`nextHexes`). When that turn
	// starts they move to `hexes`, which the rules check while you act, and are cleared when it
	// ends. Two fields so a hex played on you never affects the turn you're already in.
	// Optional only because rooms saved before hexes existed don't have them.
	nextHexes?: Hexes;
	hexes?: Hexes;
	explodesOnTurn?: number | null; // your brew is Volatile and explodes at the start of this turn
}

export interface TurnState {
	seat: Seat;
	number: number; // 1-based, counts both players' turns
	endsAt: number; // epoch ms; the turn auto-ends then
}

// Why the room is counting down to deletion, and when. We keep the reason so that events
// that don't change the connected count (e.g. a duplicated tab) don't restart the clock.
export interface ReapTimer {
	reason: "empty" | "solo";
	at: number; // epoch ms
}

export interface RoomState {
	code: string;
	createdAt: number;
	status: "waiting" | "playing" | "finished";
	players: [PlayerState | null, PlayerState | null]; // index = seat
	turn: TurnState | null; // non-null exactly while status is "playing"
	winner: Seat | null;
	lastThrow: ThrowRecord | null;
	lastExplosion?: ExplosionRecord | null;
	lastPlay?: PlayRecord | null;
	tokensMade?: number; // counter for token card iids, so every iid in the match is unique
	reap: ReapTimer | null; // null while both players are connected
	/**
	 * Finished matches are deleted at this time even if both players stay connected. Set once,
	 * when the match ends, so reconnecting can't push it back.
	 */
	expiresAt?: number;
}
