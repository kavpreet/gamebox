import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';

/**
 * Ludo — classic rules, 2–4 players:
 * - Roll a 6 to bring a token out of the yard; a 6 also grants another roll.
 * - 52-square main track; each player enters 13 squares after the previous.
 * - Landing on a lone opponent token (off the safe squares) captures it.
 * - After 51 track squares a token turns into its 5-square home column and
 *   needs an exact roll to reach home (progress 56). First player with all
 *   4 tokens home wins.
 * - No blocks / triple-six forfeit — deliberately simplified.
 *
 * Token progress encoding: -1 yard · 0–50 main track (global square =
 * (entry + progress) % 52) · 51–55 home column · 56 home.
 */

export const TRACK_LEN = 52;
export const HOME = 56;
export const ENTRY_SPACING = 13;
/** Entry squares (progress 0) and star squares — no captures here. */
export const SAFE_GLOBALS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export interface LudoPublic {
  /** seat → 4 token progress values */
  tokens: Record<Seat, number[]>;
  /** seat → entry offset on the global track */
  entries: Record<Seat, number>;
  order: Seat[];
  turnIndex: number;
  phase: 'ROLL' | 'MOVE';
  die: number | null;
  lastEvent: string | null;
  winner: Seat | null;
}

export type LudoPrivate = Record<string, never>;
export type LudoMove = { kind: 'ROLL' } | { kind: 'MOVE'; token: number };

type State = GameState<LudoPublic, LudoPrivate>;

function currentSeat(pub: LudoPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

export function globalSquare(pub: LudoPublic, seat: Seat, progress: number): number | null {
  if (progress < 0 || progress > 50) return null;
  return ((pub.entries[seat] ?? 0) + progress) % TRACK_LEN;
}

/** Which of `seat`'s tokens may move with this die roll. */
export function movableTokens(pub: LudoPublic, seat: Seat, die: number): number[] {
  const tokens = pub.tokens[seat] ?? [];
  const result: number[] = [];
  tokens.forEach((progress, i) => {
    if (progress === -1) {
      if (die === 6) result.push(i);
      return;
    }
    if (progress === HOME) return;
    if (progress + die <= HOME) result.push(i);
  });
  return result;
}

function advanceTurn(pub: LudoPublic, extraTurn: boolean): void {
  pub.phase = 'ROLL';
  pub.die = null;
  if (!extraTurn) {
    pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  }
}

export const ludo: GameModule<LudoPublic, LudoPrivate, LudoMove> = {
  slug: 'ludo',
  displayName: 'Ludo',
  description: 'Race all four tokens home — sixes free you, landings send foes back.',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 4,
  teams: 'none',

  setup(seats) {
    const tokens: Record<Seat, number[]> = {};
    const entries: Record<Seat, number> = {};
    const priv: Record<Seat, LudoPrivate> = {};
    seats.forEach(({ seat }, i) => {
      tokens[seat] = [-1, -1, -1, -1];
      entries[seat] = (i * ENTRY_SPACING) % TRACK_LEN;
      priv[seat] = {};
    });
    return {
      public: {
        tokens,
        entries,
        order: seats.map((s) => s.seat),
        turnIndex: 0,
        phase: 'ROLL',
        die: null,
        lastEvent: null,
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
    ROLL({ state, seat, rng }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ROLL') throw new IllegalMove('You already rolled — move a token');

      const die = rng.int(1, 6);
      pub.die = die;
      pub.lastEvent = `rolled a ${die}`;

      const movable = movableTokens(pub, seat, die);
      if (movable.length === 0) {
        pub.lastEvent = `rolled a ${die} — no moves`;
        advanceTurn(pub, false); // even a 6 with no moves passes (all home edge case)
      } else {
        pub.phase = 'MOVE';
      }
    },

    MOVE({ state, seat, payload }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'MOVE' || pub.die === null) throw new IllegalMove('Roll first');
      const tokenIdx = (payload as { token: number }).token;
      const die = pub.die;
      if (!movableTokens(pub, seat, die).includes(tokenIdx)) {
        throw new IllegalMove('That token cannot move');
      }

      const tokens = pub.tokens[seat]!;
      const from = tokens[tokenIdx]!;
      const to = from === -1 ? 0 : from + die;
      tokens[tokenIdx] = to;
      pub.lastEvent = from === -1 ? 'brought a token out' : `moved ${die}`;

      // Captures — only on the shared main track, never on safe squares.
      const landedGlobal = globalSquare(pub, seat, to);
      if (landedGlobal !== null && !SAFE_GLOBALS.has(landedGlobal)) {
        for (const otherSeat of pub.order) {
          if (otherSeat === seat) continue;
          const others = pub.tokens[otherSeat]!;
          others.forEach((p, i) => {
            if (globalSquare(pub, otherSeat, p) === landedGlobal) {
              others[i] = -1;
              pub.lastEvent = 'captured a token!';
            }
          });
        }
      }

      if (tokens.every((p) => p === HOME)) {
        pub.winner = seat;
        return;
      }
      advanceTurn(pub, die === 6);
    },
  },

  legalMoves(state, seat) {
    const pub = state.public;
    if (pub.winner !== null || seat !== currentSeat(pub)) return [];
    if (pub.phase === 'ROLL') return [{ kind: 'ROLL' }];
    return movableTokens(pub, seat, pub.die!).map((token) => ({ kind: 'MOVE' as const, token }));
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  view(state) {
    return state.public; // fully public game
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const pub = state.public;
    if (currentSeat(pub) === seat) {
      advanceTurn(pub, false);
    }
  },

  onPlayerRemoved(state, seat) {
    const pub = state.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    const wasCurrent = currentSeat(pub) === seat;
    const nextSeat = wasCurrent ? pub.order[(pub.turnIndex + 1) % pub.order.length] : currentSeat(pub);
    pub.order.splice(idx, 1);
    delete pub.tokens[seat];
    if (pub.order.length > 0) {
      const ni = pub.order.indexOf(nextSeat as Seat);
      pub.turnIndex = ni === -1 ? 0 : ni;
      if (wasCurrent) {
        pub.phase = 'ROLL';
        pub.die = null;
      }
    }
    if (pub.order.length === 1) {
      pub.winner = pub.order[0] as Seat;
    }
  },
};
