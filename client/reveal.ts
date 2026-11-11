// The opponent's plays, shown face up for a few seconds so there's time to read them. Purely
// cosmetic, like anim.ts: driven by the view's lastPlay, and nothing waits for it.

import type { PlayerView } from "../shared/protocol";
import { cardFace, fitText } from "./board";

const SHOW_MS = 6000;
const FADE_MS = 400; // matches the opacity transition in style.css
const MAX_SHOWN = 2; // a third play pushes the oldest out early, so they don't cover the board

const box = document.getElementById("reveal")!;

/** Call after each new view with the previous one. */
export function revealPlays(prev: PlayerView | null, view: PlayerView): void {
	// No previous view (first view after joining or reconnecting): don't replay old plays.
	if (!prev || prev.roomCode !== view.roomCode) return;
	const p = view.lastPlay, q = prev.lastPlay;
	if (!p || p.seat === view.you.seat) return;
	if (q && q.turn === p.turn && q.card.iid === p.card.iid) return; // not a new play

	const face = cardFace(p.card.cardId);
	box.prepend(face);
	fitText(face);
	while (box.children.length > MAX_SHOWN) box.lastElementChild!.remove();
	setTimeout(() => {
		face.classList.add("leaving");
		setTimeout(() => face.remove(), FADE_MS);
	}, SHOW_MS);
}

export function clearReveals(): void {
	box.replaceChildren();
}
