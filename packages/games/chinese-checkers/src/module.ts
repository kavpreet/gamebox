import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';

/**
 * Chinese Checkers — the classic 121-hole star, 2/3/4/6 players, 10 pegs each.
 * A move is one step to an adjacent empty hole, or a chain of jumps over
 * adjacent pegs (any color) into empty holes. First player to fill the
 * opposite arm wins. (The "can't rest in someone else's arm" house rule is
 * deliberately not enforced.)
 *
 * Board = cube coordinates (x+y+z=0): the star is
 * {(x,y,z) : all ≥ -4} ∪ {(x,y,z) : all ≤ 4} — 121 cells. Cell ids are "x,z".
 */

export type Cell = string; // "x,z" (y = -x-z)

export interface CCPublic {
  /** occupied holes: cellId → seat */
  pegs: Record<Cell, Seat>;
  /** seat → home arm index 0..5 (target arm = (home+3)%6) */
  homes: Record<Seat, number>;
  order: Seat[];
  turnIndex: number;
  lastMove: { seat: Seat; from: Cell; to: Cell } | null;
  winner: Seat | null;
}

export type CCPrivate = Record<string, never>;
export type CCMove = { kind: 'MOVE'; from: Cell; to: Cell };

type State = GameState<CCPublic, CCPrivate>;

const DIRS: [number, number, number][] = [
  [1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1],
];

export function cellId(x: number, z: number): Cell {
  return `${x},${z}`;
}

function inStar(x: number, y: number, z: number): boolean {
  return (x >= -4 && y >= -4 && z >= -4) || (x <= 4 && y <= 4 && z <= 4);
}

/** All 121 board cells. */
export function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (let x = -8; x <= 8; x++) {
    for (let z = -8; z <= 8; z++) {
      const y = -x - z;
      if (y < -8 || y > 8) continue;
      if (inStar(x, y, z)) cells.push(cellId(x, z));
    }
  }
  return cells;
}

const CELL_SET = new Set(allCells());

/**
 * Arm k (0..5) = the 10 cells of one star point. Arms in order:
 * 0: x≥5 · 1: z≤-5 · 2: y≥5 · 3: x≤-5 · 4: z≥5 · 5: y≤-5
 * Opposite arm of k is (k+3)%6.
 */
export function armCells(arm: number): Cell[] {
  const cells: Cell[] = [];
  for (const id of CELL_SET) {
    const [x, z] = id.split(',').map(Number) as [number, number];
    const y = -x - z;
    const cond = [x >= 5, z <= -5, y >= 5, x <= -5, z >= 5, y <= -5][arm];
    if (cond) cells.push(id);
  }
  return cells;
}

/** Home arms by player count (evenly spread, pairwise opposite where possible). */
const HOME_SETS: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

function neighborsOf(id: Cell): { step: Cell; jumpOver: Cell; jumpTo: Cell }[] {
  const [x, z] = id.split(',').map(Number) as [number, number];
  return DIRS.map(([dx, , dz]) => ({
    step: cellId(x + dx, z + dz),
    jumpOver: cellId(x + dx, z + dz),
    jumpTo: cellId(x + 2 * dx, z + 2 * dz),
  }));
}

/** All destination cells reachable from `from` (single step or jump chain). */
export function destinations(pegs: Record<Cell, Seat>, from: Cell): Cell[] {
  const result = new Set<Cell>();
  for (const n of neighborsOf(from)) {
    if (CELL_SET.has(n.step) && pegs[n.step] === undefined) result.add(n.step);
  }
  // BFS over jump chains
  const visited = new Set<Cell>([from]);
  const queue: Cell[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of neighborsOf(cur)) {
      if (
        CELL_SET.has(n.jumpTo) &&
        pegs[n.jumpOver] !== undefined &&
        pegs[n.jumpTo] === undefined &&
        n.jumpTo !== from &&
        !visited.has(n.jumpTo)
      ) {
        visited.add(n.jumpTo);
        result.add(n.jumpTo);
        queue.push(n.jumpTo);
      }
    }
  }
  return Array.from(result);
}

function currentSeat(pub: CCPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function hasWon(pub: CCPublic, seat: Seat): boolean {
  const target = (pub.homes[seat]! + 3) % 6;
  return armCells(target).every((c) => pub.pegs[c] === seat);
}

export const chineseCheckers: GameModule<CCPublic, CCPrivate, CCMove> = {
  slug: 'chinese-checkers',
  displayName: 'Chinese Checkers',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 6,
  teams: 'none',

  setup(seats) {
    const n = seats.length;
    const homeSet = HOME_SETS[n] ?? HOME_SETS[6]!;
    const pegs: Record<Cell, Seat> = {};
    const homes: Record<Seat, number> = {};
    const priv: Record<Seat, CCPrivate> = {};
    seats.forEach(({ seat }, i) => {
      const arm = homeSet[i % homeSet.length]!;
      homes[seat] = arm;
      for (const c of armCells(arm)) pegs[c] = seat;
      priv[seat] = {};
    });
    return {
      public: {
        pegs,
        homes,
        order: seats.map((s) => s.seat),
        turnIndex: 0,
        lastMove: null,
        winner: null,
      },
      private: priv,
    };
  },

  activePlayers(state: State) {
    if (state.public.winner !== null) return [];
    return [currentSeat(state.public)];
  },

  moves: {
    MOVE({ state, seat, payload }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      const { from, to } = payload as { from: Cell; to: Cell };
      if (pub.pegs[from] !== seat) throw new IllegalMove('Not your peg');
      if (!destinations(pub.pegs, from).includes(to)) throw new IllegalMove('Unreachable hole');

      delete pub.pegs[from];
      pub.pegs[to] = seat;
      pub.lastMove = { seat, from, to };

      if (hasWon(pub, seat)) {
        pub.winner = seat;
        return;
      }
      pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
    },
  },

  legalMoves(state, seat) {
    const pub = state.public;
    if (pub.winner !== null || seat !== currentSeat(pub)) return [];
    const moves: CCMove[] = [];
    for (const [cell, owner] of Object.entries(pub.pegs)) {
      if (owner !== seat) continue;
      for (const to of destinations(pub.pegs, cell)) {
        moves.push({ kind: 'MOVE', from: cell, to });
      }
    }
    return moves;
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  view(state) {
    return state.public;
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const pub = state.public;
    if (currentSeat(pub) === seat) {
      pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
    }
  },

  onPlayerRemoved(state, seat) {
    const pub = state.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    const wasCurrent = currentSeat(pub) === seat;
    const next = wasCurrent ? pub.order[(pub.turnIndex + 1) % pub.order.length] : currentSeat(pub);
    // their pegs stay on the board as obstacles? No — remove them for clarity.
    for (const [cell, owner] of Object.entries(pub.pegs)) {
      if (owner === seat) delete pub.pegs[cell];
    }
    pub.order.splice(idx, 1);
    if (pub.order.length > 0) {
      const ni = pub.order.indexOf(next as Seat);
      pub.turnIndex = ni === -1 ? 0 : ni;
    }
    if (pub.order.length === 1) pub.winner = pub.order[0] as Seat;
  },
};
