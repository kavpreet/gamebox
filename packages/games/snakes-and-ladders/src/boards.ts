import type { SeededRandom } from '@gamebox/core-engine';

/**
 * Board layouts. A layout is just two square→square maps; the module stores the
 * chosen one in public state so the TV draws whatever this match is playing on
 * (including the freshly generated random board).
 */
export interface SnlLayout {
  snakes: Record<number, number>;
  ladders: Record<number, number>;
}

/** The classic Milton Bradley arrangement. */
export const CLASSIC: SnlLayout = {
  snakes: {
    16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
  },
  ladders: {
    1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
  },
};

/** Snake pit: more snakes than ladders, and the big ones bite near the top. */
export const GAUNTLET: SnlLayout = {
  snakes: {
    14: 3, 19: 7, 27: 5, 39: 17, 44: 22, 54: 31, 66: 45, 76: 20,
    83: 51, 89: 68, 92: 25, 96: 42, 99: 63,
  },
  ladders: {
    8: 26, 21: 40, 33: 49, 52: 72, 61: 79, 74: 91,
  },
};

/** Rocket ride: ladders everywhere, only a handful of short snakes. */
export const EXPRESS: SnlLayout = {
  snakes: {
    32: 24, 48: 40, 63: 55, 79: 70, 94: 82, 97: 88,
  },
  ladders: {
    2: 23, 6: 45, 11: 29, 17: 58, 25: 64, 38: 77, 43: 60,
    52: 88, 57: 83, 68: 92, 71: 95, 84: 100,
  },
};

/** Two long chutes and two long ladders — swingy, fast, and mean. */
export const SKYFALL: SnlLayout = {
  snakes: {
    35: 4, 58: 12, 73: 30, 86: 21, 91: 9, 99: 41,
  },
  ladders: {
    3: 51, 13: 46, 24: 87, 37: 66, 50: 90, 62: 81,
  },
};

/**
 * A fresh board every match. Built from the game's own seeded RNG so the
 * layout is part of the reproducible game state, never a client-side surprise.
 * Snake heads and ladder feet are all distinct squares, nothing touches 1 or
 * 100, and no chain ever lands on another link's endpoint.
 */
export function randomLayout(rng: SeededRandom, snakeCount = 9, ladderCount = 9): SnlLayout {
  const layout: SnlLayout = { snakes: {}, ladders: {} };
  const used = new Set<number>([1, 100]);

  const pick = (lo: number, hi: number): number | null => {
    for (let tries = 0; tries < 60; tries++) {
      const n = rng.int(lo, hi);
      if (!used.has(n)) return n;
    }
    return null;
  };

  for (let i = 0; i < ladderCount; i++) {
    const foot = pick(2, 89);
    if (foot === null) continue;
    const top = pick(Math.min(foot + 8, 99), Math.min(foot + 40, 99));
    if (top === null || top <= foot) continue;
    used.add(foot);
    used.add(top);
    layout.ladders[foot] = top;
  }

  for (let i = 0; i < snakeCount; i++) {
    const head = pick(12, 99);
    if (head === null) continue;
    const tail = pick(Math.max(head - 40, 2), Math.max(head - 8, 2));
    if (tail === null || tail >= head) continue;
    used.add(head);
    used.add(tail);
    layout.snakes[head] = tail;
  }

  return layout;
}

export const LAYOUTS: Record<string, SnlLayout> = {
  classic: CLASSIC,
  gauntlet: GAUNTLET,
  express: EXPRESS,
  skyfall: SKYFALL,
};

export function layoutFor(id: string, rng: SeededRandom): SnlLayout {
  if (id === 'random') return randomLayout(rng);
  return LAYOUTS[id] ?? CLASSIC;
}
