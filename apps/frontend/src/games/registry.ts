import type { GameUi } from './types.js';
import { snakesAndLaddersUi } from './snakes-and-ladders-ui.js';

const uis: GameUi[] = [
  snakesAndLaddersUi,
];

const bySlug = new Map(uis.map((u) => [u.slug, u]));

export function getGameUi(slug: string): GameUi | undefined {
  return bySlug.get(slug);
}
