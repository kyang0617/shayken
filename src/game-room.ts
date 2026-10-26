import { DurableObject } from "cloudflare:workers";
import type { CardInstance } from "../shared/cards";
import { STARTER_DECK, STARTING_HAND_SIZE } from "../shared/decks";
import { CloseCode, type ClientMessage, type ErrorCode, type PlayerView, type Seat, type ServerMessage } from "../shared/protocol";
import { randomToken, shuffle } from "./random";

// The full, secret state of one match. Only this object ever sees all of it.
interface PlayerState {
	token: string;
	deck: CardInstance[]; // order matters and is hidden from everyone
	hand: CardInstance[];
}

interface RoomState {
	code: string;
	createdAt: number;
	status: "waiting" | "dealt";
	players: [PlayerState | null, PlayerState | null]; // index = seat
}

// What we attach to each WebSocket. Attachments survive hibernation; instance fields don't.
interface SocketAttachment {
	seat: Seat | null; // null until the socket has sent a successful `join`
}

const ROOM_KEY = "room";
const MAX_MESSAGE_BYTES = 4096;

/**
 * One instance per match, addressed by room code. Durable Objects are single-threaded, so
 * two players' messages are processed one at a time — no races on the game state.
 */
export class GameRoom extends DurableObject<Env> {
	// ---- Storage ----
	//
	// `ctx.storage.kv` is the synchronous key-value API of SQLite-backed Durable Objects. The
	// database lives next to the object, so reads/writes are local and need no `await`. We
	// re-read on every event instead of caching in a field because, after hibernation, the
	// object is rebuilt from scratch and any field would be empty.

	private load(): RoomState | undefined {
		return this.ctx.storage.kv.get<RoomState>(ROOM_KEY);
	}

	private save(room: RoomState): void {
		this.ctx.storage.kv.put(ROOM_KEY, room);
	}

	// ---- RPC from the Worker ----

	/**
	 * Called by `POST /api/rooms`. Returns false if this code is already taken, so the Worker
	 * can retry with another. Marking the room as created means a WebSocket to a made-up code
	 * is rejected instead of silently creating an empty room.
	 */
	async create(code: string): Promise<boolean> {
		if (this.load()) return false;
		this.save({ code, createdAt: Date.now(), status: "waiting", players: [null, null] });
		return true;
	}

	// ---- WebSocket lifecycle ----

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 426 });
		}
		const { 0: client, 1: server } = new WebSocketPair();

		// The Hibernation API: the runtime owns the socket, so this object can be evicted from
		// memory while connections stay open, and is woken up (handlers below) when a message
		// arrives. With the older `server.accept()`, the object would stay in memory — and bill
		// duration — for as long as any socket was open.
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ seat: null } satisfies SocketAttachment);

		// The player isn't identified yet: that happens with their first `join` message. We
		// keep the token out of the URL so it doesn't end up in logs or browser history.
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		const msg = parseClientMessage(raw);
		if (!msg) return this.sendError(ws, "BAD_MESSAGE", "Malformed message");

		switch (msg.type) {
			case "join":
				return this.handleJoin(ws, msg.token);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		// Complete the close handshake (the runtime doesn't do it for us), then tell the other
		// player their opponent dropped. We don't free the seat: they can come back with their token.
		ws.close(code, reason);
		const room = this.load();
		if (room) this.broadcastState(room);
	}

	// ---- Handlers ----

	private handleJoin(ws: WebSocket, token: string | undefined): void {
		const room = this.load();
		if (!room) return this.rejectJoin(ws, "ROOM_NOT_FOUND", "No room with that code");
		if (getAttachment(ws).seat !== null) return this.sendError(ws, "BAD_MESSAGE", "Already joined");

		let seat: Seat;
		if (token !== undefined) {
			// Reclaiming a seat. The token is the only proof of identity we accept.
			const found = room.players.findIndex((p) => p?.token === token);
			if (found === -1) return this.rejectJoin(ws, "BAD_TOKEN", "Unknown player token");
			seat = found as Seat;
			// Only one live connection per seat: kick the older one (e.g. a duplicated tab).
			for (const other of this.socketsForSeat(seat)) other.close(CloseCode.Replaced, "Replaced by a newer connection");
		} else {
			const open = room.players.findIndex((p) => p === null);
			if (open === -1) return this.rejectJoin(ws, "ROOM_FULL", "Room already has two players");
			seat = open as Seat;
			room.players[seat] = { token: randomToken(), deck: [], hand: [] };
		}

		ws.serializeAttachment({ seat } satisfies SocketAttachment);

		if (room.status === "waiting" && room.players[0] && room.players[1]) deal(room);
		this.save(room);

		this.send(ws, { type: "joined", seat, token: room.players[seat]!.token });
		this.broadcastState(room);
	}

	// ---- Views & sending ----

	/** Build what `seat` is allowed to see. This is the only path game state takes to a client. */
	private viewFor(room: RoomState, seat: Seat): PlayerView {
		const me = room.players[seat]!;
		const opp = room.players[seat === 0 ? 1 : 0];
		return {
			roomCode: room.code,
			status: room.status,
			you: { seat, hand: me.hand, deckCount: me.deck.length },
			opponent: opp && {
				connected: this.socketsForSeat(seat === 0 ? 1 : 0).length > 0,
				handCount: opp.hand.length,
				deckCount: opp.deck.length,
			},
		};
	}

	private broadcastState(room: RoomState): void {
		for (const ws of this.ctx.getWebSockets()) {
			if (ws.readyState !== WebSocket.OPEN) continue;
			const { seat } = getAttachment(ws);
			if (seat !== null) this.send(ws, { type: "state", view: this.viewFor(room, seat) });
		}
	}

	/** Open sockets that have joined as `seat`. `getWebSockets()` works across hibernation. */
	private socketsForSeat(seat: Seat): WebSocket[] {
		return this.ctx
			.getWebSockets()
			.filter((ws) => ws.readyState === WebSocket.OPEN && getAttachment(ws).seat === seat);
	}

	private send(ws: WebSocket, msg: ServerMessage): void {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// Socket already closing; webSocketClose will handle cleanup.
		}
	}

	private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
		this.send(ws, { type: "error", code, message });
	}

	private rejectJoin(ws: WebSocket, code: ErrorCode, message: string): void {
		this.sendError(ws, code, message);
		ws.close(CloseCode.JoinFailed, code);
	}
}

// ---- Pure helpers ----

/** Both seats are filled: give each player a freshly shuffled copy of the deck and a hand. */
function deal(room: RoomState): void {
	for (const [seat, player] of room.players.entries()) {
		const deck = STARTER_DECK.map((cardId, i): CardInstance => ({ iid: `p${seat}-${i}`, cardId }));
		player!.deck = shuffle(deck);
		player!.hand = player!.deck.splice(0, STARTING_HAND_SIZE);
	}
	room.status = "dealt";
}

function getAttachment(ws: WebSocket): SocketAttachment {
	return (ws.deserializeAttachment() as SocketAttachment | null) ?? { seat: null };
}

/**
 * Never trust the client: anything we can't positively recognise is rejected. TypeScript
 * types vanish at runtime, so this check is what actually protects the server.
 */
function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
	if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	const msg = data as Record<string, unknown>;

	switch (msg.type) {
		case "join":
			if (msg.token !== undefined && typeof msg.token !== "string") return null;
			return { type: "join", token: msg.token };
		default:
			return null;
	}
}
