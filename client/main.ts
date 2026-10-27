// Browser client. Deliberately dumb: it renders whatever view the server sends and forwards
// player intent. It never decides anything about the game.

import { CARDS, type CardInstance } from "../shared/cards";
import { CloseCode, type ClientMessage, type CreateRoomResponse, type PlayerView, type ServerMessage } from "../shared/protocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const lobby = $("lobby");
const game = $("game");
const statusEl = $("status");
const codeInput = $<HTMLInputElement>("code-input");
const endTurnBtn = $<HTMLButtonElement>("end-turn-btn");
const concedeBtn = $<HTMLButtonElement>("concede-btn");

// sessionStorage is per tab, so two tabs in one browser get different tokens = two players.
// (Duplicating a tab copies sessionStorage, so the copy reclaims the same seat; the server
// then kicks the older connection.)
const tokenKey = (code: string) => `shayken:token:${code}`;

let socket: WebSocket | null = null;
let lastView: PlayerView | null = null;
let turnDeadline: number | null = null; // performance.now() timestamp

$("create-btn").addEventListener("click", async () => {
	setStatus("Creating room…");
	const res = await fetch("/api/rooms", { method: "POST" });
	if (!res.ok) return setStatus(`Could not create room (${res.status})`);
	const { code } = (await res.json()) as CreateRoomResponse;
	connect(code);
});

$("join-form").addEventListener("submit", (e) => {
	e.preventDefault();
	const code = codeInput.value.trim().toUpperCase();
	if (code) connect(code);
});

function connect(code: string): void {
	socket?.close();
	history.replaceState(null, "", `?room=${code}`);
	setStatus(`Connecting to ${code}…`);

	const proto = location.protocol === "https:" ? "wss" : "ws";
	const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
	socket = ws;

	ws.addEventListener("open", () => {
		send(ws, { type: "join", token: sessionStorage.getItem(tokenKey(code)) ?? undefined });
	});

	ws.addEventListener("message", (e) => {
		const msg = JSON.parse(e.data as string) as ServerMessage;
		switch (msg.type) {
			case "joined":
				sessionStorage.setItem(tokenKey(code), msg.token);
				break;
			case "state":
				render(msg.view);
				break;
			case "error":
				if (msg.code === "BAD_TOKEN" || msg.code === "ROOM_EXPIRED") sessionStorage.removeItem(tokenKey(code));
				setStatus(`Error: ${msg.message}`);
				break;
		}
	});

	ws.addEventListener("close", (e) => {
		if (socket !== ws) return; // we closed it ourselves to switch rooms
		if (e.code === CloseCode.Replaced) setStatus("This seat was opened in another tab.");
		else if (e.code === CloseCode.Expired) setStatus("Room closed after being abandoned. Create a new one.");
		else if (e.code !== CloseCode.JoinFailed) setStatus("Disconnected. Refresh to reconnect.");
		if (e.code === CloseCode.JoinFailed || e.code === CloseCode.Expired) showLobby();
	});
}

function send(ws: WebSocket, msg: ClientMessage): void {
	ws.send(JSON.stringify(msg));
}

function render(view: PlayerView): void {
	lastView = view;
	lobby.hidden = true;
	game.hidden = false;
	$("room-code").textContent = view.roomCode;
	$("seat").textContent = `Player ${view.you.seat + 1}`;

	const myTurn = view.status === "playing" && view.turn?.seat === view.you.seat;
	// Local deadline from the server's relative msLeft, so a wrong client clock doesn't matter.
	turnDeadline = view.turn ? performance.now() + view.turn.msLeft : null;

	const opp = view.opponent;
	$("opp-stats").textContent = opp
		? `${opp.connected ? "" : "(disconnected) "}❤️ ${opp.health} · 💧 ${opp.essence} essence · ${opp.handCount} in hand · ${opp.deckCount} deck · ${opp.discardCount} discard`
		: "Waiting for an opponent to join…";
	$("opp-brew").replaceChildren(...(opp?.brew ?? []).map((c) => renderCard(c)));
	$("opp-powers").replaceChildren(...(opp?.powers ?? []).map((c) => renderCard(c)));

	const me = view.you;
	$("my-stats").textContent = `❤️ ${me.health} · 💧 ${me.essence} essence · ${me.deckCount} deck · ${me.discardCount} discard`;
	$("my-brew").replaceChildren(...me.brew.map((c) => renderCard(c)));
	$("my-powers").replaceChildren(...me.powers.map((c) => renderCard(c)));
	// Greying out unplayable cards is only a convenience; the server checks every play anyway.
	$("hand").replaceChildren(...me.hand.map((c) => renderCard(c, myTurn && CARDS[c.cardId].cost <= me.essence)));

	endTurnBtn.disabled = !myTurn;
	concedeBtn.disabled = view.status !== "playing";
	resetConcede();

	if (view.status === "waiting") setStatus(`Share code ${view.roomCode} with your opponent.`);
	else if (view.status === "finished") setStatus(view.winner === me.seat ? "You win! 🎉" : "You lost.");
	else setStatus("");
	updateTurnLabel();
}

function renderCard(card: CardInstance, playable = false): HTMLElement {
	const def = CARDS[card.cardId];
	const el = document.createElement("div");
	el.className = `card ${def.type}${playable ? " playable" : ""}`;
	el.innerHTML = `<div class="cost"></div><div class="type"></div><div class="name"></div><div class="text"></div>`;
	// textContent, not innerHTML, for data: never inject strings as HTML.
	el.querySelector(".cost")!.textContent = String(def.cost);
	el.querySelector(".type")!.textContent = def.type;
	el.querySelector(".name")!.textContent = def.name;
	el.querySelector(".text")!.textContent = def.text;
	if (playable) el.addEventListener("click", () => socket && send(socket, { type: "playCard", iid: card.iid }));
	return el;
}

function updateTurnLabel(): void {
	const view = lastView;
	const label = $("turn");
	if (!view?.turn || view.status !== "playing") {
		label.textContent = view?.status === "finished" ? "Match over" : "";
		return;
	}
	const secs = Math.max(0, Math.ceil(((turnDeadline ?? 0) - performance.now()) / 1000));
	const whose = view.turn.seat === view.you.seat ? "Your turn" : "Opponent's turn";
	label.textContent = `Turn ${view.turn.number} · ${whose} · ${secs}s`;
}
setInterval(updateTurnLabel, 250);

endTurnBtn.addEventListener("click", () => socket && send(socket, { type: "endTurn" }));

// Two clicks to concede, without a blocking confirm() dialog.
let concedeArmed = false;
concedeBtn.addEventListener("click", () => {
	if (!concedeArmed) {
		concedeArmed = true;
		concedeBtn.textContent = "Really concede?";
		setTimeout(resetConcede, 3000);
	} else if (socket) {
		send(socket, { type: "concede" });
	}
});
function resetConcede(): void {
	concedeArmed = false;
	concedeBtn.textContent = "Concede";
}

function showLobby(): void {
	lobby.hidden = false;
	game.hidden = true;
	history.replaceState(null, "", location.pathname);
}

function setStatus(text: string): void {
	statusEl.textContent = text;
}

// Opening a ?room=CODE link (or refreshing) joins straight away.
const fromUrl = new URLSearchParams(location.search).get("room");
if (fromUrl) connect(fromUrl.toUpperCase());
