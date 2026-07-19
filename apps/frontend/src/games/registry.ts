import type { GameUi } from './types.js';
import { snakesAndLaddersUi } from './snakes-and-ladders-ui.js';
import { ludoUi } from './ludo-ui.js';
import { unoUi, unoFlipUi } from './uno-ui.js';
import { chessUi } from './chess-ui.js';
import { chineseCheckersUi } from './chinese-checkers-ui.js';
import { rummyUi } from './rummy-ui.js';
import { checkersUi } from './checkers-ui.js';
import { riskUi } from './risk-ui.js';
import { pandemicUi } from './pandemic-ui.js';
import { monopolyUi } from './monopoly-ui.js';
import { catanUi } from './catan-ui.js';
import { codenamesUi } from './codenames-ui.js';
import { azulUi } from './azul-ui.js';
import { scattergoriesUi } from './scattergories-ui.js';
import { scrabbleUi } from './scrabble-ui.js';
import { pictionaryUi } from './pictionary-ui.js';
import { ticketToRideUi } from './ticket-to-ride-ui.js';

const uis: GameUi[] = [
  snakesAndLaddersUi,
  ludoUi,
  unoUi,
  unoFlipUi,
  chessUi,
  chineseCheckersUi,
  rummyUi,
  checkersUi,
  riskUi,
  pandemicUi,
  monopolyUi,
  catanUi,
  codenamesUi,
  azulUi,
  scattergoriesUi,
  scrabbleUi,
  pictionaryUi,
  ticketToRideUi,
];

const bySlug = new Map(uis.map((u) => [u.slug, u]));

export function getGameUi(slug: string): GameUi | undefined {
  return bySlug.get(slug);
}
