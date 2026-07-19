import { registerGame, listGames, getGame } from '@gamebox/core-engine';
import type { GameModule } from '@gamebox/core-engine';

/**
 * Central plugin registration. Adding a new game = implement the GameModule in
 * its package, import it here. Editing an existing module's rules (and bumping
 * its rulesVersion) discontinues that game type's in-flight games at next boot
 * (plan §5.3) — adding a new import never touches anything else.
 */
import { snakesAndLadders } from '@gamebox/game-snakes-and-ladders';
import { ludo } from '@gamebox/game-ludo';
import { uno, unoFlip } from '@gamebox/game-uno';
import { chess } from '@gamebox/game-chess';
import { chineseCheckers } from '@gamebox/game-chinese-checkers';
import { rummy } from '@gamebox/game-rummy';
import { checkers } from '@gamebox/game-checkers';
import { risk } from '@gamebox/game-risk';
import { pandemic } from '@gamebox/game-pandemic';
import { monopoly } from '@gamebox/game-monopoly';
import { catan } from '@gamebox/game-catan';
import { codenames } from '@gamebox/game-codenames';
import { azul } from '@gamebox/game-azul';
import { scattergories } from '@gamebox/game-scattergories';
import { scrabble } from '@gamebox/game-scrabble';
import { pictionary } from '@gamebox/game-pictionary';
import { ticketToRide } from '@gamebox/game-ticket-to-ride';

const modules: GameModule<any, any, any>[] = [
  snakesAndLadders,
  ludo,
  uno,
  unoFlip,
  chess,
  chineseCheckers,
  rummy,
  checkers,
  risk,
  pandemic,
  monopoly,
  catan,
  codenames,
  azul,
  scattergories,
  scrabble,
  pictionary,
  ticketToRide,
];

for (const m of modules) {
  registerGame(m);
}

export { listGames, getGame };
