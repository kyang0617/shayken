import { DurableObject } from "cloudflare:workers";
import {
	CloseCode,
	type ClientMessage,
	type ErrorCode,
	type PlayerView,
	type PublicPlayerView,
	type Seat,
	type ServerMessage,
} from "../shared/protocol";
import { randomToken } from "./random";
import { concede, endTurn, newPlayer, otherSeat, playCard, startMatch, type ActionResult } from "./rules";
import type { PlayerState, RoomState } from "./state";

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

	/**
	 * Save after every change. This also refreshes the reap deadline and re-arms the alarm, so
	 * no handler can forget to — every state change goes through here.
	 */
	private persist(room: RoomState): void {
		this.updateReaper(room);
		this.syncAlarm(room);
		this.ctx.storage.kv.put(ROOM_KEY, room);
	}

	private get turnMs(): number {
		return Number(this.env.TURN_SECONDS) * 1000;
	}

	// ---- RPC from the Worker ----

	/**
	 * Called by `POST /api/rooms`. Returns false if this code is already taken, so the Worker
	 * can retry with another. Marking the room as created means a WebSocket to a made-up code
	 * is rejected instead of silently creating an empty room.
	 */
	async create(code: string): Promise<boolean> {
		if (this.load()) return false;
		const room: RoomState = {
			code, createdAt: Date.now(), status: "waiting", players: [null, null], turn: null, winner: null, reap: null,
		};
		// Nobody is connected yet, so this starts the "empty" reap timer: a room that's created
		// but never joined gets cleaned up too.
		this.persist(room);
		return true;
	}

	// ---- Timers: turn timer + reaping, sharing one alarm ----
	//
	// Both timers use a Durable Object alarm: it survives hibernation and wakes the object when
	// due, whereas a setTimeout would keep it awake (and billed) the whole time. A DO has only
	// ONE alarm, so the deadlines live in state (`room.turn.endsAt`, `room.reap.at`), the alarm
	// is set to the earliest, and alarm() checks which one(s) are due.

	private syncAlarm(room: RoomState): void {
		const deadlines = [room.turn?.endsAt, room.reap?.at].filter((t): t is number => t !== undefined);
		if (deadlines.length === 0) this.ctx.storage.deleteAlarm();
		else this.ctx.storage.setAlarm(Math.min(...deadlines));
	}

	/** Recompute the reap deadline from who is connected right now. */
	private updateReaper(room: RoomState): void {
		const connected = this.connectedSeats().size;
		const reason = connected === 2 ? null : connected === 1 ? "solo" : "empty";
		if (reason === null) {
			room.reap = null;
			return;
		}
		// Only start a new countdown when the situation changes, so e.g. a solo player
		// refreshing (solo -> empty -> solo) does restart it, but a duplicated tab doesn't.
		if (room.reap?.reason !== reason) {
			const seconds = Number(reason === "solo" ? this.env.REAP_SOLO_SECONDS : this.env.REAP_EMPTY_SECONDS);
			room.reap = { reason, at: Date.now() + seconds * 1000 };
		}
	}

	async alarm(): Promise<void> {
		const room = this.load();
		if (!room) return;
		const now = Date.now();

		// Turn timer: the active player ran out of time, so end their turn for them.
		const turnExpired = !!room.turn && now >= room.turn.endsAt;
		if (turnExpired) endTurn(room, room.turn!.seat, this.turnMs, now);

		// Reaping. Re-check who is actually connected before deleting anything: if someone
		// came back, this clears or pushes back the deadline instead.
		this.updateReaper(room);
		if (room.reap && now >= room.reap.at) return this.reap();

		this.persist(room); // re-arms the alarm for whatever is due next
		if (turnExpired) this.broadcastState(room);
	}

	private async reap(): Promise<void> {
		for (const ws of this.ctx.getWebSockets()) {
			this.sendError(ws, "ROOM_EXPIRED", "Room closed after being abandoned");
			try {
				ws.close(CloseCode.Expired, "Room expired");
			} catch {}
		}
		// With no stored data left, the object effectively ceases to exist and the code is free.
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}

	/** Seats with at least one open socket that has joined. Unjoined sockets don't count. */
	private connectedSeats(): Set<Seat> {
		const seats = new Set<Seat>();
		for (const ws of this.ctx.getWebSockets()) {
			const { seat } = getAttachment(ws);
			if (ws.readyState === WebSocket.OPEN && seat !== null) seats.add(seat);
		}
		return seats;
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
			case "playCard":
				return this.handleAction(ws, (room, seat) => playCard(room, seat, msg.iid));
			case "endTurn":
				return this.handleAction(ws, (room, seat) => endTurn(room, seat, this.turnMs, Date.now()));
			case "concede":
				return this.handleAction(ws, (room, seat) => concede(room, seat));
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		// Complete the close handshake. Don't echo the client's code back: 1005 ("no code") and
		// 1006 ("connection dropped") are reserved and can't be sent, so close() would throw.
		// Newer runtimes may have already replied for us, which also makes close() throw.
		try {
			ws.close(1000, "Closed");
		} catch {}
		// Tell the other player their opponent dropped. We don't free the seat: they can come
		// back with their token (until the room is reaped).
		const room = this.load();
		if (!room) return;
		this.persist(room);
		this.broadcastState(room);
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
			room.players[seat] = newPlayer(randomToken());
		}

		ws.serializeAttachment({ seat } satisfies SocketAttachment);

		if (room.status === "waiting" && room.players[0] && room.players[1]) startMatch(room, this.turnMs, Date.now());
		this.persist(room); // this socket now counts as connected

		this.send(ws, { type: "joined", seat, token: room.players[seat]!.token });
		this.broadcastState(room);
	}

	/**
	 * Every game action follows the same path: identify the sender by their socket (never by
	 * anything in the message), run the rule, and only if it's legal save and broadcast.
	 * Rules leave state untouched when they reject, and we don't save in that case anyway.
	 */
	private handleAction(ws: WebSocket, action: (room: RoomState, seat: Seat) => ActionResult): void {
		const { seat } = getAttachment(ws);
		if (seat === null) return this.sendError(ws, "NOT_JOINED", "Send join first");
		const room = this.load();
		if (!room) return this.sendError(ws, "ROOM_NOT_FOUND", "No room with that code");

		const result = action(room, seat);
		if (!result.ok) return this.sendError(ws, result.code, result.message);
		this.persist(room);
		this.broadcastState(room);
	}

	// ---- Views & sending ----

	/** Build what `seat` is allowed to see. This is the only path game state takes to a client. */
	private viewFor(room: RoomState, seat: Seat): PlayerView {
		const me = room.players[seat]!;
		const opp = room.players[otherSeat(seat)];
		return {
			roomCode: room.code,
			status: room.status,
			turn: room.turn && {
				seat: room.turn.seat,
				number: room.turn.number,
				msLeft: Math.max(0, room.turn.endsAt - Date.now()),
			},
			winner: room.winner,
			you: { ...publicView(me), seat, hand: me.hand },
			opponent: opp && {
				...publicView(opp),
				connected: this.socketsForSeat(otherSeat(seat)).length > 0,
				handCount: opp.hand.length, // count only: the opponent's cards never leave the server
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

/** The parts of a player both sides may see. Lists fields explicitly so nothing leaks by accident. */
function publicView(p: PlayerState): PublicPlayerView {
	return {
		health: p.health,
		essence: p.essence,
		deckCount: p.deck.length,
		discardCount: p.discard.length,
		brew: p.brew,
		powers: p.powers,
	};
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
		case "playCard":
			if (typeof msg.iid !== "string" || msg.iid.length > 64) return null;
			return { type: "playCard", iid: msg.iid };
		case "endTurn":
		case "concede":
			return { type: msg.type };
		default:
			return null;
	}
}
