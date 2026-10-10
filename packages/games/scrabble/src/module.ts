import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import {
  buildBag, premiumAt, LETTER_VALUES,
  BOARD_SIZE, CENTER, RACK_SIZE, BINGO_BONUS,
} from './tiles.js';

/**
 * Scrabble (2–4). Racks are private, the bag is in the hidden zone. Placement
 * legality (one line, contiguous, connected, center start) and scoring
 * (premiums, cross-words, 50-point bingo) are fully enforced server-side.
 *
 * Deliberately NO dictionary: a family game night self-polices words — the
 * next player simply doesn't accept nonsense (house rule, and it avoids
 * shipping a 300k-word list that argues with people).
 */

export interface BoardCell {
  letter: string; // resolved letter (blanks show what they stand for)
  isBlank: boolean;
  value: number;
}

export interface ScrabblePublic {
  board: (BoardCell | null)[][];
  scores: Record<Seat, number>;
  rackCounts: Record<Seat, number>;
  bagSize: number;
  order: Seat[];
  turnIndex: number;
  consecutiveScoreless: number;
  lastPlacement: { row: number; col: number }[]; // for TV highlight
  lastEvent: string | null;
  gameOver: boolean;
  winners: Seat[] | null;
}

interface SeatPrivate {
  rack: string[]; // 'A'..'Z' or '?' for blank
}

interface Hidden {
  bag: string[];
}

export type ScrabbleMove =
  | { kind: 'PLACE'; tiles: { row: number; col: number; rackIndex: number; blankAs?: string }[] }
  | { kind: 'EXCHANGE'; rackIndexes: number[] }
  | { kind: 'PASS' };

const HIDDEN_ZONE = -1 as Seat;
type State = GameState<ScrabblePublic, SeatPrivate | Hidden>;

function hiddenOf(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}
function rackOf(s: State, seat: Seat): string[] {
  return (s.private[seat] as SeatPrivate).rack;
}
function currentSeat(pub: ScrabblePublic): Seat {
  return pub.order[pub.turnIndex] as Seat;
}

function refillRack(s: State, seat: Seat, rng: SeededRandom): void {
  const bag = hiddenOf(s).bag;
  const rack = rackOf(s, seat);
  while (rack.length < RACK_SIZE && bag.length > 0) {
    rack.push(bag.splice(rng.int(0, bag.length - 1), 1)[0]!);
  }
  s.public.rackCounts[seat] = rack.length;
  s.public.bagSize = bag.length;
}

function boardEmpty(pub: ScrabblePublic): boolean {
  return pub.board.every((row) => row.every((c) => c === null));
}

interface Placement {
  row: number;
  col: number;
  letter: string;
  isBlank: boolean;
  value: number;
}

/** Validate geometry and resolve the placements (throws IllegalMove). */
function resolvePlacements(s: State, seat: Seat, move: Extract<ScrabbleMove, { kind: 'PLACE' }>): Placement[] {
  const pub = s.public;
  const rack = rackOf(s, seat);
  const tiles = move.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0 || tiles.length > RACK_SIZE) {
    throw new IllegalMove('Place between 1 and 7 tiles');
  }

  const seen = new Set<string>();
  const usedRack = new Set<number>();
  const placements: Placement[] = [];
  for (const t of tiles) {
    const row = Number(t.row), col = Number(t.col), ri = Number(t.rackIndex);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) {
      throw new IllegalMove('Tile off the board');
    }
    if (pub.board[row]![col]) throw new IllegalMove('Square already occupied');
    const key = `${row},${col}`;
    if (seen.has(key)) throw new IllegalMove('Two tiles on the same square');
    seen.add(key);
    if (!Number.isInteger(ri) || ri < 0 || ri >= rack.length || usedRack.has(ri)) {
      throw new IllegalMove('Bad rack tile');
    }
    usedRack.add(ri);
    const tile = rack[ri]!;
    let letter = tile;
    let isBlank = false;
    if (tile === '?') {
      const as = String(t.blankAs ?? '').toUpperCase();
      if (!/^[A-Z]$/.test(as)) throw new IllegalMove('Choose a letter for the blank');
      letter = as;
      isBlank = true;
    }
    placements.push({ row, col, letter, isBlank, value: isBlank ? 0 : LETTER_VALUES[letter]! });
  }

  // single row or column
  const rows = new Set(placements.map((p) => p.row));
  const cols = new Set(placements.map((p) => p.col));
  if (rows.size > 1 && cols.size > 1) throw new IllegalMove('Tiles must be in one row or one column');
  const horizontal = rows.size === 1 && (cols.size > 1 || placements.length === 1);

  // contiguity: the span between min and max must be fully covered (board + new)
  const at = (r: number, c: number) => pub.board[r]?.[c] ?? placements.find((p) => p.row === r && p.col === c) ?? null;
  if (horizontal) {
    const r = placements[0]!.row;
    const cs = placements.map((p) => p.col);
    for (let c = Math.min(...cs); c <= Math.max(...cs); c++) {
      if (!at(r, c)) throw new IllegalMove('Word has a gap');
    }
  } else {
    const c = placements[0]!.col;
    const rs = placements.map((p) => p.row);
    for (let r = Math.min(...rs); r <= Math.max(...rs); r++) {
      if (!at(r, c)) throw new IllegalMove('Word has a gap');
    }
  }

  if (boardEmpty(pub)) {
    if (!placements.some((p) => p.row === CENTER && p.col === CENTER)) {
      throw new IllegalMove('The first word must cover the center star');
    }
    if (placements.length < 2) throw new IllegalMove('The first word needs at least 2 letters');
  } else {
    const touches = placements.some((p) =>
      [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dr, dc]) => pub.board[p.row + dr!]?.[p.col + dc!]),
    );
    if (!touches) throw new IllegalMove('New tiles must connect to existing words');
  }

  return placements;
}

/** Score the placement (assumes placements already written to a scratch lookup). */
function scorePlacements(pub: ScrabblePublic, placements: Placement[]): { score: number; words: string[] } {
  const newAt = new Map(placements.map((p) => [`${p.row},${p.col}`, p]));
  const letterAt = (r: number, c: number): { letter: string; value: number; isNew: boolean } | null => {
    const n = newAt.get(`${r},${c}`);
    if (n) return { letter: n.letter, value: n.value, isNew: true };
    const b = pub.board[r]?.[c];
    return b ? { letter: b.letter, value: b.value, isNew: false } : null;
  };

  const words: { score: number; text: string }[] = [];
  const scoreLine = (r0: number, c0: number, dr: number, dc: number) => {
    // rewind to the start of the word
    let r = r0, c = c0;
    while (letterAt(r - dr, c - dc)) { r -= dr; c -= dc; }
    let text = '';
    let score = 0;
    let wordMult = 1;
    let len = 0;
    while (true) {
      const cell = letterAt(r, c);
      if (!cell) break;
      let v = cell.value;
      if (cell.isNew) {
        const prem = premiumAt(r, c);
        if (prem === 'DL') v *= 2;
        if (prem === 'TL') v *= 3;
        if (prem === 'DW') wordMult *= 2;
        if (prem === 'TW') wordMult *= 3;
      }
      score += v;
      text += cell.letter;
      len++;
      r += dr; c += dc;
    }
    if (len >= 2) words.push({ score: score * wordMult, text });
  };

  const rows = new Set(placements.map((p) => p.row));
  const horizontal = rows.size === 1 && placements.length > 1
    ? true
    : new Set(placements.map((p) => p.col)).size === 1 && placements.length > 1
      ? false
      : null; // single tile — direction ambiguous, score both lines

  const seenWords = new Set<string>();
  const addLine = (r: number, c: number, dr: number, dc: number) => {
    // dedupe by the word's start square + direction
    let sr = r, sc = c;
    while (letterAt(sr - dr, sc - dc)) { sr -= dr; sc -= dc; }
    const key = `${sr},${sc},${dr},${dc}`;
    if (seenWords.has(key)) return;
    seenWords.add(key);
    scoreLine(r, c, dr, dc);
  };

  for (const p of placements) {
    if (horizontal === true || horizontal === null) addLine(p.row, p.col, 0, 1);
    if (horizontal === false || horizontal === null) addLine(p.row, p.col, 1, 0);
    if (horizontal === true) addLine(p.row, p.col, 1, 0); // cross-words
    if (horizontal === false) addLine(p.row, p.col, 0, 1);
  }

  let total = words.reduce((a, w) => a + w.score, 0);
  if (placements.length === RACK_SIZE) total += BINGO_BONUS;
  return { score: total, words: words.map((w) => w.text) };
}

function endGame(s: State, finisher: Seat | null): void {
  const pub = s.public;
  // everyone loses the value of their remaining rack; the finisher gains it all
  let leftover = 0;
  for (const seat of pub.order) {
    const rackValue = rackOf(s, seat).reduce((a, t) => a + (LETTER_VALUES[t] ?? 0), 0);
    pub.scores[seat] = (pub.scores[seat] ?? 0) - rackValue;
    leftover += rackValue;
  }
  if (finisher !== null) pub.scores[finisher] = (pub.scores[finisher] ?? 0) + leftover;
  const best = Math.max(...pub.order.map((seat) => pub.scores[seat] ?? 0));
  pub.gameOver = true;
  pub.winners = pub.order.filter((seat) => (pub.scores[seat] ?? 0) === best);
}

function nextTurn(pub: ScrabblePublic): void {
  pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
}

export const scrabble: GameModule<ScrabblePublic, SeatPrivate | Hidden, ScrabbleMove> = {
  slug: 'scrabble',
  displayName: 'Scrabble',
  description: 'Spell words on premium squares; your table is the dictionary.',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 4,
  teams: 'none',

  setup(seats, rng) {
    const order = seats.map((x) => x.seat);
    const priv: Record<Seat, SeatPrivate | Hidden> = { [HIDDEN_ZONE]: { bag: rng.shuffle(buildBag()) } };
    const scores: Record<Seat, number> = {};
    const rackCounts: Record<Seat, number> = {};
    for (const seat of order) {
      priv[seat] = { rack: [] };
      scores[seat] = 0;
      rackCounts[seat] = 0;
    }
    const state: State = {
      public: {
        board: Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)),
        scores,
        rackCounts,
        bagSize: 100,
        order,
        turnIndex: 0,
        consecutiveScoreless: 0,
        lastPlacement: [],
        lastEvent: null,
        gameOver: false,
        winners: null,
      },
      private: priv,
    };
    for (const seat of order) refillRack(state, seat, rng);
    return state;
  },

  activePlayers(state) {
    if (state.public.gameOver) return [];
    return [currentSeat(state.public)];
  },

  moves: {
    PLACE({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      if (pub.gameOver) throw new IllegalMove('Game over');
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      const move = payload as Extract<ScrabbleMove, { kind: 'PLACE' }>;
      const placements = resolvePlacements(s, seat, move);
      const { score, words } = scorePlacements(pub, placements);

      // commit
      for (const p of placements) {
        pub.board[p.row]![p.col] = { letter: p.letter, isBlank: p.isBlank, value: p.value };
      }
      const rack = rackOf(s, seat);
      const used = [...move.tiles].map((t) => Number(t.rackIndex)).sort((a, b) => b - a);
      for (const ri of used) rack.splice(ri, 1);
      pub.scores[seat] = (pub.scores[seat] ?? 0) + score;
      pub.lastPlacement = placements.map((p) => ({ row: p.row, col: p.col }));
      pub.lastEvent = `played ${words.join(', ') || 'a word'} for ${score}`;
      pub.consecutiveScoreless = 0;

      if (rack.length === 0 && hiddenOf(s).bag.length === 0) {
        s.public.rackCounts[seat] = 0;
        endGame(s, seat);
        return;
      }
      refillRack(s, seat, rng);
      nextTurn(pub);
    },

    EXCHANGE({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      if (pub.gameOver) throw new IllegalMove('Game over');
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      const bag = hiddenOf(s).bag;
      if (bag.length < RACK_SIZE) throw new IllegalMove('Fewer than 7 tiles left — exchanging is not allowed');
      const idxs = [...new Set(((payload as { rackIndexes: number[] }).rackIndexes ?? []).map(Number))];
      const rack = rackOf(s, seat);
      if (idxs.length === 0 || idxs.some((i) => !Number.isInteger(i) || i < 0 || i >= rack.length)) {
        throw new IllegalMove('Pick which tiles to exchange');
      }
      const returned: string[] = [];
      for (const i of [...idxs].sort((a, b) => b - a)) returned.push(...rack.splice(i, 1));
      refillRack(s, seat, rng);
      bag.push(...returned);
      pub.bagSize = bag.length;
      pub.lastPlacement = [];
      pub.lastEvent = `exchanged ${returned.length} tile${returned.length > 1 ? 's' : ''}`;
      pub.consecutiveScoreless++;
      if (pub.consecutiveScoreless >= pub.order.length * 2) { endGame(s, null); return; }
      nextTurn(pub);
    },

    PASS({ state, seat }) {
      const s = state as State;
      const pub = s.public;
      if (pub.gameOver) throw new IllegalMove('Game over');
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      pub.lastPlacement = [];
      pub.lastEvent = 'passed';
      pub.consecutiveScoreless++;
      if (pub.consecutiveScoreless >= pub.order.length * 2) { endGame(s, null); return; }
      nextTurn(pub);
    },
  },

  // Enumerating scrabble moves is combinatorial — the UI is free-form and the
  // server rejects illegal placements with a precise message instead.

  endIf(state) {
    const pub = state.public;
    if (pub.gameOver && pub.winners) return { winners: pub.winners };
    return null;
  },

  view(state, viewer) {
    const s = state as State;
    const pub = s.public;
    if (viewer === 'SPECTATOR' || !(viewer in s.private) || viewer === HIDDEN_ZONE) {
      return { ...pub, rack: null };
    }
    return { ...pub, rack: rackOf(s, viewer as Seat) };
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.gameOver || currentSeat(pub) !== seat) return;
    pub.lastEvent = 'was skipped';
    pub.consecutiveScoreless++;
    if (pub.consecutiveScoreless >= pub.order.length * 2) { endGame(s, null); return; }
    nextTurn(pub);
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    const wasCurrent = currentSeat(pub) === seat;
    const cur = wasCurrent ? pub.order[(pub.turnIndex + 1) % pub.order.length]! : currentSeat(pub);
    hiddenOf(s).bag.push(...rackOf(s, seat)); // tiles go back to the bag
    pub.bagSize = hiddenOf(s).bag.length;
    delete s.private[seat];
    delete pub.scores[seat];
    delete pub.rackCounts[seat];
    pub.order.splice(idx, 1);
    if (pub.order.length === 1) {
      pub.gameOver = true;
      pub.winners = [pub.order[0]!];
      return;
    }
    const ni = pub.order.indexOf(cur);
    pub.turnIndex = ni === -1 ? 0 : ni;
  },
};
