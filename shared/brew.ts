// How much damage a brew deals when thrown. Shared so the server (which resolves the throw)
// and the client (which previews it) can never disagree about the formula.

import { CARDS, type CardDef, type CardInstance } from "./cards";

/**
 * Ingredients resolve one at a time, in the order they were added (brew[0] first), against
 * a running total. So order matters:
 * - `damage`: adds to the total.
 * - `damagePerIngredient`: adds amount × this ingredient's position (1-based), i.e. per
 *   ingredient added so far, itself included. Worth more the later it's added.
 * - `multiplyDamage`: multiplies the total so far. Ingredients added after it aren't affected.
 * Example: Fire Salt, Nightshade, Philosopher's Salt = (2 + 3) × 2 = 10, but
 *          Philosopher's Salt, Fire Salt, Nightshade = 0 × 2 + 2 + 3 = 5.
 */
export function brewDamage(brew: readonly CardInstance[]): number {
	let total = 0;
	brew.forEach((card, i) => {
		const def: CardDef = CARDS[card.cardId];
		for (const effect of def.onThrow ?? []) {
			switch (effect.kind) {
				case "damage":
					total += effect.amount;
					break;
				case "damagePerIngredient":
					total += effect.amount * (i + 1);
					break;
				case "multiplyDamage":
					total *= effect.factor;
					break;
			}
		}
	});
	return total;
}
