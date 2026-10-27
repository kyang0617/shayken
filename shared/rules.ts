// Tunable game numbers, shared so the client can display them. The turn timer length lives
// in wrangler.jsonc (`TURN_SECONDS`) instead, so tests can shorten it.

export const STARTING_HEALTH = 20;
/** Cards drawn at the start of each turn. Unplayed cards are discarded at end of turn. */
export const HAND_SIZE = 5;
/** Essence gained at the start of each turn. Unspent essence carries over; there is no cap. */
export const ESSENCE_PER_TURN = 3;
