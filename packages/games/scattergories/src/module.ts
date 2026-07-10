import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { CATEGORY_BANK, LETTERS, CATEGORIES_PER_ROUND, TOTAL_ROUNDS } from './categories.js';

/**
 * Scattergories — the simultaneous-play stress test: during ANSWER every seat
 * is active at once and each player's answers sit in their PRIVATE zone until
 * everyone has submitted (nobody can crib). Then a VOTE phase where players
 * veto answers they think don't count; a strict majority of the other players
 * kills an answer. Scoring: valid + unique = 1 point.
 *
 * No wall-clock timer (the engine is move-driven) — the pressure is social:
 * the TV shows who everyone is waiting on.
 */

export interface RoundResult {
  letter: string;
  categories: string[];
  answers: Record<Seat, string[]>;
  accepted: Record<Seat, boolean[]>;
  points: Record<Seat, number>;
}

export interface ScattergoriesPublic {
  round: number; // 1-based
  totalRounds: number;
  letter: string;
  categories: string[];
  phase: 'ANSWER' | 'VOTE' | 'DONE';
  submitted: Seat[]; // seats done with the current phase
  /** revealed only during VOTE (and preserved in history) */
  answers: Record<Seat, string[]> | null;
  /** running veto tallies per (seat, category) during VOTE — count of vetoes */
  vetoCounts: Record<Seat, number[]> | null;
  scores: Record<Seat, number>;
  history: RoundResult[];
  order: Seat[];
  winners: Seat[] | null;
  lastEvent: string | null;
}

interface SeatPrivate {
  pendingAnswers: string[] | null;
  pendingVetoes: { seat: Seat; index: number }[] | null;
}

interface Hidden {
  categoryDeck: string[];
  letterDeck: string[];
}

export type ScattergoriesMove =
  | { kind: 'SUBMIT'; answers: string[] }
  | { kind: 'VOTE'; vetoes: { seat: Seat; index: number }[] };

const HIDDEN_ZONE = -1 as Seat;
type State = GameState<ScattergoriesPublic, SeatPrivate | Hidden>;

function hiddenOf(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}
function privOf(s: State, seat: Seat): SeatPrivate {
  return s.private[seat] as SeatPrivate;
}

function normalize(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

function startRound(s: State): void {
  const pub = s.public;
  const h = hiddenOf(s);
  pub.letter = h.letterDeck.pop() ?? 'S';
  pub.categories = h.categoryDeck.splice(0, CATEGORIES_PER_ROUND);
  pub.phase = 'ANSWER';
  pub.submitted = [];
  pub.answers = null;
  pub.vetoCounts = null;
  for (const seat of pub.order) {
    privOf(s, seat).pendingAnswers = null;
    privOf(s, seat).pendingVetoes = null;
  }
}

function beginVote(s: State): void {
  const pub = s.public;
  pub.phase = 'VOTE';
  pub.submitted = [];
  pub.answers = {};
  pub.vetoCounts = {};
  for (const seat of pub.order) {
    pub.answers[seat] = privOf(s, seat).pendingAnswers ?? Array(pub.categories.length).fill('');
    pub.vetoCounts[seat] = Array(pub.categories.length).fill(0);
  }
}

function scoreRound(s: State): void {
  const pub = s.public;
  const n = pub.categories.length;
  const majority = Math.floor((pub.order.length - 1) / 2) + 1; // strict majority of the others

  const accepted: Record<Seat, boolean[]> = {};
  for (const seat of pub.order) {
    accepted[seat] = pub.categories.map((_, i) => {
      const a = normalize(pub.answers![seat]![i] ?? '');
      if (!a) return false;
      if (!a.startsWith(pub.letter.toLowerCase())) return false;
      if ((pub.vetoCounts![seat]![i] ?? 0) >= majority && pub.order.length > 2) return false;
      // 2 players: a single veto (= the only other player) kills it
      if (pub.order.length === 2 && (pub.vetoCounts![seat]![i] ?? 0) >= 1) return false;
      return true;
    });
  }

  const points: Record<Seat, number> = {};
  for (const seat of pub.order) points[seat] = 0;
  for (let i = 0; i < n; i++) {
    const valid = pub.order.filter((seat) => accepted[seat]![i]);
    for (const seat of valid) {
      const mine = normalize(pub.answers![seat]![i]!);
      const dup = valid.some((other) => other !== seat && normalize(pub.answers![other]![i]!) === mine);
      if (!dup) points[seat]!++;
    }
  }

  for (const seat of pub.order) pub.scores[seat] = (pub.scores[seat] ?? 0) + points[seat]!;
  pub.history.push({
    letter: pub.letter,
    categories: pub.categories,
    answers: pub.answers!,
    accepted,
    points,
  });
  pub.lastEvent = `Round ${pub.round} scored`;

  if (pub.round >= pub.totalRounds) {
    pub.phase = 'DONE';
    const best = Math.max(...pub.order.map((seat) => pub.scores[seat] ?? 0));
    pub.winners = pub.order.filter((seat) => (pub.scores[seat] ?? 0) === best);
  } else {
    pub.round++;
    startRound(s);
  }
}

function markSubmitted(s: State, seat: Seat): void {
  const pub = s.public;
  if (!pub.submitted.includes(seat)) pub.submitted.push(seat);
  if (pub.submitted.length >= pub.order.length) {
    if (pub.phase === 'ANSWER') beginVote(s);
    else if (pub.phase === 'VOTE') scoreRound(s);
  }
}

export const scattergories: GameModule<ScattergoriesPublic, SeatPrivate | Hidden, ScattergoriesMove> = {
  slug: 'scattergories',
  displayName: 'Scattergories',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 10,
  teams: 'none',

  setup(seats, rng) {
    const order = seats.map((x) => x.seat);
    const scores: Record<Seat, number> = {};
    const priv: Record<Seat, SeatPrivate | Hidden> = {
      [HIDDEN_ZONE]: {
        categoryDeck: rng.shuffle([...CATEGORY_BANK]),
        letterDeck: rng.shuffle([...LETTERS]),
      },
    };
    for (const seat of order) {
      scores[seat] = 0;
      priv[seat] = { pendingAnswers: null, pendingVetoes: null };
    }
    const state: State = {
      public: {
        round: 1,
        totalRounds: TOTAL_ROUNDS,
        letter: '',
        categories: [],
        phase: 'ANSWER',
        submitted: [],
        answers: null,
        vetoCounts: null,
        scores,
        history: [],
        order,
        winners: null,
        lastEvent: null,
      },
      private: priv,
    };
    startRound(state);
    return state;
  },

  activePlayers(state) {
    const pub = state.public;
    if (pub.phase === 'DONE') return [];
    return pub.order.filter((seat) => !pub.submitted.includes(seat));
  },

  moves: {
    SUBMIT({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'ANSWER') throw new IllegalMove('Not the answering phase');
      if (pub.submitted.includes(seat)) throw new IllegalMove('You already submitted');
      const raw = (payload as { answers: string[] }).answers;
      if (!Array.isArray(raw)) throw new IllegalMove('Bad answers');
      const answers = pub.categories.map((_, i) => String(raw[i] ?? '').slice(0, 60));
      privOf(s, seat).pendingAnswers = answers;
      markSubmitted(s, seat);
    },

    VOTE({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'VOTE') throw new IllegalMove('Not the voting phase');
      if (pub.submitted.includes(seat)) throw new IllegalMove('You already voted');
      const raw = (payload as { vetoes?: { seat: number; index: number }[] }).vetoes ?? [];
      if (!Array.isArray(raw)) throw new IllegalMove('Bad vetoes');
      for (const v of raw) {
        const target = Number(v.seat) as Seat;
        const idx = Number(v.index);
        if (target === seat) continue; // can't veto yourself
        if (!pub.order.includes(target)) continue;
        if (!Number.isInteger(idx) || idx < 0 || idx >= pub.categories.length) continue;
        pub.vetoCounts![target]![idx]!++;
      }
      privOf(s, seat).pendingVetoes = raw as { seat: Seat; index: number }[];
      markSubmitted(s, seat);
    },
  },

  endIf(state) {
    const pub = state.public;
    if (pub.phase === 'DONE' && pub.winners) return { winners: pub.winners };
    return null;
  },

  view(state, viewer) {
    const s = state as State;
    const pub = s.public;
    if (viewer === 'SPECTATOR' || !(viewer in s.private) || viewer === HIDDEN_ZONE) {
      return { ...pub, yourAnswers: null };
    }
    // your own in-progress answers (so a reconnect restores the filled form)
    return { ...pub, yourAnswers: privOf(s, viewer as Seat).pendingAnswers };
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.phase === 'DONE' || pub.submitted.includes(seat)) return;
    if (pub.phase === 'ANSWER') privOf(s, seat).pendingAnswers = Array(pub.categories.length).fill('');
    markSubmitted(s, seat);
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    pub.order.splice(idx, 1);
    pub.submitted = pub.submitted.filter((x) => x !== seat);
    delete pub.scores[seat];
    delete s.private[seat];
    if (pub.answers) delete pub.answers[seat];
    if (pub.vetoCounts) delete pub.vetoCounts[seat];
    if (pub.order.length === 1) {
      pub.phase = 'DONE';
      pub.winners = [pub.order[0]!];
      return;
    }
    // the departed seat may have been the only one everyone was waiting on
    if (pub.phase !== 'DONE' && pub.submitted.length >= pub.order.length) {
      if (pub.phase === 'ANSWER') beginVote(s);
      else if (pub.phase === 'VOTE') scoreRound(s);
    }
  },
};
