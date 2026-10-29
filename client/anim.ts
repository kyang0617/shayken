// Animations. Purely cosmetic: the board is always rendered straight from the server's view
// first, and animations only make the change *look* continuous. Nothing here delays or
// decides anything, so a new state can arrive mid-animation and simply wins.
//
// The technique is FLIP (First, Last, Invert, Play): measure every card before the board
// re-renders (`snapshot`), measure again after, then animate each card from its old box to
// its new one. Cards that change zone (hand -> brew) get a "ghost" copy that flies the old
// look to the new spot. Math.random is fine for particles: it's decoration, not game logic.

import type { PlayerView } from "../shared/protocol";
import { stageRect } from "./stage";

type Rect = { x: number; y: number; w: number; h: number };
/** How a card looks in a zone; ghosts keep the look of the zone they left. */
type Look = "full" | "icon" | "token";
interface Seen { el: HTMLElement; rect: Rect; look: Look; mine: boolean }
export type Snapshot = Map<string, Seen>;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const fx = $("#fx");
const running = new Set<Animation>(); // animations on real board elements (not ghosts)

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.3,.7,.4,1)";
const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * The transform that makes an element laid out at `box` appear at `target` instead: uniformly
 * scaled to fit, centred. Used with transform-origin 0 0.
 */
function mapTo(box: Rect, target: Rect): string {
	const s = Math.min(target.w / box.w, target.h / box.h);
	const c = center(target);
	return `translate(${c.x - box.x - (box.w * s) / 2}px, ${c.y - box.y - (box.h * s) / 2}px) scale(${s})`;
}

function lookOf(el: HTMLElement): Look {
	const zone = el.parentElement;
	return zone?.id === "hand" ? "full" : zone?.classList.contains("powers") ? "token" : "icon";
}

/** Call before rendering a new view: remember where every card is right now. */
export function snapshot(): Snapshot {
	const snap: Snapshot = new Map();
	for (const el of document.querySelectorAll<HTMLElement>("#game [data-iid]")) {
		const zone = el.parentElement!;
		snap.set(el.dataset.iid!, { el, rect: stageRect(el), look: lookOf(el), mine: zone.id === "hand" || zone.id.startsWith("my-") });
	}
	// Measured mid-flight on purpose, so an interrupted animation continues from where it is.
	for (const a of running) a.cancel();
	running.clear();
	return snap;
}

function play(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation {
	const a = el.animate(frames, { easing: EASE, fill: "backwards", ...opts });
	running.add(a);
	a.finished.then(() => running.delete(a), () => {});
	return a;
}

/** A detached copy of a card, drawn in the fx layer with the look of the zone it was in. */
function ghost(el: HTMLElement, look: Look, at: Rect): HTMLElement {
	const g = el.cloneNode(true) as HTMLElement;
	g.removeAttribute("data-iid");
	g.classList.remove("playable");
	g.classList.add(look);
	g.style.left = `${at.x}px`;
	g.style.top = `${at.y}px`;
	fx.append(g);
	return g;
}

/** Animate a ghost and remove it when done. */
function fly(g: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
	const a = g.animate(frames, { easing: EASE, fill: "both", ...opts });
	return a.finished.then(() => g.remove(), () => g.remove());
}

/** Call after rendering `view` (with the snapshot taken before) to animate what changed. */
export function animate(snap: Snapshot, prev: PlayerView | null, view: PlayerView): void {
	if (reduced() || !prev || prev.roomCode !== view.roomCode) return;
	const me = view.you;
	const throwNew = view.lastThrow && (view.lastThrow.turn !== prev.lastThrow?.turn || view.lastThrow.seat !== prev.lastThrow?.seat);
	const thrown = new Set(throwNew ? view.lastThrow!.cards.map((c) => c.iid) : []);

	// Cards on the board now.
	let drawn = 0;
	for (const el of document.querySelectorAll<HTMLElement>("#game [data-iid]")) {
		const iid = el.dataset.iid!;
		const now = stageRect(el);
		const was = snap.get(iid);
		const look = lookOf(el);
		if (was && was.look === look) {
			// Same zone: slide from the old position (e.g. the hand closing a gap).
			if (Math.abs(was.rect.x - now.x) + Math.abs(was.rect.y - now.y) > 0.5)
				play(el, [{ transform: mapTo(now, was.rect), transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], { duration: 220 });
		} else if (was) {
			// Changed zone (played from hand): the old card flies over, then the new form pops in.
			const g = ghost(was.el, was.look, was.rect);
			fly(g, [{ transform: "none", transformOrigin: "0 0" }, { transform: mapTo(was.rect, now), transformOrigin: "0 0", opacity: 0.6 }], { duration: 320 });
			popIn(el, 320);
		} else if (el.parentElement!.id === "hand") {
			// Drawn: fly in from the deck, one after another.
			const deck = stageRect($(".piles.you .deck"));
			play(el, [{ transform: mapTo(now, deck), transformOrigin: "0 0", opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: "none", transformOrigin: "0 0" }], { duration: 300, delay: 150 + drawn++ * 70 });
		} else if (el.closest(".opp, #opp-brew, #opp-powers")) {
			// The opponent played it: show the card coming from their hand.
			const from = stageRect($("#opp-hand"));
			const start = { x: from.x + from.w / 2 - 28, y: -60, w: 56, h: 76 };
			const g = ghost(el, "full", start);
			fly(g, [{ transform: "none", transformOrigin: "0 0" }, { transform: "translate(0, 70px)", transformOrigin: "0 0", offset: 0.45 }, { transform: mapTo(start, now), transformOrigin: "0 0" }], { duration: 650 });
			popIn(el, 650);
		}
	}

	// Cards that left the board: thrown, or discarded.
	let tossed = 0;
	for (const [iid, was] of snap) {
		if (document.querySelector(`#game [data-iid="${iid}"]`)) continue;
		if (thrown.has(iid)) continue; // handled by the throw below
		const pile = stageRect($(was.mine ? ".piles.you .discard" : ".piles.opp .discard"));
		const g = ghost(was.el, was.look, was.rect);
		fly(g, [{ transform: "none", transformOrigin: "0 0" }, { transform: mapTo(was.rect, pile), transformOrigin: "0 0", opacity: 0.3 }], { duration: 300, delay: tossed++ * 40 });
	}

	let impactAt = 0;
	if (throwNew) impactAt = throwBrew(snap, view);
	healthChange(".hero.you", prev.you.health, me.health, impactAt);
	if (prev.opponent && view.opponent) healthChange(".hero.opp", prev.opponent.health, view.opponent.health, impactAt);
	shieldChange("#my-shield", prev.you.shield, me.shield, impactAt);
	if (prev.opponent && view.opponent) shieldChange("#opp-shield", prev.opponent.shield, view.opponent.shield, impactAt);
	essenceChange("#my-essence", prev.you.essence, me.essence);
	if (prev.opponent && view.opponent) essenceChange("#opp-essence", prev.opponent.essence, view.opponent.essence);
	if (view.status === "playing" && view.turn && view.turn.number !== prev.turn?.number) banner(view.turn.seat === me.seat ? "Your turn" : "Their turn", impactAt);
}

/** Hide a card until its ghost lands, then pop it in (and splash the cauldron if it's a brew). */
function popIn(el: HTMLElement, after: number): void {
	play(el, [{ opacity: 0, transform: "scale(1.6)" }, { opacity: 1, transform: "none" }], { duration: 140, delay: after });
	const cauldron = el.closest(".cauldron-zone")?.querySelector<HTMLElement>(".cauldron");
	if (cauldron) play(cauldron, [{ transform: "scale(1.12, 0.88)" }, { transform: "none" }], { duration: 180, delay: after });
}

/** The thrown ingredients arc across to the target's portrait and splash. Returns impact time. */
function throwBrew(snap: Snapshot, view: PlayerView): number {
	const t = view.lastThrow!;
	const mine = t.seat === view.you.seat;
	const target = $(mine ? ".hero.opp .portrait" : ".hero.you .portrait");
	const to = stageRect(target);
	const duration = 600, stagger = 70;
	t.cards.forEach((c, i) => {
		const was = snap.get(c.iid);
		if (!was) return;
		const dx = center(to).x - center(was.rect).x, dy = center(to).y - center(was.rect).y;
		const g = ghost(was.el, "icon", was.rect);
		fly(g, [
			{ transform: "translate(0, 0) rotate(0)" },
			{ transform: `translate(${dx / 2}px, ${dy / 2 - 50}px) rotate(270deg)`, easing: "ease-in" },
			{ transform: `translate(${dx}px, ${dy}px) rotate(540deg)` },
		], { duration, delay: i * stagger, easing: "ease-out" });
	});
	const impactAt = duration + (t.cards.length - 1) * stagger;
	setTimeout(() => splash(center(to), mine ? "#79d84a" : "#b56ae8"), impactAt);
	target.animate([{ transform: "none" }, { transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "translateX(-2px)" }, { transform: "none" }], { duration: 300, delay: impactAt, easing: "steps(5)" });
	return impactAt;
}

function splash(at: { x: number; y: number }, color: string): void {
	for (let i = 0; i < 14; i++) {
		const p = document.createElement("div");
		p.className = "particle";
		p.style.cssText = `left:${at.x}px;top:${at.y}px;background:${color}`;
		fx.append(p);
		const angle = Math.random() * Math.PI * 2, dist = 10 + Math.random() * 22;
		fly(p, [
			{ transform: "translate(0, 0)" },
			{ transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 12}px)`, opacity: 0 },
		], { duration: 450 + Math.random() * 200, easing: "ease-out" });
	}
}

/** Floating "-N" over a portrait that lost health. */
function healthChange(hero: string, before: number, after: number, delay: number): void {
	if (after >= before) return;
	floatText(stageRect($(`${hero} .portrait`)), `-${before - after}`, "damage", delay);
}

/** A shield step breaking: the counter blinks and "-25%" floats off it. */
function shieldChange(sel: string, before: number, after: number, delay: number): void {
	if (after >= before) return;
	const el = $(sel);
	floatText(stageRect(el), `-${before - after}%`, "shield", delay);
	el.parentElement!.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 500, delay, easing: "steps(5)" });
}

/** Small "+N" next to an essence counter. */
function essenceChange(sel: string, before: number, after: number): void {
	if (after <= before) return;
	floatText(stageRect($(sel)), `+${after - before}`, "gain", 0);
}

function floatText(at: Rect, text: string, kind: string, delay: number): void {
	const el = document.createElement("div");
	el.className = `float ${kind}`;
	el.textContent = text;
	el.style.left = `${at.x + at.w}px`;
	el.style.top = `${at.y}px`;
	fx.append(el);
	// Starts invisible: with fill "both" the first frame shows during the delay.
	fly(el, [{ transform: "translateY(0)", opacity: 0 }, { opacity: 1, offset: 0.05 }, { transform: "translateY(-6px)", opacity: 1, offset: 0.3 }, { transform: "translateY(-14px)", opacity: 0 }], { duration: 1000, delay, easing: "ease-out" });
}

function banner(text: string, delay: number): void {
	const el = document.createElement("div");
	el.className = "banner";
	el.textContent = text;
	fx.append(el);
	fly(el, [
		{ opacity: 0, transform: "translateX(-30px)" },
		{ opacity: 1, transform: "none", offset: 0.15 },
		{ opacity: 1, transform: "none", offset: 0.8 },
		{ opacity: 0, transform: "translateX(30px)" },
	], { duration: 1300, delay, easing: "ease-out" });
}
