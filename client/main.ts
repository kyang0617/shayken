// Browser client. Deliberately dumb: it renders whatever view the server sends and forwards
// player intent. It never decides anything about the game.

import { CARDS, type CardInstance } from "../shared/cards";
import { CloseCode, type ClientMessage, type CreateRoomResponse, type PlayerView, type ServerMessage } from "../shared/protocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const lobby = $("lobby");
const game = $("game");
const statusEl = $("status");
const codeInput = $<HTMLInputElement>("code-input");

// sessionStorage is per tab, so two tabs in one browser get different tokens = two players.
// (Duplicating a tab copies sessionStorage, so the copy reclaims the same seat; the server
// then kicks the older connection.)
const tokenKey = (code: string) => `shayken:token:${code}`;

let socket: WebSocket | null = null;

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
	lobby.hidden = true;
	game.hidden = false;
	$("room-code").textContent = view.roomCode;
	$("seat").textContent = `Player ${view.you.seat + 1}`;

	const opp = view.opponent;
	$("opponent").textContent = opp
		? `Opponent${opp.connected ? "" : " (disconnected)"} — ${opp.handCount} cards in hand, ${opp.deckCount} in deck`
		: "Waiting for an opponent to join…";

	$("deck-count").textContent = `${view.you.deckCount} cards in deck`;
	$("hand").replaceChildren(...view.you.hand.map(renderCard));
	setStatus(view.status === "waiting" ? `Share code ${view.roomCode} with your opponent.` : "Hands dealt.");
}

function renderCard(card: CardInstance): HTMLElement {
	const def = CARDS[card.cardId];
	const el = document.createElement("div");
	el.className = "card";
	el.innerHTML = `<div class="cost"></div><div class="name"></div><div class="text"></div>`;
	// textContent, not innerHTML, for data: never inject strings as HTML.
	el.querySelector(".cost")!.textContent = String(def.cost);
	el.querySelector(".name")!.textContent = def.name;
	el.querySelector(".text")!.textContent = def.text;
	return el;
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
