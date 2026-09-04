import type { GameModule, GameOptions, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';

/**
 * Ludo — classic rules, 2–4 players:
 * - Roll a 6 to bring a token out of the yard; a 6 also grants another roll.
 * - 52-square main track; each player enters 13 squares after the previous.
 * - Landing on a lone opponent token (off the safe squares) captures it.
 * - After 51 track squares a token turns into its 5-square home column and
 *   needs an exact roll to reach home (progress 56). First player with all
 *   4 tokens home wins.
 *
 * Everything anyone's family argues about — out on a 1, extra turn for a
 * capture, blockades, three-sixes-forfeit — is a lobby option (see `options`
 * below), resolved once at setup into public `rules` so every later rule check
 * reads from state.
 *
 * Token progress encoding: -1 yard · 0–50 main track (global square =
 * (entry + progress) % 52) · 51–55 home column · 56 home.
 */

export const TRACK_LEN = 52;
export const HOME = 56;
export const ENTRY_SPACING = 13;
/** Entry squares (progress 0) and star squares — no captures here. */
export const SAFE_GLOBALS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

/** House rules, resolved from the lobby options at setup. */
export interface LudoRules {
  enterOn1: boolean;
  captureExtraTurn: boolean;
  homeExtraTurn: boolean;
  blockades: boolean;
  exactHome: boolean;
  tripleSixForfeit: boolean;
}

export const LUDO_STANDARD_RULES: LudoRules = {
  enterOn1: false,
  captureExtraTurn: false,
  homeExtraTurn: false,
  blockades: false,
  exactHome: true,
  tripleSixForfeit: false,
};

export interface LudoPublic {
  /** seat → 4 token progress values */
  tokens: Record<Seat, number[]>;
  /** seat → entry offset on the global track */
  entries: Record<Seat, number>;
  order: Seat[];
  turnIndex: number;
  phase: 'ROLL' | 'MOVE';
  die: number | null;
  /** consecutive sixes this turn — drives the triple-six forfeit rule */
  sixStreak: number;
  rules: LudoRules;
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

function rulesOf(pub: LudoPublic): LudoRules {
  return pub.rules ?? LUDO_STANDARD_RULES;
}

function ludoRules(options: GameOptions): LudoRules {
  const on = (id: keyof LudoRules) => (options[id] ?? LUDO_STANDARD_RULES[id]) === true;
  return {
    enterOn1: on('enterOn1'),
    captureExtraTurn: on('captureExtraTurn'),
    homeExtraTurn: on('homeExtraTurn'),
    blockades: on('blockades'),
    exactHome: on('exactHome'),
    tripleSixForfeit: on('tripleSixForfeit'),
  };
}

/** Does this die free a token from the yard? (house rule: a 1 works too) */
export function canLeaveYard(pub: LudoPublic, die: number): boolean {
  return die === 6 || (rulesOf(pub).enterOn1 && die === 1);
}

/** Where a token at `progress` ends up on this roll (HOME-clamped when inexact finishing is on). */
export function destinationOf(pub: LudoPublic, progress: number, die: number): number | null {
  if (progress === HOME) return null;
  if (progress === -1) return canLeaveYard(pub, die) ? 0 : null;
  const raw = progress + die;
  if (raw <= HOME) return raw;
  return rulesOf(pub).exactHome ? null : HOME;
}

/** Squares holding two or more tokens of a single other seat — nobody may pass or land. */
function blockedGlobals(pub: LudoPublic, seat: Seat): Set<number> {
  const blocked = new Set<number>();
  for (const other of pub.order) {
    if (other === seat) continue;
    const counts = new Map<number, number>();
    for (const progress of pub.tokens[other] ?? []) {
      const g = globalSquare(pub, other, progress);
      if (g === null) continue;
      const n = (counts.get(g) ?? 0) + 1;
      counts.set(g, n);
      if (n >= 2) blocked.add(g);
    }
  }
  return blocked;
}

/** Blockade check across every main-track square the token would cross. */
function pathBlocked(pub: LudoPublic, seat: Seat, from: number, to: number): boolean {
  if (!rulesOf(pub).blockades) return false;
  const blocked = blockedGlobals(pub, seat);
  if (blocked.size === 0) return false;
  const first = from === -1 ? 0 : from + 1;
  for (let p = first; p <= Math.min(to, 50); p++) {
    const g = globalSquare(pub, seat, p);
    if (g !== null && blocked.has(g)) return true;
  }
  return false;
}

/** Which of `seat`'s tokens may move with this die roll. */
export function movableTokens(pub: LudoPublic, seat: Seat, die: number): number[] {
  const tokens = pub.tokens[seat] ?? [];
  const result: number[] = [];
  tokens.forEach((progress, i) => {
    const dest = destinationOf(pub, progress, die);
    if (dest === null) return;
    if (pathBlocked(pub, seat, progress, dest)) return;
    result.push(i);
  });
  return result;
}

function advanceTurn(pub: LudoPublic, extraTurn: boolean): void {
  pub.phase = 'ROLL';
  pub.die = null;
  if (!extraTurn) {
    pub.sixStreak = 0;
    pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  }
}

export const ludo: GameModule<LudoPublic, LudoPrivate, LudoMove> = {
  slug: 'ludo',
  displayName: 'Ludo',
  description: 'Race all four tokens home — sixes free you, landings send foes back.',
  rulesVersion: '1.1.0',
  minPlayers: 2,
  maxPlayers: 4,
  teams: 'none',

  options: [
    {
      id: 'enterOn1',
      kind: 'toggle',
      label: 'Out on a 1',
      description: 'A 1 frees a token from the yard, not just a 6.',
      default: false,
    },
    {
      id: 'captureExtraTurn',
      kind: 'toggle',
      label: 'Extra turn on capture',
      description: 'Send an opponent home and you roll again.',
      default: false,
    },
    {
      id: 'homeExtraTurn',
      kind: 'toggle',
      label: 'Extra turn on reaching home',
      description: 'Landing a token on home earns another roll.',
      default: false,
    },
    {
      id: 'blockades',
      kind: 'toggle',
      label: 'Blockades',
      description: 'Two of your tokens on one square: nobody else may pass or land there.',
      default: false,
    },
    {
      id: 'exactHome',
      kind: 'toggle',
      label: 'Exact roll to finish',
      description: 'On: overshooting home wastes the move. Off: any roll big enough gets you in.',
      default: true,
    },
    {
      id: 'tripleSixForfeit',
      kind: 'toggle',
      label: 'Three sixes forfeits',
      description: 'Roll three sixes in a row and your turn ends immediately.',
      default: false,
    },
  ],

  setup(seats, _rng, options) {
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
        sixStreak: 0,
        rules: ludoRules(options),
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
    ROLL({ state, seat, rng, emit }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ROLL') throw new IllegalMove('You already rolled — move a token');

      const die = rng.int(1, 6);
      pub.die = die;
      pub.sixStreak = die === 6 ? pub.sixStreak + 1 : 0;
      pub.lastEvent = `rolled a ${die}`;
      emit({ kind: 'dice', seat, text: `throws a ${die}`, data: { dice: [die] }, holdMs: 1200 });

      if (rulesOf(pub).tripleSixForfeit && pub.sixStreak >= 3) {
        pub.lastEvent = 'three sixes — turn forfeited!';
        emit({ kind: 'jail', seat, text: 'three sixes — turn forfeited!', holdMs: 1600 });
        advanceTurn(pub, false);
        emit({ kind: 'turn', seat: currentSeat(pub), text: 'to throw', holdMs: 600 });
        return;
      }

      const movable = movableTokens(pub, seat, die);
      if (movable.length === 0) {
        pub.lastEvent = `rolled a ${die} — no moves`;
        emit({ kind: 'say', seat, text: 'has no legal move', holdMs: 1200 });
        advanceTurn(pub, false); // even a 6 with no moves passes (all home edge case)
        emit({ kind: 'turn', seat: currentSeat(pub), text: 'to throw', holdMs: 600 });
      } else {
        pub.phase = 'MOVE';
      }
    },

    MOVE({ state, seat, payload, emit }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'MOVE' || pub.die === null) throw new IllegalMove('Roll first');
      const tokenIdx = (payload as { token: number }).token;
      const die = pub.die;
      if (!movableTokens(pub, seat, die).includes(tokenIdx)) {
        throw new IllegalMove('That token cannot move');
      }

      const rules = rulesOf(pub);
      const tokens = pub.tokens[seat]!;
      const from = tokens[tokenIdx]!;
      const to = destinationOf(pub, from, die)!;
      tokens[tokenIdx] = to;
      pub.lastEvent = from === -1 ? 'brought a token out' : `moved ${die}`;
      emit({
        kind: 'move',
        seat,
        text: from === -1 ? 'brings a token out of the yard' : `walks a token ${die}`,
        data: { token: tokenIdx, from, to, steps: from === -1 ? 1 : die },
        holdMs: from === -1 ? 900 : 250 + die * 200,
      });

      // Captures — only on the shared main track, never on safe squares.
      let captured = false;
      const landedGlobal = globalSquare(pub, seat, to);
      if (landedGlobal !== null && !SAFE_GLOBALS.has(landedGlobal)) {
        for (const otherSeat of pub.order) {
          if (otherSeat === seat) continue;
          const others = pub.tokens[otherSeat]!;
          others.forEach((p, i) => {
            if (globalSquare(pub, otherSeat, p) === landedGlobal) {
              others[i] = -1;
              captured = true;
              pub.lastEvent = 'captured a token!';
              emit({
                kind: 'capture',
                seat,
                text: 'sends a token back to the yard!',
                data: { victim: otherSeat, token: i, at: landedGlobal },
                holdMs: 1600,
              });
            }
          });
        }
      }

      if (to === HOME) emit({ kind: 'build', seat, text: 'gets a token home!', holdMs: 1400 });
      if (tokens.every((p) => p === HOME)) {
        pub.winner = seat;
        emit({ kind: 'reveal', seat, text: 'has every token home — wins!', holdMs: 2400 });
        return;
      }
      const reachedHome = to === HOME;
      if (captured && rules.captureExtraTurn) pub.lastEvent = 'captured a token — roll again!';
      else if (reachedHome && rules.homeExtraTurn) pub.lastEvent = 'token home — roll again!';
      const extraTurn =
        die === 6 ||
        (captured && rules.captureExtraTurn) ||
        (reachedHome && rules.homeExtraTurn);
      advanceTurn(pub, extraTurn);
      emit(
        extraTurn
          ? { kind: 'turn', seat, text: 'throws again', holdMs: 800 }
          : { kind: 'turn', seat: currentSeat(pub), text: 'to throw', holdMs: 600 },
      );
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
