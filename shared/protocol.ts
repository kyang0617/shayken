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

// Messages express intent ("I want to play this card"), never outcomes. The server decides
// whether it's legal and what happens.
export type ClientMessage =
	/** First message after connecting. Send your token to reclaim your seat; omit it to take an open one. */
	| { type: "join"; token?: string }
	/** Play a card from your hand, identified by its instance id. */
	| { type: "playCard"; iid: string }
	/** End your turn. With `throw: true`, your brew is thrown at the opponent first. */
	| { type: "endTurn"; throw?: boolean }
	| { type: "concede" }
	/**
	 * Leave the room. While waiting for an opponent this cancels (deletes) the room; during a
	 * match it counts as conceding. The server then closes your socket with CloseCode.Left.
	 */
	| { type: "leave" };

// ---- Server -> Client (WebSocket) ----

export type ErrorCode =
	| "ROOM_NOT_FOUND"
	| "ROOM_FULL"
	| "BAD_TOKEN"
	| "BAD_MESSAGE"
	| "NOT_JOINED"
	| "ROOM_EXPIRED"
	// Rejected game actions:
	| "NOT_PLAYING"
	| "NOT_YOUR_TURN"
	| "CARD_NOT_IN_HAND"
	| "NOT_ENOUGH_ESSENCE"
	| "EMPTY_BREW";

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
	/** waiting: fewer than two players have joined. playing: turns are running. finished: someone won. */
	status: "waiting" | "playing" | "finished";
	/**
	 * Whose turn it is. `msLeft` is relative rather than a timestamp so the countdown is right
	 * even if the player's clock is off.
	 */
	turn: { seat: Seat; number: number; msLeft: number } | null;
	winner: Seat | null;
	/** The most recent throw in this match, so clients can show what just happened. */
	lastThrow: ThrowRecord | null;
	you: PublicPlayerView & { seat: Seat; hand: CardInstance[] };
	opponent: (PublicPlayerView & { connected: boolean; handCount: number }) | null;
}

export interface ThrowRecord {
	seat: Seat; // who threw
	turn: number;
	cards: CardInstance[];
	damage: number;
}

/** What both players can see about a player. Deck order and hand contents are never here. */
export interface PublicPlayerView {
	health: number;
	essence: number;
	deckCount: number;
	discardCount: number;
	brew: CardInstance[];
	powers: CardInstance[];
}

/** WebSocket close codes we send (4000-4999 is reserved for applications). */
export const CloseCode = {
	/** Your seat was claimed by a newer connection with the same token (e.g. a duplicated tab). */
	Replaced: 4001,
	/** The join failed; see the preceding error message. */
	JoinFailed: 4002,
	/** The room was deleted after being abandoned; see the preceding error message. */
	Expired: 4003,
	/** You sent `leave`; the server has let you go. */
	Left: 4004,
} as const;
