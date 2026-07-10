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

const modules: GameModule<any, any, any>[] = [
  snakesAndLadders,
  ludo,
  uno,
  unoFlip,
  chess,
  chineseCheckers,
];

for (const m of modules) {
  registerGame(m);
}

export { listGames, getGame };
