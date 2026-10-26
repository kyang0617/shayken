import type { CardId } from "./cards";

export const DECK_SIZE = 20;
export const STARTING_HAND_SIZE = 5;

// V1: both players get the same fixed list. The server copies and shuffles it per player.
export const STARTER_DECK: readonly CardId[] = [
	"fire_salt", "fire_salt",
	"frost_lichen", "frost_lichen",
	"nightshade",
	"vampire_root",
	"troll_moss", "troll_moss",
	"dragon_pepper",
	"mandrake_root",
	"phoenix_feather",
	"quicksilver",
	"moonwater",
	"ghost_pepper",
	"honey_mead", "honey_mead",
	"bottled_spark", "bottled_spark",
	"starlight_dust",
	"wyrm_bile",
];
