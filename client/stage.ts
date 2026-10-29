// Scales the fixed 640×360 stage to fit the window. Pixel art looks best at a whole-number
// scale (every art pixel becomes an exact N×N block), so use one unless it would waste a lot
// of the window; small windows fall back to an exact fit.

export const STAGE_W = 640;
export const STAGE_H = 360;

const stage = document.getElementById("stage")!;
let scale = 1;

function fit(): void {
	const exact = Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);
	const whole = Math.floor(exact);
	scale = whole >= 2 && whole / exact > 0.85 ? whole : exact;
	stage.style.setProperty("--scale", String(scale));
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
