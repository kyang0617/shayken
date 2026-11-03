// Generates the placeholder sound effects in public/sounds/: retro 8-bit blips, synthesized
// from scratch (no dependencies) in the spirit of the classic sfxr tool. Run `npm run sounds`.
// Replace any file with a real sound of the same name and nothing else needs to change.
//
// Each sound is a list of tones mixed together. A tone is one oscillator (square, triangle,
// sine, saw or noise) sliding from one pitch to another, with a quick attack and a decay.

import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 22050; // plenty for 8-bit blips, and half the file size of 44.1 kHz

// Small deterministic RNG so regenerating gives identical files (no noisy diffs).
function rng(seed) {
	return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * One tone.
 * - wave: square | triangle | sine | saw | noise
 * - f0, f1: start and end frequency in Hz (exponential slide). For noise, the low-pass cutoff.
 * - at, dur: start time and length in seconds
 * - vol: peak volume 0..1
 * - attack: seconds to reach full volume; the rest decays to silence
 * - duty: square wave pulse width (0.5 = hollow, 0.125 = thin and buzzy)
 * - vib: [rate Hz, depth fraction] pitch wobble
 * - trem: tremolo rate in Hz (volume wobble)
 * - hp: for noise, also cut lows below this cutoff (makes a hiss instead of a rumble)
 */
function tone(out, { wave, f0, f1 = f0, at = 0, dur, vol = 0.5, attack = 0.005, duty = 0.5, vib, trem, hp, seed = 1 }) {
	const start = Math.floor(at * RATE), n = Math.floor(dur * RATE);
	const rand = rng(seed);
	let phase = 0, low = 0, low2 = 0;
	for (let i = 0; i < n && start + i < out.length; i++) {
		const t = i / n; // 0..1 through the tone
		let f = f0 * (f1 / f0) ** t;
		if (vib) f *= 1 + Math.sin((2 * Math.PI * vib[0] * i) / RATE) * vib[1];
		phase = (phase + f / RATE) % 1;
		let s;
		switch (wave) {
			case "square": s = phase < duty ? 1 : -1; break;
			case "triangle": s = 1 - 4 * Math.abs(phase - 0.5); break;
			case "sine": s = Math.sin(2 * Math.PI * phase); break;
			case "saw": s = 2 * phase - 1; break;
			case "noise": {
				// White noise through a one-pole low-pass at `f` (and optionally a high-pass).
				const x = rand() * 2 - 1;
				low += (1 - Math.exp((-2 * Math.PI * f) / RATE)) * (x - low);
				s = low;
				if (hp) {
					low2 += (1 - Math.exp((-2 * Math.PI * hp) / RATE)) * (low - low2);
					s = low - low2;
				}
				s *= 2; // filtering loses level; bring it back up
				break;
			}
		}
		const secs = i / RATE;
		let env = secs < attack ? secs / attack : (1 - t) ** 2;
		if (trem) env *= 0.6 + 0.4 * Math.sin(2 * Math.PI * trem * secs);
		out[start + i] += s * env * vol;
	}
}

/** A run of notes, one after another: [frequency, seconds] pairs. */
function notes(out, list, opts) {
	let at = opts.at ?? 0;
	for (const [f, dur] of list) {
		tone(out, { ...opts, f0: f, at, dur });
		at += dur;
	}
}

// ---- The sounds ----

const SOUNDS = {
	click: { dur: 0.04, make: (o) => tone(o, { wave: "square", f0: 900, f1: 600, dur: 0.04, vol: 0.2, duty: 0.25 }) },
	card: { // a card slapped down
		dur: 0.1,
		make: (o) => {
			tone(o, { wave: "noise", f0: 6000, hp: 1500, dur: 0.07, vol: 0.5 });
			tone(o, { wave: "square", f0: 420, f1: 260, dur: 0.06, vol: 0.12, duty: 0.25 });
		},
	},
	draw: { dur: 0.06, make: (o) => tone(o, { wave: "noise", f0: 8000, hp: 3000, dur: 0.05, vol: 0.35, seed: 7 }) },
	plop: { // an ingredient dropping into the cauldron
		dur: 0.18,
		make: (o) => {
			tone(o, { wave: "sine", f0: 180, f1: 520, dur: 0.09, vol: 0.5 });
			tone(o, { wave: "sine", f0: 300, f1: 700, at: 0.07, dur: 0.08, vol: 0.25 });
		},
	},
	power: { dur: 0.32, make: (o) => notes(o, [[440, 0.06], [554, 0.06], [659, 0.06], [880, 0.14]], { wave: "square", vol: 0.15, duty: 0.25 }) },
	whoosh: { dur: 0.35, make: (o) => tone(o, { wave: "noise", f0: 400, f1: 3000, dur: 0.35, vol: 0.5, attack: 0.2, seed: 3 }) },
	splash: {
		dur: 0.45,
		make: (o) => {
			tone(o, { wave: "noise", f0: 3000, f1: 600, dur: 0.45, vol: 0.45, seed: 5 });
			tone(o, { wave: "sine", f0: 220, f1: 60, dur: 0.2, vol: 0.5 });
		},
	},
	shield: { // a shield step cracking
		dur: 0.35,
		make: (o) => {
			tone(o, { wave: "square", f0: 1800, f1: 400, dur: 0.3, vol: 0.15, duty: 0.125 });
			tone(o, { wave: "noise", f0: 9000, hp: 4000, dur: 0.15, vol: 0.4, seed: 11 });
		},
	},
	explode: {
		dur: 0.8,
		make: (o) => {
			tone(o, { wave: "noise", f0: 2500, f1: 150, dur: 0.8, vol: 0.6, seed: 13 });
			tone(o, { wave: "square", f0: 110, f1: 30, dur: 0.5, vol: 0.25 });
		},
	},
	fuse: { dur: 0.6, make: (o) => tone(o, { wave: "noise", f0: 7000, hp: 2500, dur: 0.6, vol: 0.35, attack: 0.05, trem: 18, seed: 17 }) },
	hex: { // something nasty landing on the opponent's next turn
		dur: 0.5,
		make: (o) => {
			tone(o, { wave: "square", f0: 330, f1: 140, dur: 0.45, vol: 0.14, duty: 0.25, vib: [9, 0.06] });
			tone(o, { wave: "triangle", f0: 165, f1: 70, dur: 0.5, vol: 0.3, vib: [6, 0.04] });
		},
	},
	essence: { dur: 0.16, make: (o) => notes(o, [[1320, 0.05], [1760, 0.1]], { wave: "triangle", vol: 0.25 }) },
	turn: { dur: 0.3, make: (o) => notes(o, [[660, 0.09], [880, 0.2]], { wave: "square", vol: 0.13, duty: 0.25 }) },
	tick: { dur: 0.03, make: (o) => tone(o, { wave: "square", f0: 1400, dur: 0.025, vol: 0.12, duty: 0.25 }) },
	win: { dur: 0.95, make: (o) => notes(o, [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.6]], { wave: "square", vol: 0.15, duty: 0.25 }) },
	lose: { dur: 1.2, make: (o) => notes(o, [[392, 0.22], [330, 0.22], [262, 0.22], [196, 0.5]], { wave: "triangle", vol: 0.35, vib: [5, 0.02] }) },
};

// ---- WAV writing: 16-bit mono PCM ----

function wav(samples) {
	const buf = Buffer.alloc(44 + samples.length * 2);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + samples.length * 2, 4);
	buf.write("WAVEfmt ", 8);
	buf.writeUInt32LE(16, 16); // fmt chunk size
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(RATE, 24);
	buf.writeUInt32LE(RATE * 2, 28); // bytes per second
	buf.writeUInt16LE(2, 32); // bytes per frame
	buf.writeUInt16LE(16, 34); // bits per sample
	buf.write("data", 36);
	buf.writeUInt32LE(samples.length * 2, 40);
	samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
	return buf;
}

const dir = new URL("../public/sounds/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, { dur, make }] of Object.entries(SOUNDS)) {
	const samples = new Float32Array(Math.ceil(dur * RATE));
	make(samples);
	// Noise is spiky, so instead of hand-tuning volumes until nothing clips, scale any sound
	// that peaks too high back down.
	const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
	if (peak > 0.9) samples.forEach((s, i) => (samples[i] = (s * 0.9) / peak));
	const file = wav(samples);
	writeFileSync(new URL(`${name}.wav`, dir), file);
	console.log(`${(name + ".wav").padEnd(14)} ${(file.length / 1024).toFixed(1)} KB`);
}
