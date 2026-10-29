// Tunable game numbers, shared so the client can display them. The turn timer length lives
// in wrangler.jsonc (`TURN_SECONDS`) instead, so tests can shorten it.

export const STARTING_HEALTH = 40;
/**
 * Spell shield: the percentage of throw damage blocked. Everyone starts on the first step and
 * drops one step each time a damaging throw hits them; the last step means no shield. It
 * softens the first big combo whoever lands it, and makes small early throws worth something
 * (they strip a step before your real combo).
 */
export const SHIELD_STEPS: readonly number[] = [50, 25, 0];
/** Cards drawn at the start of each turn. Unplayed cards are discarded at end of turn. */
export const HAND_SIZE = 5;
/** Essence gained at the start of each turn. Unspent essence carries over; there is no cap. */
export const ESSENCE_PER_TURN = 3;
