import { CARDS, type CardDef, type CardId } from "./cards";

// Deckbuilding rules. One implementation, used by the client for live feedback in the deck
// builder and by the server, which has the final say (a deck from the client is only a request).
export const DECK_SIZE = 20;
export const MAX_COPIES = 1;

/** Every card a deck may contain: all cards except tokens, which only other cards create. */
export const BUILDABLE: readonly CardId[] = (Object.keys(CARDS) as CardId[]).filter((id) => !(CARDS[id] as CardDef).token);

// The default for anyone who hasn't built a deck. It follows the same rules as built decks.
export const STARTER_DECK: readonly CardId[] = [
	"fire_salt",
	"frost_lichen",
	"nightshade",
	"wyrm_bile",
	"phoenix_feather",
	"distillate",
	"philosophers_salt",
	"bottled_spark",
	"moonwater",
	"honey_mead",
	"starlight_dust",
	"mandrake_root",
	// Disruption
	"curdle",
	"sludge_flask",
	"siphon",
	"unstable_fumes",
	"bitter_draught",
	"fog",
	"seal",
	"choking_smoke",
];

export type DeckCheck = { ok: true; deck: CardId[] } | { ok: false; reason: string };

/**
 * Is this a legal deck? Takes `unknown` because the server runs it on whatever a client sent.
 * Reports the first problem found, worded for the deck builder.
 */
export function validateDeck(list: unknown): DeckCheck {
	if (!Array.isArray(list)) return { ok: false, reason: "Not a deck" };
	const counts = new Map<CardId, number>();
	for (const id of list) {
		if (typeof id !== "string" || !(BUILDABLE as readonly string[]).includes(id)) return { ok: false, reason: "Unknown card" };
		const n = (counts.get(id as CardId) ?? 0) + 1;
		if (n > MAX_COPIES) return { ok: false, reason: `${CARDS[id as CardId].name}: max ${MAX_COPIES} ${MAX_COPIES === 1 ? "copy" : "copies"}` };
		counts.set(id as CardId, n);
	}
	if (list.length !== DECK_SIZE) return { ok: false, reason: `A deck needs exactly ${DECK_SIZE} cards (${list.length} now)` };
	return { ok: true, deck: list as CardId[] };
}
