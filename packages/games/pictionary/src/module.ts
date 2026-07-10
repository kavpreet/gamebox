import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { PICTIONARY_WORDS } from './words.js';

/**
 * Pictionary — live drawing streamed through the ordinary move pipeline. The
 * drawer's STROKE moves append to public state, so every phone and the TV
 * replays the picture in real time; the secret word sits in the hidden zone
 * and view() shows it only to the drawer. Everyone is "active" at once —
 * the drawer to draw, the rest to guess.
 *
 * Scoring: first correct guess ends the round — guesser +2, drawer +1.
 * Each player draws twice; highest total wins. No wall-clock timer (the
 * engine is move-driven); the drawer can SKIP a hopeless word for 0 points.
 */

export interface Stroke {
  color: string;
  width: number;
  /** flattened [x0,y0,x1,y1,…] in normalized 0..1 canvas coordinates */
  points: number[];
}

export interface GuessEntry {
  seat: Seat;
  text: string;
  correct: boolean;
}

export interface PictionaryPublic {
  round: number; // 1-based
  totalRounds: number;
  drawer: Seat;
  strokes: Stroke[];
  guesses: GuessEntry[];
  wordLength: number; // hint: characters incl. spaces
  wordHint: string; // e.g. "_ _ _   _ _" pattern
  revealedWord: string | null; // last round's word, shown between rounds
  scores: Record<Seat, number>;
  order: Seat[];
  gameOver: boolean;
  winners: Seat[] | null;
  lastEvent: string | null;
}

interface Hidden {
  deck: string[];
  currentWord: string;
}

export type PictionaryMove =
  | { kind: 'STROKE'; color: string; width: number; points: number[] }
  | { kind: 'UNDO' }
  | { kind: 'CLEAR' }
  | { kind: 'GUESS'; text: string }
  | { kind: 'SKIP' };

const HIDDEN_ZONE = -1 as Seat;
const MAX_STROKES = 800;
const MAX_POINTS_PER_STROKE = 2000;
const MAX_GUESS_LOG = 60;

type State = GameState<PictionaryPublic, Hidden | Record<string, never>>;

function hiddenOf(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
}

function hintFor(word: string): string {
  return word.replace(/[^\s]/g, '_').split('').join(' ');
}

function nextWord(s: State): void {
  const h = hiddenOf(s);
  h.currentWord = h.deck.pop() ?? 'mystery';
  s.public.wordLength = h.currentWord.length;
  s.public.wordHint = hintFor(h.currentWord);
}

function beginRound(s: State): void {
  const pub = s.public;
  pub.strokes = [];
  pub.guesses = [];
  pub.drawer = pub.order[(pub.round - 1) % pub.order.length]!;
  nextWord(s);
}

function finishRound(s: State, reason: string): void {
  const pub = s.public;
  pub.revealedWord = hiddenOf(s).currentWord;
  pub.lastEvent = reason;
  if (pub.round >= pub.totalRounds) {
    pub.gameOver = true;
    const best = Math.max(...pub.order.map((seat) => pub.scores[seat] ?? 0));
    pub.winners = pub.order.filter((seat) => (pub.scores[seat] ?? 0) === best);
    return;
  }
  pub.round++;
  beginRound(s);
}

export const pictionary: GameModule<PictionaryPublic, Hidden | Record<string, never>, PictionaryMove> = {
  slug: 'pictionary',
  displayName: 'Pictionary',
  rulesVersion: '1.0.0',
  minPlayers: 3,
  maxPlayers: 10,
  teams: 'none',

  setup(seats, rng) {
    const order = seats.map((x) => x.seat);
    const scores: Record<Seat, number> = {};
    for (const seat of order) scores[seat] = 0;
    const state: State = {
      public: {
        round: 1,
        totalRounds: order.length * 2, // everyone draws twice
        drawer: order[0]!,
        strokes: [],
        guesses: [],
        wordLength: 0,
        wordHint: '',
        revealedWord: null,
        scores,
        order,
        gameOver: false,
        winners: null,
        lastEvent: null,
      },
      private: { [HIDDEN_ZONE]: { deck: rng.shuffle([...PICTIONARY_WORDS]), currentWord: '' } },
    };
    beginRound(state);
    return state;
  },

  activePlayers(state) {
    // drawer draws, everyone else may guess at any moment — all seats active
    if (state.public.gameOver) return [];
    return state.public.order;
  },

  moves: {
    STROKE({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.gameOver) throw new IllegalMove('Game over');
      if (seat !== pub.drawer) throw new IllegalMove('Only the drawer draws');
      if (pub.strokes.length >= MAX_STROKES) throw new IllegalMove('Drawing is full — undo or clear');
      const { color, width, points } = payload as Stroke;
      if (!Array.isArray(points) || points.length < 4 || points.length % 2 !== 0) {
        throw new IllegalMove('A stroke needs at least two points');
      }
      if (points.length > MAX_POINTS_PER_STROKE) throw new IllegalMove('Stroke too long');
      if (points.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) {
        throw new IllegalMove('Points must be normalized 0..1');
      }
      const w = Number(width);
      pub.strokes.push({
        color: /^#[0-9a-fA-F]{6}$/.test(String(color)) ? String(color) : '#eef0ff',
        width: Number.isFinite(w) ? Math.min(Math.max(w, 0.002), 0.05) : 0.008,
        points: points.map((v) => Math.round(v * 1000) / 1000),
      });
    },

    UNDO({ state, seat }) {
      const s = state as State;
      if (seat !== s.public.drawer) throw new IllegalMove('Only the drawer draws');
      s.public.strokes.pop();
    },

    CLEAR({ state, seat }) {
      const s = state as State;
      if (seat !== s.public.drawer) throw new IllegalMove('Only the drawer draws');
      s.public.strokes = [];
    },

    GUESS({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.gameOver) throw new IllegalMove('Game over');
      if (seat === pub.drawer) throw new IllegalMove('The drawer cannot guess');
      const text = String((payload as { text: string }).text ?? '').slice(0, 60);
      if (!normalize(text)) throw new IllegalMove('Say something!');
      const correct = normalize(text) === normalize(hiddenOf(s).currentWord);
      pub.guesses.push({ seat, text, correct });
      if (pub.guesses.length > MAX_GUESS_LOG) pub.guesses.splice(0, pub.guesses.length - MAX_GUESS_LOG);
      if (correct) {
        pub.scores[seat] = (pub.scores[seat] ?? 0) + 2;
        pub.scores[pub.drawer] = (pub.scores[pub.drawer] ?? 0) + 1;
        finishRound(s, `got it — "${hiddenOf(s).currentWord}"!`);
      }
    },

    SKIP({ state, seat }) {
      const s = state as State;
      const pub = s.public;
      if (pub.gameOver) throw new IllegalMove('Game over');
      if (seat !== pub.drawer) throw new IllegalMove('Only the drawer can skip');
      finishRound(s, 'skipped the word');
    },
  },

  endIf(state) {
    const pub = state.public;
    if (pub.gameOver && pub.winners) return { winners: pub.winners };
    return null;
  },

  view(state, viewer) {
    const s = state as State;
    const pub = s.public;
    if (viewer === pub.drawer) {
      return { ...pub, word: hiddenOf(s).currentWord };
    }
    return { ...pub, word: null };
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.gameOver) return;
    // skipping only matters when the stuck player is the drawer
    if (seat === pub.drawer) finishRound(s, 'drawer was skipped');
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    const wasDrawer = pub.drawer === seat;
    pub.order.splice(idx, 1);
    delete pub.scores[seat];
    if (pub.order.length < 2) {
      pub.gameOver = true;
      pub.winners = pub.order.length === 1 ? [pub.order[0]!] : [];
      return;
    }
    // keep total rounds proportional and never below the current round
    pub.totalRounds = Math.max(pub.round, pub.order.length * 2);
    if (wasDrawer) {
      pub.round = Math.min(pub.round, pub.totalRounds);
      pub.revealedWord = hiddenOf(s).currentWord;
      pub.lastEvent = 'drawer left';
      if (pub.round >= pub.totalRounds) {
        pub.gameOver = true;
        const best = Math.max(...pub.order.map((x) => pub.scores[x] ?? 0));
        pub.winners = pub.order.filter((x) => (pub.scores[x] ?? 0) === best);
      } else {
        pub.round++;
        beginRound(s);
      }
    }
  },
};
