// Draws a PlayerView onto the board. Card elements are keyed by `iid`: the same physical card
// keeps the same DOM element as it moves between hand, brew and powers, so it can be animated
// from where it was to where it is (see anim.ts). CSS decides how a card looks in each zone.

import { brewDamage } from "../shared/brew";
import { CARDS, type CardId, type CardInstance } from "../shared/cards";
import type { PlayerView } from "../shared/protocol";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const preview = $("preview");
const cardEls = new Map<string, HTMLElement>();
let onPlay: (iid: string) => void = () => {};

/** What to do when the player clicks a playable card in their hand. */
export function setPlayHandler(fn: (iid: string) => void): void {
	onPlay = fn;
}

/** A card face that isn't tied to a physical card (preview, result screen). */
export function cardFace(cardId: CardId): HTMLElement {
	const def = CARDS[cardId];
	const el = document.createElement("div");
	el.className = `card ${def.type}`;
	el.innerHTML = `<div class="cost"></div><div class="art"><img alt="" /></div><div class="name"></div><div class="type"></div><div class="text"></div>`;
	// textContent, not innerHTML, for data: never inject strings as HTML.
	el.querySelector(".cost")!.textContent = String(def.cost);
	el.querySelector("img")!.src = `/sprites/cards/${cardId}.png`;
	el.querySelector(".name")!.textContent = def.name;
	el.querySelector(".type")!.textContent = def.type;
	el.querySelector(".text")!.textContent = def.text;
	return el;
}

/** The one element for this physical card, created on first sight. */
function cardEl(card: CardInstance): HTMLElement {
	let el = cardEls.get(card.iid);
	if (!el) {
		el = cardFace(card.cardId);
		el.dataset.iid = card.iid;
		el.addEventListener("click", () => el!.classList.contains("playable") && onPlay(card.iid));
		el.addEventListener("mouseenter", () => showPreview(card.cardId));
		el.addEventListener("mouseleave", hidePreview);
		cardEls.set(card.iid, el);
	}
	return el;
}

/** Put exactly these cards, in this order, into `zone`, reusing their elements. */
function place(zone: HTMLElement, cards: CardInstance[], playable: (c: CardInstance) => boolean = () => false): void {
	zone.replaceChildren(...cards.map((c) => {
		const el = cardEl(c);
		el.classList.toggle("playable", playable(c));
		return el;
	}));
}

function showPreview(cardId: CardId): void {
	preview.replaceChildren(cardFace(cardId));
	preview.hidden = false;
}
function hidePreview(): void {
	preview.hidden = true;
}

export function renderBoard(view: PlayerView): void {
	const me = view.you;
	const opp = view.opponent;
	const myTurn = view.status === "playing" && view.turn?.seat === me.seat;

	$("room-code").textContent = view.roomCode;
	$("seat").textContent = `P${me.seat + 1}`;

	// Opponent
	$("opp-hand").replaceChildren(...Array.from({ length: opp?.handCount ?? 0 }, () => {
		const back = document.createElement("div");
		back.className = "card-back";
		return back;
	}));
	$("opp-health").textContent = opp ? String(opp.health) : "-";
	$("opp-essence").textContent = opp ? String(opp.essence) : "-";
	$("opp-conn").textContent = opp && !opp.connected ? "Disconnected" : "";
	$("opp-deck").textContent = opp ? String(opp.deckCount) : "";
	$("opp-discard").textContent = opp ? String(opp.discardCount) : "";
	place($("opp-brew"), opp?.brew ?? []);
	place($("opp-powers"), opp?.powers ?? []);
	$("opp-brew-dmg").textContent = opp?.brew.length ? `${brewDamage(opp.brew)} dmg` : "";

	// You
	$("my-health").textContent = String(me.health);
	$("my-essence").textContent = String(me.essence);
	$("my-deck").textContent = String(me.deckCount);
	$("my-discard").textContent = String(me.discardCount);
	place($("my-brew"), me.brew);
	place($("my-powers"), me.powers);
	// Same formula the server uses to resolve the throw (shared/brew.ts), so the preview is exact.
	const myBrewDamage = brewDamage(me.brew);
	$("my-brew-dmg").textContent = me.brew.length ? `${myBrewDamage} dmg` : "";
	// Highlighting playable cards is only a convenience; the server checks every play anyway.
	place($("hand"), me.hand, (c) => myTurn && CARDS[c.cardId].cost <= me.essence);

	const endTurnBtn = $<HTMLButtonElement>("end-turn-btn");
	const throwBtn = $<HTMLButtonElement>("throw-btn");
	endTurnBtn.disabled = !myTurn;
	throwBtn.disabled = !myTurn || me.brew.length === 0;
	throwBtn.textContent = me.brew.length ? `Throw (${myBrewDamage})` : "Throw";

	const t = view.lastThrow;
	$("last-throw").textContent = t
		? `${t.seat === me.seat ? "You" : "Opponent"} threw ${t.cards.length} ingredient${t.cards.length === 1 ? "" : "s"} for ${t.damage} damage.`
		: "";

	// Forget elements for cards no longer on the board (discarded, drawn back later as the
	// same iid would simply get a fresh element).
	const onBoard = new Set([...me.hand, ...me.brew, ...me.powers, ...(opp?.brew ?? []), ...(opp?.powers ?? [])].map((c) => c.iid));
	for (const [iid, el] of cardEls) if (!onBoard.has(iid)) { el.remove(); cardEls.delete(iid); }
	if (!preview.hidden && ![...cardEls.values()].some((el) => el.matches(":hover"))) hidePreview();
}

/** Drop every card element, e.g. when leaving a room. */
export function clearBoard(): void {
	cardEls.clear();
	hidePreview();
}
