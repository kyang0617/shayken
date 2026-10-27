// The full, secret state of one match. Only the GameRoom ever sees all of it; clients get a
// filtered PlayerView (see viewFor in game-room.ts).

import type { CardInstance } from "../shared/cards";
import type { Seat, ThrowRecord } from "../shared/protocol";

export interface PlayerState {
	token: string;
	health: number;
	essence: number;
	deck: CardInstance[]; // index 0 is the top; order is hidden from everyone
	hand: CardInstance[];
	discard: CardInstance[];
	brew: CardInstance[]; // ingredients waiting to be thrown; emptied into discard on throw
	powers: CardInstance[]; // active for the rest of the match
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
	reap: ReapTimer | null; // null while both players are connected
}
