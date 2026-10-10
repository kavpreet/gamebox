import type { GameModule, GameOptions, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';

/**
 * Checkers (American/English draughts, 8×8):
 * - men move one square diagonally forward; kings any diagonal direction
 * - captures jump over an adjacent enemy piece to the empty square beyond
 * - FORCED CAPTURE: if any capture exists, a capture must be played
 * - multi-jumps are mandatory: after a jump, if the same piece can jump again
 *   it must (the module keeps the turn on that piece via `chain`)
 * - promotion on the back rank ends the jump chain
 * - a player with no legal move at their turn loses
 *
 * The lobby can switch to the international/Spanish variations most tables
 * argue about: optional captures, backwards jumps for men, and flying kings.
 *
 * Squares are "col,row", 0-indexed, dark squares only ((col+row) odd).
 * Seat 0 starts at rows 0–2 moving +row; seat 1 at rows 5–7 moving -row.
 */

/** House rules, resolved from the lobby options at setup. */
export interface CheckersRules {
  forcedCapture: boolean;
  menCaptureBackwards: boolean;
  flyingKings: boolean;
}

export const CHECKERS_STANDARD_RULES: CheckersRules = {
  forcedCapture: true,
  menCaptureBackwards: false,
  flyingKings: false,
};

export interface Piece {
  seat: Seat;
  king: boolean;
}

export interface CheckersPublic {
  board: Record<string, Piece>;
  rules: CheckersRules;
  turn: Seat;
  /** square of the piece that must continue a jump chain, if any */
  chain: string | null;
  lastMove: { from: string; to: string; captured: string | null } | null;
  winner: Seat | null;
}

export type CheckersPrivate = Record<string, never>;
export type CheckersMove = { kind: 'MOVE'; from: string; to: string };

type State = GameState<CheckersPublic, CheckersPrivate>;

const sq = (c: number, r: number) => `${c},${r}`;
const parse = (s: string) => s.split(',').map(Number) as [number, number];
const onBoard = (c: number, r: number) => c >= 0 && c < 8 && r >= 0 && r < 8;

const ALL_DIRS: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

function rulesOf(pub: CheckersPublic): CheckersRules {
  return pub.rules ?? CHECKERS_STANDARD_RULES;
}

function checkersRules(options: GameOptions): CheckersRules {
  return {
    forcedCapture: (options.forcedCapture ?? true) === true,
    menCaptureBackwards: options.menCaptureBackwards === true,
    flyingKings: options.flyingKings === true,
  };
}

function moveDirs(piece: Piece): [number, number][] {
  if (piece.king) return ALL_DIRS;
  const dr = piece.seat === 0 ? 1 : -1;
  return [[1, dr], [-1, dr]];
}

/** Men jump only forwards unless the backwards-capture house rule is on. */
function captureDirs(piece: Piece, rules: CheckersRules): [number, number][] {
  return piece.king || rules.menCaptureBackwards ? ALL_DIRS : moveDirs(piece);
}

interface StepMove { from: string; to: string; captured: string | null }

/** Every step this piece could make — captures first, quiet moves after. */
function movesForPiece(
  board: Record<string, Piece>,
  from: string,
  rules: CheckersRules,
): StepMove[] {
  const piece = board[from];
  if (!piece) return [];
  const [c, r] = parse(from);
  const jumps: StepMove[] = [];
  const steps: StepMove[] = [];
  const flying = piece.king && rules.flyingKings;

  for (const [dc, dr] of moveDirs(piece)) {
    if (flying) {
      // a flying king glides any distance along an empty diagonal
      for (let d = 1; d < 8; d++) {
        const tc = c + dc * d, tr = r + dr * d;
        if (!onBoard(tc, tr) || board[sq(tc, tr)]) break;
        steps.push({ from, to: sq(tc, tr), captured: null });
      }
    } else {
      const mc = c + dc, mr = r + dr;
      if (onBoard(mc, mr) && !board[sq(mc, mr)]) {
        steps.push({ from, to: sq(mc, mr), captured: null });
      }
    }
  }

  for (const [dc, dr] of captureDirs(piece, rules)) {
    if (flying) {
      // find the first piece along the diagonal; if it's an enemy with space
      // behind it, every empty square beyond is a landing square
      let d = 1;
      while (onBoard(c + dc * d, r + dr * d) && !board[sq(c + dc * d, r + dr * d)]) d++;
      const victimSq = sq(c + dc * d, r + dr * d);
      const victim = onBoard(c + dc * d, r + dr * d) ? board[victimSq] : undefined;
      if (!victim || victim.seat === piece.seat) continue;
      for (let e = d + 1; onBoard(c + dc * e, r + dr * e); e++) {
        if (board[sq(c + dc * e, r + dr * e)]) break;
        jumps.push({ from, to: sq(c + dc * e, r + dr * e), captured: victimSq });
      }
    } else {
      const mc = c + dc, mr = r + dr;
      const jc = c + 2 * dc, jr = r + 2 * dr;
      if (!onBoard(mc, mr)) continue;
      const mid = board[sq(mc, mr)];
      if (mid && mid.seat !== piece.seat && onBoard(jc, jr) && !board[sq(jc, jr)]) {
        jumps.push({ from, to: sq(jc, jr), captured: sq(mc, mr) });
      }
    }
  }

  return [...jumps, ...steps];
}

/** All legal single steps for a seat, applying the forced-capture rule board-wide. */
export function legalSteps(pub: CheckersPublic, seat: Seat): StepMove[] {
  const rules = rulesOf(pub);
  if (pub.chain) {
    // mid-chain: only continued jumps by the chain piece
    return movesForPiece(pub.board, pub.chain, rules).filter((m) => m.captured);
  }
  const all: StepMove[] = [];
  let anyCapture = false;
  for (const [square, piece] of Object.entries(pub.board)) {
    if (piece.seat !== seat) continue;
    for (const m of movesForPiece(pub.board, square, rules)) {
      if (m.captured) anyCapture = true;
      all.push(m);
    }
  }
  return rules.forcedCapture && anyCapture ? all.filter((m) => m.captured) : all;
}

export const checkers: GameModule<CheckersPublic, CheckersPrivate, CheckersMove> = {
  slug: 'checkers',
  displayName: 'Checkers',
  description: 'Jump, capture, and crown your kings on the classic 8×8 board.',
  rulesVersion: '1.1.0',
  minPlayers: 2,
  maxPlayers: 2,
  teams: 'none',

  options: [
    {
      id: 'forcedCapture',
      kind: 'toggle',
      label: 'Captures are forced',
      description: 'On: if a jump exists you must take it. Off: capture only when you fancy it.',
      default: true,
    },
    {
      id: 'menCaptureBackwards',
      kind: 'toggle',
      label: 'Men jump backwards',
      description: 'Ordinary pieces may capture backwards (they still only move forwards).',
      default: false,
    },
    {
      id: 'flyingKings',
      kind: 'toggle',
      label: 'Flying kings',
      description: 'International rules: kings glide any distance and snipe from afar.',
      default: false,
    },
  ],

  setup(seats, _rng, options) {
    const board: Record<string, Piece> = {};
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        if ((c + r) % 2 === 1) board[sq(c, r)] = { seat: 0, king: false };
      }
    }
    for (let r = 5; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((c + r) % 2 === 1) board[sq(c, r)] = { seat: 1, king: false };
      }
    }
    const priv: Record<Seat, CheckersPrivate> = {};
    for (const { seat } of seats) priv[seat] = {};
    return {
      public: { board, rules: checkersRules(options), turn: 0, chain: null, lastMove: null, winner: null },
      private: priv,
    };
  },

  activePlayers(state: State) {
    if (state.public.winner !== null) return [];
    return [state.public.turn];
  },

  moves: {
    MOVE({ state, seat, payload, emit }) {
      const pub = state.public;
      if (pub.winner !== null) throw new IllegalMove('Game is over');
      if (seat !== pub.turn) throw new IllegalMove('Not your turn');
      const { from, to } = payload as { from: string; to: string };
      const legal = legalSteps(pub, seat);
      const move = legal.find((m) => m.from === from && m.to === to);
      if (!move) throw new IllegalMove('Illegal move (captures are forced)');

      const piece = pub.board[from]!;
      delete pub.board[from];
      if (move.captured) delete pub.board[move.captured];
      pub.board[to] = piece;
      pub.lastMove = { from, to, captured: move.captured };
      emit({
        kind: move.captured ? 'capture' : 'move',
        seat,
        text: move.captured ? `jumps ${from} → ${to}, taking a piece` : `${from} → ${to}`,
        data: { from, to, captured: move.captured ?? null },
        holdMs: move.captured ? 1100 : 700,
      });

      // promotion (ends any chain)
      const [, r] = parse(to);
      const promoted = !piece.king && ((piece.seat === 0 && r === 7) || (piece.seat === 1 && r === 0));
      if (promoted) {
        piece.king = true;
        emit({ kind: 'build', seat, text: 'crowns a king!', data: { at: to }, holdMs: 1400 });
      }

      // chain continuation?
      if (move.captured && !promoted) {
        const more = movesForPiece(pub.board, to, rulesOf(pub)).filter((m) => m.captured);
        if (more.length > 0) {
          pub.chain = to;
          return; // same player continues
        }
      }
      pub.chain = null;
      pub.turn = pub.turn === 0 ? 1 : 0;

      // loser check: next player has no move
      if (legalSteps(pub, pub.turn).length === 0) {
        pub.winner = pub.turn === 0 ? 1 : 0;
      }
    },
  },

  legalMoves(state, seat) {
    const pub = state.public;
    if (pub.winner !== null || seat !== pub.turn) return [];
    return legalSteps(pub, seat).map((m) => ({ kind: 'MOVE' as const, from: m.from, to: m.to }));
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  view(state) {
    return state.public;
  },

  disconnectOptions() {
    return ['pause', 'kick']; // a checkers turn cannot be passed
  },

  onPlayerRemoved(state, seat) {
    const pub = state.public;
    if (pub.winner === null) pub.winner = seat === 0 ? 1 : 0;
  },
};
