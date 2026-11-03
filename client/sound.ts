// Sound effects. Purely cosmetic, like anim.ts: sounds are picked by comparing the previous view
// with the new one, and nothing waits for them. Files are public/sounds/<name>.wav (placeholders
// from scripts/sounds.mjs; swap in real ones of the same name).
//
// Web Audio rather than <audio> tags: each file is decoded once into a buffer, and every play is
// a cheap new source on it, so sounds start instantly and can overlap (five draws at once).
// Browsers block sound until the player interacts with the page, so the AudioContext is only
// created on the first click or key press. Math.random is fine here: it's decoration.

import type { PlayerView, PublicPlayerView } from "../shared/protocol";

const NAMES = [
	"click", "card", "draw", "plop", "power", "whoosh", "splash", "shield",
	"explode", "fuse", "hex", "essence", "turn", "tick", "win", "lose",
] as const;
export type Sound = (typeof NAMES)[number];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<Sound, AudioBuffer>();

function unlock(): void {
	if (!ctx) {
		ctx = new AudioContext();
		master = ctx.createGain();
		master.connect(ctx.destination);
		applyVolume();
		for (const name of NAMES) {
			fetch(`/sounds/${name}.wav`)
				.then((r) => r.arrayBuffer())
				.then((data) => ctx!.decodeAudioData(data))
				.then((buf) => buffers.set(name, buf))
				.catch(() => {}); // a missing sound just stays silent
		}
	}
	if (ctx.state === "suspended") void ctx.resume();
}
addEventListener("pointerdown", unlock);
addEventListener("keydown", unlock);

interface PlayOpts {
	delay?: number; // ms from now, to line up with an animation
	volume?: number; // 0..1, relative to the master volume
	vary?: number; // random pitch spread, so repeats don't sound robotic
}

export function play(name: Sound, { delay = 0, volume = 1, vary = 0.05 }: PlayOpts = {}): void {
	const buf = buffers.get(name);
	if (!ctx || !master || !buf || settings.muted || ctx.state !== "running") return;
	const src = ctx.createBufferSource();
	src.buffer = buf;
	src.playbackRate.value = 1 + (Math.random() * 2 - 1) * vary;
	const gain = ctx.createGain();
	gain.gain.value = volume;
	src.connect(gain).connect(master);
	src.start(ctx.currentTime + delay / 1000);
}

// ---- Mute and volume (top right) ----
// A per-player preference, so it lives in localStorage. Storage can be unavailable (private
// windows, blocked site data), so every access is wrapped and the defaults still work.

const KEY = "shayken:sound";
const settings: { muted: boolean; volume: number } = { muted: false, volume: 0.7 };
try {
	Object.assign(settings, JSON.parse(localStorage.getItem(KEY) ?? "{}"));
} catch {}

const muteBtn = document.getElementById("mute-btn") as HTMLButtonElement;
const slider = document.getElementById("volume") as HTMLInputElement;

function applyVolume(): void {
	// Squared: loudness is perceived roughly logarithmically, so a linear slider feels top-heavy.
	if (master) master.gain.value = settings.muted ? 0 : settings.volume ** 2;
	muteBtn.classList.toggle("off", settings.muted || settings.volume === 0);
	muteBtn.title = settings.muted ? "Unmute" : "Mute";
	slider.value = String(Math.round(settings.volume * 100));
	try {
		localStorage.setItem(KEY, JSON.stringify(settings));
	} catch {}
}
applyVolume();

muteBtn.addEventListener("click", () => {
	settings.muted = !settings.muted;
	applyVolume();
});
slider.addEventListener("input", () => {
	settings.volume = Number(slider.value) / 100;
	settings.muted = false;
	applyVolume();
});

// Every button clicks.
document.addEventListener("click", (e) => {
	if ((e.target as Element).closest(".btn")) play("click", { vary: 0 });
});

// ---- What just happened -> which sounds ----

/**
 * Call after each new view with the previous one. `impactAt` is when the throw animation lands
 * (0 with reduced motion), so the splash and the hit sound line up with it.
 */
export function playCues(prev: PlayerView | null, view: PlayerView, impactAt: number): void {
	if (!prev || prev.roomCode !== view.roomCode) return;
	const me = view.you, pm = prev.you;
	const opp = view.opponent, po = prev.opponent;
	const sameTurn = !!view.turn && view.turn.number === prev.turn?.number;
	const oppSeat = me.seat === 0 ? 1 : 0;

	// Cards played this turn, by either side.
	const prevHand = new Set(pm.hand.map((c) => c.iid));
	const nowHand = new Set(me.hand.map((c) => c.iid));
	const iPlayed = sameTurn && view.turn!.seat === me.seat && pm.hand.some((c) => !nowHand.has(c.iid));
	const theyPlayed = sameTurn && view.turn!.seat === oppSeat && !!opp && !!po &&
		(opp.handCount < po.handCount || opp.discardCount > po.discardCount || opp.brew.length > po.brew.length || opp.powers.length > po.powers.length);
	if (iPlayed || theyPlayed) play("card");

	// Where played cards land.
	const added = (now: { iid: string }[], before: { iid: string }[]) => now.some((c) => !before.some((b) => b.iid === c.iid));
	if (added(me.brew, pm.brew) || (opp && po && added(opp.brew, po.brew))) play("plop", { delay: 300 });
	if (added(me.powers, pm.powers) || (opp && po && added(opp.powers, po.powers))) play("power", { delay: 300 });

	// Drawn cards, one flick each, timed like the draw animation.
	me.hand.filter((c) => !prevHand.has(c.iid)).slice(0, 7).forEach((_, i) => play("draw", { delay: 150 + i * 70 }));

	// Disruption landing on either player.
	const throwNew = !!view.lastThrow && (view.lastThrow.turn !== prev.lastThrow?.turn || view.lastThrow.seat !== prev.lastThrow?.seat);
	const x = view.lastExplosion;
	const explosionNew = !!x && (x.turn !== prev.lastExplosion?.turn || x.seat !== prev.lastExplosion?.seat);
	const sides: [PublicPlayerView | null, PublicPlayerView | null, number][] = [[me, pm, me.seat], [opp, po, oppSeat]];
	let hexed = false, fused = false;
	for (const [now, before, seat] of sides) {
		if (!now || !before) continue;
		const h = now.nextHexes, b = before.nextHexes;
		if (h.costUp > b.costUp || (h.drawLimit !== null && h.drawLimit !== b.drawLimit) || (h.sealed && !b.sealed)) hexed = true;
		const theirTurn = view.turn?.seat === seat;
		if (sameTurn && !theirTurn && now.essence < before.essence) hexed = true; // drained
		if (sameTurn && !throwNew && !explosionNew && now.brew.length < before.brew.length) hexed = true; // curdled
		if (now.explodesOnTurn !== null && before.explodesOnTurn === null) fused = true;
	}
	if (hexed) play("hex", { delay: 150 });
	if (fused) play("fuse", { delay: 150 });

	// Throws and explosions.
	if (throwNew) {
		play("whoosh");
		play("splash", { delay: impactAt });
		if (me.shield < pm.shield || (opp && po && opp.shield < po.shield)) play("shield", { delay: impactAt + 80 });
	}
	if (explosionNew) play("explode", { vary: 0 });

	if (me.essence > pm.essence) play("essence", { delay: 100, volume: 0.6 });
	if (view.status === "playing" && view.turn?.seat === me.seat && view.turn.number !== prev.turn?.number) play("turn", { delay: impactAt, vary: 0 });
	if (view.status === "finished" && prev.status !== "finished") play(view.winner === me.seat ? "win" : "lose", { delay: impactAt + 300, vary: 0 });
}
