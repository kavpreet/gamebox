import type { GameUi } from './types.js';
import { snakesAndLaddersUi } from './snakes-and-ladders-ui.js';
import { ludoUi } from './ludo-ui.js';
import { unoUi, unoFlipUi } from './uno-ui.js';
import { chessUi } from './chess-ui.js';
import { chineseCheckersUi } from './chinese-checkers-ui.js';
import { rummyUi } from './rummy-ui.js';
import { checkersUi } from './checkers-ui.js';

const uis: GameUi[] = [
  snakesAndLaddersUi,
  ludoUi,
  unoUi,
  unoFlipUi,
  chessUi,
  chineseCheckersUi,
  rummyUi,
  checkersUi,
];

const bySlug = new Map(uis.map((u) => [u.slug, u]));

export function getGameUi(slug: string): GameUi | undefined {
  return bySlug.get(slug);
}
