// All randomness lives on the server. `crypto.getRandomValues` is a cryptographically secure
// source, unlike Math.random(), so players can't predict shuffles or guess tokens/codes.

/** Uniform integer in [0, max). Rejection sampling avoids the bias of a plain `% max`. */
export function randomInt(max: number): number {
	const limit = Math.floor(0x1_0000_0000 / max) * max;
	const buf = new Uint32Array(1);
	do {
		crypto.getRandomValues(buf);
	} while (buf[0] >= limit);
	return buf[0] % max;
}

/** Fisher–Yates shuffle (in place). Every ordering is equally likely. */
export function shuffle<T>(items: T[]): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

// No 0/O or 1/I, so codes are easy to read aloud and type.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function randomRoomCode(): string {
	let code = "";
	for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
	return code;
}

/** Secret player token: 122 random bits, unguessable. */
export function randomToken(): string {
	return crypto.randomUUID();
}
