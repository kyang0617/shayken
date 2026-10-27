// Card definitions. Cards are data, not code: the rules engine (src/rules.ts) interprets
// `effects`, and the client imports the same file to render cards.
//
// Card types (inspired by deckbuilder roguelikes):
// - attack: goes into your brew as an ingredient. What a thrown brew does is not designed yet.
// - skill:  one-off effect when played, then discarded. May also add itself to the brew.
// - power:  played once, stays active for the rest of the match.
//
// Names, costs and numbers are placeholders until the design settles.

export type CardType = "attack" | "skill" | "power";

export type Effect =
	/** This card goes into your brew instead of the discard pile. */
	| { kind: "addToBrew" }
	| { kind: "gainEssence"; amount: number }
	| { kind: "draw"; amount: number }
	/** Power only: applied at the start of each of your turns while the power is active. */
	| { kind: "essencePerTurn"; amount: number }
	/** Power only: extra cards drawn at the start of each of your turns. */
	| { kind: "drawPerTurn"; amount: number };

export interface CardDef {
	id: string;
	name: string;
	type: CardType;
	cost: number;
	text: string;
	effects: readonly Effect[];
}

const brew = { kind: "addToBrew" } as const;

export const CARDS = {
	// ---- Attacks: ingredients for the brew ----
	fire_salt: { id: "fire_salt", name: "Fire Salt", type: "attack", cost: 1, text: "Add to your brew.", effects: [brew] },
	frost_lichen: { id: "frost_lichen", name: "Frost Lichen", type: "attack", cost: 1, text: "Add to your brew.", effects: [brew] },
	nightshade: { id: "nightshade", name: "Nightshade", type: "attack", cost: 2, text: "Add to your brew.", effects: [brew] },
	vampire_root: { id: "vampire_root", name: "Vampire Root", type: "attack", cost: 2, text: "Add to your brew.", effects: [brew] },
	dragon_pepper: { id: "dragon_pepper", name: "Dragon Pepper", type: "attack", cost: 2, text: "Add to your brew.", effects: [brew] },
	ghost_pepper: { id: "ghost_pepper", name: "Ghost Pepper", type: "attack", cost: 2, text: "Add to your brew. Draw 1.", effects: [brew, { kind: "draw", amount: 1 }] },
	wyrm_bile: { id: "wyrm_bile", name: "Wyrm Bile", type: "attack", cost: 3, text: "Add to your brew.", effects: [brew] },
	phoenix_feather: { id: "phoenix_feather", name: "Phoenix Feather", type: "attack", cost: 3, text: "Add to your brew.", effects: [brew] },

	// ---- Skills: immediate effects ----
	bottled_spark: { id: "bottled_spark", name: "Bottled Spark", type: "skill", cost: 0, text: "Gain 1 essence.", effects: [{ kind: "gainEssence", amount: 1 }] },
	moonwater: { id: "moonwater", name: "Moonwater", type: "skill", cost: 1, text: "Gain 2 essence.", effects: [{ kind: "gainEssence", amount: 2 }] },
	honey_mead: { id: "honey_mead", name: "Honey Mead", type: "skill", cost: 1, text: "Draw 2.", effects: [{ kind: "draw", amount: 2 }] },
	quicksilver: { id: "quicksilver", name: "Quicksilver", type: "skill", cost: 1, text: "Add to your brew. Gain 1 essence.", effects: [brew, { kind: "gainEssence", amount: 1 }] },
	troll_moss: { id: "troll_moss", name: "Troll Moss", type: "skill", cost: 0, text: "Add to your brew. Draw 1.", effects: [brew, { kind: "draw", amount: 1 }] },

	// ---- Powers: last the whole match ----
	starlight_dust: { id: "starlight_dust", name: "Starlight Dust", type: "power", cost: 2, text: "Each turn: gain 1 extra essence.", effects: [{ kind: "essencePerTurn", amount: 1 }] },
	mandrake_root: { id: "mandrake_root", name: "Mandrake Root", type: "power", cost: 3, text: "Each turn: draw 1 extra card.", effects: [{ kind: "drawPerTurn", amount: 1 }] },
} as const satisfies Record<string, CardDef>;

export type CardId = keyof typeof CARDS;

/** One physical copy of a card in a match. `iid` tells two copies of the same card apart. */
export interface CardInstance {
	iid: string;
	cardId: CardId;
}
