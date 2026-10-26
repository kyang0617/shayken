// Card definitions. Cards are data, not code: the server (and later a rules engine) reads
// these, and the client imports the same file to render them.
//
// PLACEHOLDERS: the game design isn't settled, so cards only carry what's needed to deal and
// display a hand. Effects, types and tiers get added once the rules are decided.

export interface CardDef {
	id: string;
	name: string;
	cost: number;
	text: string;
}

export const CARDS = {
	fire_salt: { id: "fire_salt", name: "Fire Salt", cost: 1, text: "A pinch of something that burns." },
	frost_lichen: { id: "frost_lichen", name: "Frost Lichen", cost: 1, text: "Cold to the touch, colder to drink." },
	nightshade: { id: "nightshade", name: "Nightshade", cost: 2, text: "Handle with gloves." },
	vampire_root: { id: "vampire_root", name: "Vampire Root", cost: 2, text: "It drinks before you do." },
	troll_moss: { id: "troll_moss", name: "Troll Moss", cost: 1, text: "Grows back. Always grows back." },
	dragon_pepper: { id: "dragon_pepper", name: "Dragon Pepper", cost: 3, text: "Not for the faint of tongue." },
	mandrake_root: { id: "mandrake_root", name: "Mandrake Root", cost: 2, text: "Screams when stirred." },
	phoenix_feather: { id: "phoenix_feather", name: "Phoenix Feather", cost: 5, text: "Still warm." },
	quicksilver: { id: "quicksilver", name: "Quicksilver", cost: 2, text: "Never sits still in the flask." },
	moonwater: { id: "moonwater", name: "Moonwater", cost: 2, text: "Collected only on clear nights." },
	ghost_pepper: { id: "ghost_pepper", name: "Ghost Pepper", cost: 3, text: "You can see through it." },
	honey_mead: { id: "honey_mead", name: "Honey Mead", cost: 1, text: "Sweet, golden, deceptively strong." },
	bottled_spark: { id: "bottled_spark", name: "Bottled Spark", cost: 0, text: "Crackles when shaken." },
	starlight_dust: { id: "starlight_dust", name: "Starlight Dust", cost: 4, text: "Glows faintly in the dark." },
	wyrm_bile: { id: "wyrm_bile", name: "Wyrm Bile", cost: 4, text: "Smells exactly as you'd expect." },
} as const satisfies Record<string, CardDef>;

export type CardId = keyof typeof CARDS;

/** One physical copy of a card in a match. `iid` tells two copies of the same card apart. */
export interface CardInstance {
	iid: string;
	cardId: CardId;
}
