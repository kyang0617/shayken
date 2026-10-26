// Everything that travels over the wire. Both sides import these types, so a change here
// shows up as a type error on whichever side wasn't updated.

import type { CardInstance } from "./cards";

export type Seat = 0 | 1;

// ---- HTTP ----

/** Response body of `POST /api/rooms`. */
export interface CreateRoomResponse {
	code: string;
}

// ---- Client -> Server (WebSocket) ----

export type ClientMessage =
	/** First message after connecting. Send your token to reclaim your seat; omit it to take an open one. */
	{ type: "join"; token?: string };

// ---- Server -> Client (WebSocket) ----

export type ErrorCode = "ROOM_NOT_FOUND" | "ROOM_FULL" | "BAD_TOKEN" | "BAD_MESSAGE" | "NOT_JOINED";

export type ServerMessage =
	/** Sent once when you take or reclaim a seat. Keep `token` secret — it is your identity. */
	| { type: "joined"; seat: Seat; token: string }
	/** Your personal view of the room. Sent whenever anything you can see changes. */
	| { type: "state"; view: PlayerView }
	| { type: "error"; code: ErrorCode; message: string };

/**
 * What one player is allowed to see. The server builds this separately for each seat, so
 * the opponent's cards and every deck's order never leave the server.
 */
export interface PlayerView {
	roomCode: string;
	status: "waiting" | "dealt";
	you: { seat: Seat; hand: CardInstance[]; deckCount: number };
	opponent: { connected: boolean; handCount: number; deckCount: number } | null;
}

/** WebSocket close codes we send (4000-4999 is reserved for applications). */
export const CloseCode = {
	/** Your seat was claimed by a newer connection with the same token (e.g. a duplicated tab). */
	Replaced: 4001,
	/** The join failed; see the preceding error message. */
	JoinFailed: 4002,
} as const;
