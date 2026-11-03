// Draws a PlayerView onto the board. Card elements are keyed by `iid`: the same physical card
// keeps the same DOM element as it moves between hand, brew and powers, so it can be animated
// from where it was to where it is (see anim.ts). CSS decides how a card looks in each zone.

import { brewDamage, damageAfterShield } from "../shared/brew";
import { CARDS, type CardId, type CardInstance } from "../shared/cards";
import type { PlayerView, PublicPlayerView } from "../shared/protocol";
import { hoverTick } from "./sound";

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
		el.addEventListener("mouseenter", () => {
			showPreview(card.cardId);
			hoverTick();
		});
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
	renderShield("opp-shield", opp?.shield ?? null);
	$("opp-conn").textContent = opp && !opp.connected ? "Disconnected" : "";
	$("opp-deck").textContent = opp ? String(opp.deckCount) : "";
	$("opp-discard").textContent = opp ? String(opp.discardCount) : "";
	place($("opp-brew"), opp?.brew ?? []);
	place($("opp-powers"), opp?.powers ?? []);
	$("opp-brew-dmg").textContent = opp?.brew.length ? damageLabel(brewDamage(opp.brew), me.shield) : "";
	const oppTurn = view.status === "playing" && !!opp && !myTurn;
	renderHexes("opp-hexes", opp, oppTurn);
	renderFuse("opp", opp, oppTurn, view);

	// You
	$("my-health").textContent = String(me.health);
	$("my-essence").textContent = String(me.essence);
	renderShield("my-shield", me.shield);
	$("my-deck").textContent = String(me.deckCount);
	$("my-discard").textContent = String(me.discardCount);
	place($("my-brew"), me.brew);
	place($("my-powers"), me.powers);
	// Same formula the server uses to resolve the throw (shared/brew.ts), so the preview is exact.
	// Same for the shield: show what would actually get through the opponent's shield.
	const myBrewDamage = brewDamage(me.brew);
	const oppShield = opp?.shield ?? 0;
	$("my-brew-dmg").textContent = me.brew.length ? damageLabel(myBrewDamage, oppShield) : "";
	renderHexes("my-hexes", me, myTurn);
	renderFuse("my", me, myTurn, view);
	// Highlighting playable cards is only a convenience; the server checks every play anyway.
	// Same for the cost: a cost hex raises every card's price this turn.
	const cost = (c: CardInstance) => CARDS[c.cardId].cost + me.hexes.costUp;
	place($("hand"), me.hand, (c) => myTurn && cost(c) <= me.essence);
	for (const c of me.hand) {
		const el = cardEls.get(c.iid)!;
		el.querySelector(".cost")!.textContent = String(cost(c));
		el.classList.toggle("taxed", me.hexes.costUp > 0);
	}

	const endTurnBtn = $<HTMLButtonElement>("end-turn-btn");
	const throwBtn = $<HTMLButtonElement>("throw-btn");
	endTurnBtn.disabled = !myTurn;
	throwBtn.disabled = !myTurn || me.brew.length === 0 || me.hexes.sealed;
	throwBtn.textContent = me.hexes.sealed ? "Sealed" : me.brew.length ? `Throw (${damageAfterShield(myBrewDamage, oppShield)})` : "Throw";

	$("last-throw").textContent = lastEvent(view);

	// Forget elements for cards no longer on the board (discarded, drawn back later as the
	// same iid would simply get a fresh element).
	const onBoard = new Set([...me.hand, ...me.brew, ...me.powers, ...(opp?.brew ?? []), ...(opp?.powers ?? [])].map((c) => c.iid));
	for (const [iid, el] of cardEls) if (!onBoard.has(iid)) { el.remove(); cardEls.delete(iid); }
	if (!preview.hidden && ![...cardEls.values()].some((el) => el.matches(":hover"))) hidePreview();
}

/** The most recent throw or explosion, in words. */
function lastEvent(view: PlayerView): string {
	const t = view.lastThrow, x = view.lastExplosion;
	const who = (seat: number) => (seat === view.you.seat ? "You" : "Opponent");
	// An explosion happens at the start of a turn, so on the same turn it came before any throw.
	if (x && (!t || x.turn > t.turn)) return `${x.seat === view.you.seat ? "Your" : "Opponent's"} Volatile brew exploded for ${x.damage} damage!`;
	if (!t) return "";
	return `${who(t.seat)} threw ${t.cards.length} ingredient${t.cards.length === 1 ? "" : "s"} for ${t.damage} damage${t.blocked ? ` (${t.blocked} blocked)` : ""}.`;
}

/**
 * Hex tags under a hero: the ones in effect during their turn, otherwise the ones queued for
 * their next turn (prefixed "next").
 */
function renderHexes(id: string, p: PublicPlayerView | null, active: boolean): void {
	const el = $(id);
	if (!p) return void (el.textContent = "");
	const h = active ? p.hexes : p.nextHexes;
	const tags = [
		h.costUp ? `+${h.costUp} cost` : "",
		h.drawLimit !== null ? `draw ${h.drawLimit}` : "",
		h.sealed ? "sealed" : "",
	].filter(Boolean);
	el.textContent = tags.length ? `${active ? "" : "next: "}${tags.join(", ")}` : "";
	el.title = tags.length ? `Hexed ${active ? "this" : "next"} turn: ${tags.join(", ")}` : "";
}

/** The Volatile warning on a cauldron, phrased by how long its owner has left. */
function renderFuse(side: "my" | "opp", p: PublicPlayerView | null, ownersTurn: boolean, view: PlayerView): void {
	const el = $(`${side}-fuse`);
	const at = p?.explodesOnTurn ?? null;
	const now = view.turn?.number ?? 0;
	el.closest(".cauldron-zone")!.classList.toggle("volatile", at !== null);
	el.textContent = at === null ? "" : ownersTurn ? "Volatile! Throw now" : at - now <= 1 ? "Volatile! About to blow" : "Volatile! Throw next turn";
}

/** "12 dmg", or "12 > 6 dmg" when a shield would block some of it. */
function damageLabel(raw: number, shield: number): string {
	const through = damageAfterShield(raw, shield);
	return through === raw ? `${raw} dmg` : `${raw} > ${through} dmg`;
}

function renderShield(id: string, shield: number | null): void {
	const el = $(id);
	el.textContent = shield === null ? "-" : `${shield}%`;
	el.parentElement!.classList.toggle("broken", shield === 0);
}

/** Drop every card element, e.g. when leaving a room. */
export function clearBoard(): void {
	cardEls.clear();
	hidePreview();
}
