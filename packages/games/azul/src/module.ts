import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove, createSeededRandom } from '@gamebox/core-engine';

/**
 * Azul (2–4 players). Almost everything is open information — the only hidden
 * state is the tile bag's draw order, which lives in the hidden zone and is
 * consumed with the seeded RNG at each factory refill.
 *
 * Standard rules: 5 factories +2 per extra player, wall-tiling after each
 * draft round, end when someone completes a wall row, bonuses for rows (+2),
 * columns (+7) and full color sets (+10).
 */

export type TileColor = 0 | 1 | 2 | 3 | 4; // blue, yellow, red, black, teal
export const COLOR_COUNT = 5;
export const FLOOR_PENALTIES = [-1, -1, -2, -2, -2, -3, -3];

/** Fixed wall pattern: row r, column c holds color (c - r + 5) % 5. */
export function wallColor(row: number, col: number): TileColor {
  return (((col - row) % 5) + 5) % 5 as TileColor;
}
export function wallColumnFor(row: number, color: TileColor): number {
  return (row + color) % 5;
}

export interface PlayerBoard {
  /** pattern lines 0..4 — line i holds up to i+1 tiles of one color */
  lines: { color: TileColor | null; count: number }[];
  /** wall[r][c] true = tiled */
  wall: boolean[][];
  /** floor line: tile colors (or 'first' marker) in drop order */
  floor: (TileColor | 'first')[];
  score: number;
}

export interface AzulPublic {
  factories: TileColor[][]; // remaining tiles per factory
  center: TileColor[];
  firstMarkerInCenter: boolean;
  boards: Record<Seat, PlayerBoard>;
  order: Seat[];
  turnIndex: number;
  round: number;
  nextStarter: Seat | null; // whoever took the first-player marker
  bagSize: number;
  gameOver: boolean;
  winners: Seat[] | null;
  lastEvent: string | null;
}

interface Hidden {
  bag: TileColor[];
  discard: TileColor[]; // box lid — reshuffled into the bag when it runs dry
}

export type AzulMove = {
  kind: 'DRAFT';
  source: number | 'center';
  color: TileColor;
  line: number | 'floor';
};

const HIDDEN_ZONE = -1 as Seat;
type State = GameState<AzulPublic, Hidden | Record<string, never>>;

function hiddenOf(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}

function currentSeat(pub: AzulPublic): Seat {
  return pub.order[pub.turnIndex] as Seat;
}

function emptyBoard(): PlayerBoard {
  return {
    lines: Array.from({ length: 5 }, () => ({ color: null, count: 0 })),
    wall: Array.from({ length: 5 }, () => Array(5).fill(false)),
    floor: [],
    score: 0,
  };
}

function drawFromBag(s: State, rng: SeededRandom, n: number): TileColor[] {
  const h = hiddenOf(s);
  const out: TileColor[] = [];
  for (let i = 0; i < n; i++) {
    if (h.bag.length === 0) {
      if (h.discard.length === 0) break; // whole supply on boards — rare, legal
      h.bag = rng.shuffle(h.discard);
      h.discard = [];
    }
    out.push(h.bag.pop()!);
  }
  return out;
}

function refillFactories(s: State, rng: SeededRandom): void {
  const pub = s.public;
  for (let i = 0; i < pub.factories.length; i++) {
    pub.factories[i] = drawFromBag(s, rng, 4);
  }
  pub.center = [];
  pub.firstMarkerInCenter = true;
  pub.bagSize = hiddenOf(s).bag.length;
}

function draftOver(pub: AzulPublic): boolean {
  return pub.center.length === 0 && pub.factories.every((f) => f.length === 0);
}

/** Score one just-placed wall tile at (r,c). */
function scorePlacement(wall: boolean[][], r: number, c: number): number {
  let h = 1;
  for (let x = c - 1; x >= 0 && wall[r]![x]; x--) h++;
  for (let x = c + 1; x < 5 && wall[r]![x]; x++) h++;
  let v = 1;
  for (let y = r - 1; y >= 0 && wall[y]![c]; y--) v++;
  for (let y = r + 1; y < 5 && wall[y]![c]; y++) v++;
  if (h === 1 && v === 1) return 1;
  return (h > 1 ? h : 0) + (v > 1 ? v : 0);
}

function finalBonus(wall: boolean[][]): number {
  let bonus = 0;
  for (let r = 0; r < 5; r++) if (wall[r]!.every(Boolean)) bonus += 2;
  for (let c = 0; c < 5; c++) if (wall.every((row) => row[c])) bonus += 7;
  for (let color = 0; color < 5; color++) {
    let n = 0;
    for (let r = 0; r < 5; r++) if (wall[r]![wallColumnFor(r, color as TileColor)]) n++;
    if (n === 5) bonus += 10;
  }
  return bonus;
}

/** End-of-round wall tiling + floor penalties. Returns true if the game ends. */
function tileWalls(s: State): boolean {
  const pub = s.public;
  const h = hiddenOf(s);
  let anyRowDone = false;

  for (const seat of pub.order) {
    const b = pub.boards[seat]!;
    for (let r = 0; r < 5; r++) {
      const line = b.lines[r]!;
      if (line.color === null || line.count < r + 1) continue;
      const c = wallColumnFor(r, line.color);
      b.wall[r]![c] = true;
      b.score += scorePlacement(b.wall, r, c);
      h.discard.push(...Array<TileColor>(r).fill(line.color)); // r extras to the lid
      b.lines[r] = { color: null, count: 0 };
    }
    let penalty = 0;
    b.floor.forEach((t, i) => {
      penalty += FLOOR_PENALTIES[Math.min(i, FLOOR_PENALTIES.length - 1)]!;
      if (t !== 'first') h.discard.push(t);
    });
    b.score = Math.max(0, b.score + penalty);
    b.floor = [];
    if (b.wall.some((row) => row.every(Boolean))) anyRowDone = true;
  }

  if (anyRowDone) {
    let best = -1;
    for (const seat of pub.order) {
      const b = pub.boards[seat]!;
      b.score += finalBonus(b.wall);
      best = Math.max(best, b.score);
    }
    pub.gameOver = true;
    pub.winners = pub.order.filter((seat) => pub.boards[seat]!.score === best);
    return true;
  }
  return false;
}

function advanceAfterDraft(s: State, rng: SeededRandom): void {
  const pub = s.public;
  if (draftOver(pub)) {
    if (tileWalls(s)) return;
    pub.round++;
    const starter = pub.nextStarter ?? pub.order[0]!;
    pub.turnIndex = Math.max(0, pub.order.indexOf(starter));
    pub.nextStarter = null;
    refillFactories(s, rng);
    pub.lastEvent = `Round ${pub.round} begins`;
  } else {
    pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  }
}

function applyDraft(s: State, seat: Seat, move: AzulMove, rng: SeededRandom): void {
  const pub = s.public;
  const b = pub.boards[seat]!;
  const { source, color, line } = move;

  // take the tiles
  let taken: TileColor[];
  if (source === 'center') {
    taken = pub.center.filter((t) => t === color);
    if (taken.length === 0) throw new IllegalMove('No tiles of that color in the center');
    pub.center = pub.center.filter((t) => t !== color);
    if (pub.firstMarkerInCenter) {
      pub.firstMarkerInCenter = false;
      pub.nextStarter = seat;
      b.floor.push('first');
    }
  } else {
    const f = pub.factories[source];
    if (!f) throw new IllegalMove('No such factory');
    taken = f.filter((t) => t === color);
    if (taken.length === 0) throw new IllegalMove('No tiles of that color there');
    pub.center.push(...f.filter((t) => t !== color));
    pub.factories[source] = [];
  }

  // place them
  if (line === 'floor') {
    b.floor.push(...taken);
  } else {
    const r = Number(line);
    if (!Number.isInteger(r) || r < 0 || r > 4) throw new IllegalMove('Bad pattern line');
    const l = b.lines[r]!;
    if (l.color !== null && l.color !== color) throw new IllegalMove('Line already holds another color');
    if (b.wall[r]![wallColumnFor(r, color)]) throw new IllegalMove('That color is already on the wall in this row');
    const capacity = r + 1 - l.count;
    if (capacity <= 0) throw new IllegalMove('Line is full');
    const placed = Math.min(capacity, taken.length);
    l.color = color;
    l.count += placed;
    b.floor.push(...taken.slice(placed));
  }

  pub.lastEvent = `took ${taken.length} tile${taken.length > 1 ? 's' : ''}`;
  advanceAfterDraft(s, rng);
}

function legalDraftsFor(pub: AzulPublic, seat: Seat): AzulMove[] {
  const b = pub.boards[seat]!;
  const moves: AzulMove[] = [];
  const sources: (number | 'center')[] = [
    ...pub.factories.map((_, i) => i).filter((i) => pub.factories[i]!.length > 0),
    ...(pub.center.length > 0 ? (['center'] as const) : []),
  ];
  for (const source of sources) {
    const tiles = source === 'center' ? pub.center : pub.factories[source]!;
    for (const color of new Set(tiles)) {
      for (let r = 0; r < 5; r++) {
        const l = b.lines[r]!;
        if (l.color !== null && l.color !== color) continue;
        if (l.count >= r + 1) continue;
        if (b.wall[r]![wallColumnFor(r, color)]) continue;
        moves.push({ kind: 'DRAFT', source, color, line: r });
      }
      moves.push({ kind: 'DRAFT', source, color, line: 'floor' });
    }
  }
  return moves;
}

export const azul: GameModule<AzulPublic, Hidden | Record<string, never>, AzulMove> = {
  slug: 'azul',
  displayName: 'Azul',
  description: 'Draft glazed tiles and mosaic your palace wall — waste nothing.',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 4,
  teams: 'none',

  setup(seats, rng) {
    const bag: TileColor[] = [];
    for (let c = 0; c < COLOR_COUNT; c++) bag.push(...Array<TileColor>(20).fill(c as TileColor));
    const order = seats.map((s) => s.seat);
    const boards: Record<Seat, PlayerBoard> = {};
    for (const seat of order) boards[seat] = emptyBoard();

    const state: State = {
      public: {
        factories: Array.from({ length: 2 * order.length + 1 }, () => []),
        center: [],
        firstMarkerInCenter: true,
        boards,
        order,
        turnIndex: 0,
        round: 1,
        nextStarter: null,
        bagSize: 100,
        gameOver: false,
        winners: null,
        lastEvent: null,
      },
      private: { [HIDDEN_ZONE]: { bag: rng.shuffle(bag), discard: [] } },
    };
    refillFactories(state, rng);
    return state;
  },

  activePlayers(state) {
    if (state.public.gameOver) return [];
    return [currentSeat(state.public)];
  },

  moves: {
    DRAFT({ state, seat, payload, rng }) {
      const s = state as State;
      if (s.public.gameOver) throw new IllegalMove('Game over');
      if (seat !== currentSeat(s.public)) throw new IllegalMove('Not your turn');
      applyDraft(s, seat, payload as AzulMove, rng);
    },
  },

  legalMoves(state, seat) {
    const s = state as State;
    if (s.public.gameOver || seat !== currentSeat(s.public)) return [];
    return legalDraftsFor(s.public, seat);
  },

  endIf(state) {
    const pub = state.public;
    if (pub.gameOver && pub.winners) return { winners: pub.winners };
    return null;
  },

  view(state, _viewer) {
    // Azul is open information — everyone (TV included) sees the same thing.
    return state.public;
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.gameOver || currentSeat(pub) !== seat) return;
    // forced minimal move: dump the first available color onto the floor
    const moves = legalDraftsFor(pub, seat).filter((m) => m.line === 'floor');
    if (moves.length === 0) return;
    // onPlayerSkipped has no rng in its signature; a refill only happens if this
    // draft ends the round, and a deterministic seed there is acceptable
    applyDraft(s, seat, moves[0]!, createSeededRandom(pub.round * 7919 + seat));
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    const wasCurrent = currentSeat(pub) === seat;
    const cur = wasCurrent ? pub.order[(pub.turnIndex + 1) % pub.order.length]! : currentSeat(pub);
    // their unplaced tiles go to the lid
    const b = pub.boards[seat]!;
    const h = hiddenOf(s);
    for (const l of b.lines) if (l.color !== null) h.discard.push(...Array<TileColor>(l.count).fill(l.color));
    for (const t of b.floor) if (t !== 'first') h.discard.push(t);
    delete pub.boards[seat];
    pub.order.splice(idx, 1);
    if (pub.nextStarter === seat) pub.nextStarter = pub.order[0] ?? null;
    if (pub.order.length === 1) {
      pub.gameOver = true;
      pub.winners = [pub.order[0]!];
      return;
    }
    if (pub.order.length > 0) {
      const ni = pub.order.indexOf(cur);
      pub.turnIndex = ni === -1 ? 0 : ni;
    }
  },
};
