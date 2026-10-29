// Placeholder pixel art. Writes PNGs into public/sprites/ — run `npm run sprites` after editing.
//
// Every file here is meant to be replaced by real art (e.g. an itch.io pack): keep the file
// name and size and the client picks it up with no code change. Card art is looked up by card
// id (sprites/cards/<id>.png), so a new card only needs a new 16×16 image.
//
// No dependencies: sprites are drawn into RGBA buffers and encoded with node's zlib.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = new URL("../public/sprites/", import.meta.url);
const OUTLINE = "#1a1020";

// ---- Tiny image + PNG encoder ----

function image(w, h) {
	return { w, h, px: new Array(w * h).fill(null) }; // null = transparent, else "#rrggbb"
}
const get = (img, x, y) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? null : img.px[y * img.w + x]);
const set = (img, x, y, c) => { if (x >= 0 && y >= 0 && x < img.w && y < img.h) img.px[y * img.w + x] = c; };

/** Give every filled shape a 1px dark outline (4-neighbourhood), like the reference art. */
function outline(img, color = OUTLINE) {
	const add = [];
	for (let y = 0; y < img.h; y++)
		for (let x = 0; x < img.w; x++)
			if (!get(img, x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(img, x + dx, y + dy))) add.push([x, y]);
	for (const [x, y] of add) set(img, x, y, color);
	return img;
}

/** Lay frames side by side into one sprite sheet (animated in CSS with steps()). */
function sheet(frames) {
	const out = image(frames[0].w * frames.length, frames[0].h);
	frames.forEach((f, i) => { for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) set(out, i * f.w + x, y, get(f, x, y)); });
	return out;
}

/** Text pixel map → image. `.` is transparent; every other char is looked up in `palette`. */
function fromMap(rows, palette) {
	const w = rows[0].length;
	rows.forEach((r, i) => { if (r.length !== w) throw new Error(`row ${i} is ${r.length} wide, expected ${w}: "${r}"`); });
	const img = image(w, rows.length);
	rows.forEach((r, y) => [...r].forEach((ch, x) => {
		if (ch === ".") return;
		if (!(ch in palette)) throw new Error(`no colour for "${ch}"`);
		set(img, x, y, palette[ch]);
	}));
	return img;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}
function png(img) {
	const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
	for (let y = 0; y < img.h; y++) {
		raw[y * (img.w * 4 + 1)] = 0; // filter: none
		for (let x = 0; x < img.w; x++) {
			const c = get(img, x, y), o = y * (img.w * 4 + 1) + 1 + x * 4;
			if (c) { raw[o] = parseInt(c.slice(1, 3), 16); raw[o + 1] = parseInt(c.slice(3, 5), 16); raw[o + 2] = parseInt(c.slice(5, 7), 16); raw[o + 3] = 255; }
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4);
	ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function save(name, img) {
	const url = new URL(name, OUT);
	mkdirSync(new URL(".", url), { recursive: true });
	writeFileSync(url, png(img));
	console.log(`${name.padEnd(28)} ${img.w}×${img.h}`);
}

// Small deterministic RNG so regenerating gives identical files (no noisy diffs).
function rng(seed) {
	return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// ---- Card art: 16×16. A few shapes, recoloured per card. ----
// o outline · 1 dark · 2 mid · 3 light · w highlight

const SHAPES = {
	crystal: [
		"................",
		".......oo.......",
		"......ow3o......",
		".....ow32o......",
		".....o3322o.....",
		"....o33221o.....",
		"....o32221o.oo..",
		"...o332211oo3o..",
		"...o322211o32o..",
		"..o3322111o21o..",
		"..o3222111o21o..",
		"..o222111oo11o..",
		".oo22211oo1111o.",
		"o3322211o22111o.",
		"o2222111122211o.",
		".oooooooooooooo.",
	],
	mushroom: [
		"................",
		".....oooooo.....",
		"...oo3w33322o...",
		"..o3ww3332222o..",
		".o33w33322w221o.",
		".o3333222222211o",
		"o33322w2221111o.",
		"o22222221111111o",
		".oo111111111ooo.",
		"...oooo33oooo...",
		"......o33o......",
		"......o32o......",
		".....o3322o.....",
		".....o3221o.....",
		"......oooo......",
		"................",
	],
	root: [
		"................",
		"......oooo......",
		".....o3w32o.....",
		"....o332221o....",
		"....o322211o....",
		".....o22211o....",
		"......o2211o....",
		"......o221o.....",
		".....o2211o.....",
		"....o1o21o......",
		"...o1o.o21o.....",
		"..o1o..o1o.o....",
		"..oo...o1oo1o...",
		".......o11o1o...",
		"........oo.o....",
		"................",
	],
	pepper: [
		"................",
		".........oo.....",
		"........o11o....",
		".......o1oo.....",
		".....ooo1oo.....",
		"....o3w322o.....",
		"...o3w32221o....",
		"...o332221o.....",
		"..o3322211o.....",
		"..o322211o......",
		".o322211o.......",
		".o22211o........",
		"o22111o.........",
		"o2111oo.........",
		".ooo............",
		"................",
	],
	drop: [
		"................",
		".......oo.......",
		"......o33o......",
		"......o32o......",
		".....o3322o.....",
		".....o3w22o.....",
		"....o3w3221o....",
		"....o332221o....",
		"...o33222211o...",
		"...o32222211o...",
		"...o32222111o...",
		"...o22221111o...",
		"....o221111o....",
		".....oo11oo.....",
		".......oo.......",
		"................",
	],
	feather: [
		"................",
		"...........ooo..",
		".........oo33o..",
		"........o3w32o..",
		".......o3w322o..",
		"......o33221o...",
		".....o33221o....",
		"....o32221o.....",
		"...o32211o......",
		"...o2211o.......",
		"..o2111o........",
		"..o111o.........",
		".o1ooo..........",
		".o1o............",
		"o1o.............",
		"oo..............",
	],
	bottle: [
		"................",
		"......oooo......",
		"......o11o......",
		".......oo.......",
		"......ow3o......",
		"......ow3o......",
		".....ow333o.....",
		"....ow33333o....",
		"...ow2222222o...",
		"...o32222221o...",
		"...o22222211o...",
		"...o22222111o...",
		"...o22221111o...",
		"....o221111o....",
		".....oooooo.....",
		"................",
	],
	star: [
		"................",
		".......oo.......",
		".......o3o......",
		"......o3w2o.....",
		"......o322o.....",
		".ooooo33222oooo.",
		".o3ww3322222221o",
		"..o33322222211o.",
		"...o332222211o..",
		"....o3222211o...",
		"....o3221111o...",
		"...o321o..o211o.",
		"...o31o....o11o.",
		"..o2oo......oo1o",
		"..oo..........oo",
		"................",
	],
};

const pal = (d, m, l, w) => ({ o: OUTLINE, 1: d, 2: m, 3: l, w });
const CARD_ART = {
	fire_salt: ["crystal", pal("#8a1f2a", "#d23c3c", "#ff7a5c", "#ffd0b0")],
	philosophers_salt: ["crystal", pal("#8a5a12", "#d99a1e", "#ffd34d", "#fff4c0")],
	frost_lichen: ["mushroom", pal("#1f5a7a", "#3ba0c8", "#7ee0f0", "#e0ffff")],
	nightshade: ["mushroom", pal("#3d1a5a", "#7a3ca8", "#b77ae0", "#f0d8ff")],
	troll_moss: ["mushroom", pal("#2a5a1f", "#4f9a2e", "#8fd04a", "#e0ffb0")],
	vampire_root: ["root", pal("#4a0f1f", "#8a1f3a", "#c84a5a", "#ffb0b8")],
	mandrake_root: ["root", pal("#5a3a1f", "#9a6a3a", "#d0a060", "#fff0c8")],
	dragon_pepper: ["pepper", pal("#7a1414", "#d03020", "#ff7040", "#ffd0a0")],
	ghost_pepper: ["pepper", pal("#5a5a7a", "#b0b0d0", "#e8e8ff", "#ffffff")],
	wyrm_bile: ["drop", pal("#2a4a12", "#5a9a1e", "#a0e040", "#f0ffc0")],
	quicksilver: ["drop", pal("#4a5060", "#8a95a8", "#c8d0e0", "#ffffff")],
	phoenix_feather: ["feather", pal("#8a2a0a", "#e06010", "#ffb030", "#fff0a0")],
	distillate: ["bottle", pal("#1f3a6a", "#3a70c0", "#a0d0ff", "#ffffff")],
	bottled_spark: ["bottle", pal("#7a5a0a", "#e0b020", "#ffe060", "#ffffff")],
	moonwater: ["bottle", pal("#2a2a7a", "#4a5ad0", "#a0b0ff", "#ffffff")],
	honey_mead: ["bottle", pal("#6a3a0a", "#c07a1a", "#f0b040", "#fff0c0")],
	starlight_dust: ["star", pal("#7a6a1a", "#e0c040", "#fff080", "#ffffff")],
};
for (const [id, [shape, palette]] of Object.entries(CARD_ART)) save(`cards/${id}.png`, fromMap(SHAPES[shape], palette));

// ---- Cauldron: 48×36, 3-frame bubbling sheet, one per player colour ----

function cauldronFrame(liquid, frame) {
	const W = 48, H = 36, cx = 23.5;
	const img = image(W, H);
	const iron = { dark: "#262433", mid: "#3d3a52", light: "#5f5b7d", rim: "#8580a8", rimDark: "#4d4966" };
	const inEll = (x, y, ex, ey, rx, ry) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 <= 1;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const px = x + 0.5, py = y + 0.5;
			// legs
			if (py > 29 && py < 34 && (Math.abs(px - 12) < 2.5 || Math.abs(px - 35) < 2.5)) set(img, x, y, iron.dark);
			// pot body
			if (py >= 10 && inEll(px, py, cx, 18, 20, 13)) {
				const t = (px - cx) / 20;
				let c = iron.mid;
				if (t < -0.55 || (t < -0.2 && py < 16)) c = iron.light;
				else if (t > 0.45 || py > 26) c = iron.dark;
				set(img, x, y, c);
			}
			// rim (drawn over the body's top)
			if (inEll(px, py, cx, 10, 22, 5)) set(img, x, y, py < 10 ? iron.rim : iron.rimDark);
			// liquid surface inside the rim
			if (inEll(px, py, cx, 10, 18, 3)) set(img, x, y, py < 9 ? liquid.light : liquid.mid);
		}
	// surface shine
	for (const [x, y] of [[13, 8], [14, 8], [15, 8]]) set(img, x, y, liquid.shine);
	// bubbles: rise and pop above the rim across the frames
	const bubbles = [
		[[30, 9, 1], [19, 10, 0], [36, 4, 0]],
		[[30, 6, 1], [19, 9, 1], [25, 10, 0]],
		[[31, 2, 0], [20, 5, 1], [25, 9, 1]],
	][frame];
	for (const [bx, by, big] of bubbles) {
		set(img, bx, by, liquid.light);
		if (big) { set(img, bx + 1, by, liquid.light); set(img, bx, by - 1, liquid.shine); set(img, bx + 1, by - 1, liquid.light); }
	}
	return outline(img);
}
const LIQUIDS = {
	green: { mid: "#3f9a2e", light: "#79d84a", shine: "#d8ffb0" },
	purple: { mid: "#7a3cb0", light: "#b56ae8", shine: "#f0d0ff" },
};
for (const [name, liquid] of Object.entries(LIQUIDS)) save(`cauldron-${name}.png`, sheet([0, 1, 2].map((f) => cauldronFrame(liquid, f))));

// ---- Portraits: 32×32 wizard heads ----

function portrait(hat, hatDark, robe) {
	const img = image(32, 32);
	const skin = "#f0c09a", skinDark = "#c88a6a", beard = "#e8e4f0", beardDark = "#a8a4c0";
	for (let y = 0; y < 32; y++)
		for (let x = 0; x < 32; x++) {
			const px = x + 0.5, py = y + 0.5;
			if (py > 24 && Math.abs(px - 16) < 12 - (31 - py) * 0.3) set(img, x, y, robe); // shoulders
			if (((px - 16) / 7) ** 2 + ((py - 17) / 7) ** 2 <= 1) set(img, x, y, px > 19 ? skinDark : skin); // face
			if (py > 18 && py < 29 && Math.abs(px - 16) < (29 - py) * 0.75) set(img, x, y, px > 18 ? beardDark : beard); // beard
			if (py > 2 && py < 12 && Math.abs(px - 16 - (12 - py) * 0.4) < (py - 2) * 0.7) set(img, x, y, px > 17 ? hatDark : hat); // hat cone
			if (py >= 11 && py < 14 && Math.abs(px - 16) < 13) set(img, x, y, py < 12 ? hat : hatDark); // brim
		}
	for (const ey of [15, 16]) { set(img, 13, ey, OUTLINE); set(img, 18, ey, OUTLINE); } // eyes
	set(img, 16, 6, "#ffe060"); set(img, 15, 8, "#ffe060"); // hat stars
	return outline(img);
}
save("portrait-blue.png", portrait("#3a5ad0", "#26389a", "#26389a"));
save("portrait-red.png", portrait("#c83a3a", "#8a2028", "#8a2028"));

// ---- Floor: 32×32 tileable dungeon stone ----

{
	const img = image(32, 32), r = rng(7);
	const base = ["#3a2e3f", "#41334a", "#352a3a"], mortar = "#211a26", edge = "#4c3d55";
	const blocks = [[0, 0, 16, 16], [16, 0, 16, 16], [8, 16, 16, 16], [24, 16, 16, 16], [-8, 16, 16, 16]];
	for (const [bx, by, bw, bh] of blocks) {
		const c = base[Math.floor(r() * base.length)];
		for (let y = by; y < by + bh; y++)
			for (let x = bx; x < bx + bw; x++) {
				const wx = (x + 32) % 32;
				const onMortar = x === bx || y === by;
				set(img, wx, y, onMortar ? mortar : y === by + 1 ? edge : r() < 0.06 ? base[2] : c);
			}
	}
	save("floor.png", img);
}

// ---- Torch: 10×20, 3-frame flicker ----

function torch(frame) {
	const img = image(10, 20);
	for (let y = 11; y < 19; y++) for (let x = 4; x < 6; x++) set(img, x, y, y < 13 ? "#8a8aa0" : "#5a3a24"); // sconce + stick
	const lean = [0, 1, -1][frame], top = [2, 1, 3][frame];
	for (let y = top; y < 11; y++)
		for (let x = 0; x < 10; x++) {
			const halfW = ((y - top) / (11 - top)) * 3.2;
			const off = x + 0.5 - 5 - lean * (1 - (y - top) / (11 - top));
			if (Math.abs(off) <= halfW) set(img, x, y, Math.abs(off) < halfW * 0.45 && y > top + 2 ? "#fff0a0" : y > 7 ? "#ff9a2a" : "#ff6a1a");
		}
	return outline(img);
}
save("torch.png", sheet([0, 1, 2].map(torch)));

// ---- Small icons ----

save("heart.png", fromMap([
	".oo.oo.",
	"o33o22o",
	"o3w2221",
	"o222221",
	".o2221.",
	"..o21..",
	"...1...",
].map((r) => r.replace(/1/g, "o")), { o: OUTLINE, 2: "#d83a4a", 3: "#ff7a7a", w: "#ffffff" }));
save("essence.png", fromMap([
	"...o...",
	"..o3o..",
	".o3w2o.",
	"o32222o",
	"o22221o",
	"o22211o",
	".o211o.",
	"..ooo..",
], { o: OUTLINE, 1: "#2a5ab0", 2: "#4a8af0", 3: "#9ad0ff", w: "#ffffff" }));
