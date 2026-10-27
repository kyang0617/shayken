// How much damage a brew deals when thrown. Shared so the server (which resolves the throw)
// and the client (which previews it) can never disagree about the formula.

import { CARDS, type CardDef, type CardInstance } from "./cards";

/**
 * (sum of `damage` + sum of `damagePerIngredient` × brew size) × product of `multiplyDamage`.
 * Additive parts are summed before multipliers apply, so the order ingredients were added in
 * never matters. Every card in the brew counts toward its size, including ones with no
 * throw effect.
 */
export function brewDamage(brew: readonly CardInstance[]): number {
	let base = 0;
	let multiplier = 1;
	for (const card of brew) {
		const def: CardDef = CARDS[card.cardId];
		for (const effect of def.onThrow ?? []) {
			switch (effect.kind) {
				case "damage":
					base += effect.amount;
					break;
				case "damagePerIngredient":
					base += effect.amount * brew.length;
					break;
				case "multiplyDamage":
					multiplier *= effect.factor;
					break;
			}
		}
	}
	return base * multiplier;
}
