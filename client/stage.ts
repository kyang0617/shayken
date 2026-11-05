// Scales the fixed 640×360 stage to fill as much of the window as its 16:9 shape allows. The
// scale isn't rounded to a whole number: that kept pixels perfectly even, but on big screens it
// left up to 15% of the window empty. Where the window's shape differs from 16:9, the page
// tiles the same floor around the stage (style.css), lined up with the stage's own tiles.

export const STAGE_W = 640;
export const STAGE_H = 360;

const stage = document.getElementById("stage")!;
let scale = 1;

function fit(): void {
	scale = Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);
	// On the root, so the page background can scale and align its floor tiles too.
	const root = document.documentElement.style;
	root.setProperty("--scale", String(scale));
	root.setProperty("--stage-x", `${(innerWidth - STAGE_W * scale) / 2}px`);
	root.setProperty("--stage-y", `${(innerHeight - STAGE_H * scale) / 2}px`);
}
fit();
addEventListener("resize", fit);

/** Current stage scale: screen pixels per art pixel. */
export const stageScale = (): number => scale;

/** An element's box in stage (art pixel) coordinates, so animations can position things. */
export function stageRect(el: Element): { x: number; y: number; w: number; h: number } {
	const s = stage.getBoundingClientRect();
	const r = el.getBoundingClientRect();
	return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
}
