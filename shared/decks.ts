import type { CardId } from "./cards";

// Over the planned 20 for now: every card goes in until deckbuilding exists.
export const DECK_SIZE = 28;

// V1: both players get the same fixed list. The server copies and shuffles it per player.
export const STARTER_DECK: readonly CardId[] = [
	"fire_salt", "fire_salt",
	"frost_lichen",
	"nightshade",
	"vampire_root",
	"dragon_pepper",
	"ghost_pepper",
	"wyrm_bile",
	"phoenix_feather",
	"distillate",
	"philosophers_salt",
	"bottled_spark", "bottled_spark",
	"moonwater",
	"honey_mead", "honey_mead",
	"quicksilver",
	"troll_moss",
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
