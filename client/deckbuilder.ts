// The deck builder screen, and which deck you'll play. Your deck is saved in localStorage after
// every change, so a refresh doesn't lose it (per browser, no account needed). It's only a
// request: the server checks it again with the same validateDeck when you join.

import { CARDS, type CardId } from "../shared/cards";
import { BUILDABLE, DECK_SIZE, MAX_COPIES, STARTER_DECK, validateDeck } from "../shared/decks";
import { cardFace, fitText } from "./board";
import { hoverTick, play } from "./sound";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("stage");
const lobby = $("lobby");
const builder = $("builder");
const pool = $("pool");
const deckList = $("deck-list");
const preview = $("builder-preview");

// ---- Storage ----

const KEY = "shayken:deck";

/** Your built deck, or null to play the starter. */
let custom: CardId[] | null = load();

function load(): CardId[] | null {
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
		// Drop anything that isn't a card any more (a card renamed or removed since it was saved).
		return Array.isArray(saved) ? saved.filter((id): id is CardId => (BUILDABLE as readonly unknown[]).includes(id)) : null;
	} catch {
		return null;
	}
}

function save(): void {
	try {
		if (custom) localStorage.setItem(KEY, JSON.stringify(custom));
		else localStorage.removeItem(KEY);
	} catch {} // storage unavailable (private window, blocked site data): the deck lasts until a refresh
}

/** What to send when joining: no deck for the starter, or an error if your built deck isn't legal yet. */
export function deckForJoin(): { ok: true; deck?: CardId[] } | { ok: false; reason: string } {
	if (!custom) return { ok: true };
	const check = validateDeck(custom);
	return check.ok ? { ok: true, deck: check.deck } : { ok: false, reason: check.reason };
}

// ---- Lobby ----

function renderLobbyLabel(): void {
	const label = !custom ? "Deck: Starter" : validateDeck(custom).ok ? "Deck: Custom" : `Deck: Custom (${custom.length}/${DECK_SIZE}, not ready)`;
	$("deck-label").textContent = label;
}
renderLobbyLabel();

$("build-btn").addEventListener("click", () => {
	lobby.hidden = true;
	builder.hidden = false;
	stage.dataset.screen = "builder";
	$("status").textContent = "";
	render();
});

$("deck-done").addEventListener("click", () => {
	builder.hidden = true;
	lobby.hidden = false;
	stage.dataset.screen = "lobby";
	renderLobbyLabel();
});

// ---- Builder ----

const count = (id: CardId) => (custom ?? STARTER_DECK).filter((c) => c === id).length;

/** Any change makes the deck yours (a copy of the starter, the first time) and saves it. */
function edit(change: (deck: CardId[]) => void): void {
	custom ??= [...STARTER_DECK];
	change(custom);
	save();
	play("click", { vary: 0 });
	render();
}

function add(id: CardId): void {
	edit((deck) => {
		if (count(id) < MAX_COPIES) deck.push(id);
		else deck.splice(0, deck.length, ...deck.filter((c) => c !== id)); // at the limit: clicking again takes it out
	});
}

function remove(id: CardId): void {
	edit((deck) => deck.splice(deck.indexOf(id), 1));
}

function showCard(id: CardId): void {
	const face = cardFace(id);
	preview.replaceChildren(face);
	fitText(face);
	hoverTick();
}

/** A one-line card: art, name and cost. */
function tile(id: CardId, tag: "button" | "li"): HTMLElement {
	const def = CARDS[id];
	const el = document.createElement(tag);
	el.className = `tile ${def.type}`;
	el.innerHTML = `<img alt="" /><span class="tname"></span><span class="tcost"></span>`;
	el.querySelector("img")!.src = `/sprites/cards/${id}.png`;
	el.querySelector(".tname")!.textContent = def.name;
	el.querySelector(".tcost")!.textContent = String(def.cost);
	el.addEventListener("mouseenter", () => showCard(id));
	return el;
}

// The pool never changes, so build it once; render() only marks what's in the deck.
const poolTiles = new Map<CardId, HTMLElement>();
for (const id of BUILDABLE) {
	const el = tile(id, "button");
	el.addEventListener("click", () => add(id));
	poolTiles.set(id, el);
	pool.append(el);
}

function render(): void {
	const deck = custom ?? [...STARTER_DECK];
	for (const [id, el] of poolTiles) el.classList.toggle("in", count(id) > 0);

	const sorted = [...deck].sort((a, b) => CARDS[a].cost - CARDS[b].cost || CARDS[a].name.localeCompare(CARDS[b].name));
	deckList.replaceChildren(...sorted.map((id) => {
		const el = tile(id, "li");
		el.addEventListener("click", () => remove(id));
		return el;
	}));

	const check = validateDeck(deck);
	$("deck-count").textContent = `${deck.length} / ${DECK_SIZE}`;
	const problem = $("deck-problem");
	problem.textContent = check.ok ? (custom ? "Ready to play" : "Starter deck") : check.reason;
	problem.classList.toggle("ok", check.ok);
}

$("deck-starter").addEventListener("click", () => {
	custom = null;
	save();
	render();
});

$("deck-clear").addEventListener("click", () => edit((deck) => deck.splice(0)));
