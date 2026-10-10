import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { type Card, FREE, ballLabel, cardNumbers, generateCard75, generateCard90 } from './cards.js';
import { PRESETS, PRIZE_BY_ID } from './prizes.js';

/**
 * Bingo — 75-ball (5×5, free centre) or 90-ball (tambola tickets), with a
 * configurable list of prizes. The host (seat 0) picks the setup in-game,
 * then numbers are drawn automatically on a timer, round-robin by each
 * player in turn, or — in combat mode — each player in turn CHOOSES the next
 * number, trying to help their own card and starve everyone else's.
 *
 * Marking is honour-system: players may dab ANY number on their card, called
 * or not. Claims are verified — a prize is awarded only if its pattern is
 * covered by numbers that are both marked and actually called. A false claim
 * (a "bogey") costs the configured penalty.
 *
 * Timing: the engine is move-driven, so auto mode stores `nextCallAt` and a
 * connected phone submits DRAW when it falls due; the server rejects early
 * draws and treats a stale one (someone else already drew) as a no-op.
 *
 * Shared prizes: a prize stays open to further claims until the next ball is
 * drawn, so two players completing on the same ball split its points.
 */

export type CallMode = 'auto' | 'roundRobin' | 'combat';

export interface BingoConfig {
  balls: 75 | 90;
  callMode: CallMode;
  intervalSec: number;
  cardsPerPlayer: number;
  penalty: number;
  prizes: { id: string; points: number }[];
}

export interface PrizeState {
  id: string;
  name: string;
  points: number;
  winners: { seat: Seat; card: number }[];
  wonAtCall: number | null; // calls.length when first won
}

export interface LogEntry {
  kind: 'call' | 'win' | 'bogey' | 'info';
  /** the player the entry is about; UIs prefix their name */
  seat?: Seat;
  text: string;
}

export interface BingoPublic {
  phase: 'setup' | 'playing' | 'over';
  host: Seat;
  order: Seat[];
  config: BingoConfig;
  calls: number[];
  caller: Seat | null; // round-robin / combat: whose turn to call
  nextCallAt: number | null; // auto: epoch ms
  lastCallAt: number;
  autoPaused: boolean;
  prizes: PrizeState[];
  penalties: Record<Seat, number>;
  bogeys: Record<Seat, number>;
  scores: Record<Seat, number>;
  log: LogEntry[];
  winners: Seat[] | null;
}

export interface PlayerCards {
  cards: Card[];
  marks: number[][]; // per card, numbers the player has dabbed
}

interface Hidden {
  bag: number[];
}

export type BingoMove =
  | { kind: 'CONFIGURE'; config: BingoConfig }
  | { kind: 'START' }
  | { kind: 'DRAW'; at: number; n?: number } // n: the chosen number (combat only)
  | { kind: 'MARK'; card: number; n: number }
  | { kind: 'CLAIM'; prize: string; card: number }
  | { kind: 'PAUSE' }
  | { kind: 'RESUME' }
  | { kind: 'SET_INTERVAL'; sec: number }
  | { kind: 'END' };

export type BingoView = BingoPublic & {
  /** ms until the next auto call, measured when this view was produced */
  msUntilNext: number | null;
  yourCards: PlayerCards | null;
};

const HIDDEN_ZONE = -1 as Seat;
const MAX_LOG = 50;
/** round-robin: if the caller sits idle this long, anyone may draw for them */
export const CALLER_STALL_MS = 45_000;
/** auto mode: slack for client clocks/timers firing a little early */
const EARLY_TOLERANCE_MS = 400;
const FIRST_CALL_DELAY_MS = 4_000;

type State = GameState<BingoPublic, PlayerCards | Hidden>;

const now = () => Date.now();

function hidden(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}

function cardsOf(s: State, seat: Seat): PlayerCards {
  return s.private[seat] as PlayerCards;
}

function log(pub: BingoPublic, kind: LogEntry['kind'], text: string, seat?: Seat): void {
  pub.log.push(seat === undefined ? { kind, text } : { kind, seat, text });
  if (pub.log.length > MAX_LOG) pub.log.splice(0, pub.log.length - MAX_LOG);
}

export function defaultConfig(balls: 75 | 90 = 75): BingoConfig {
  const preset = PRESETS.find((p) => p.balls === balls)!;
  return {
    balls,
    callMode: 'auto',
    intervalSec: 6,
    cardsPerPlayer: 1,
    penalty: 10,
    prizes: preset.prizes.map((id) => ({ id, points: PRIZE_BY_ID.get(id)!.defaultPoints })),
  };
}

function validateConfig(raw: unknown): BingoConfig {
  const c = raw as Partial<BingoConfig> | null;
  if (!c || (c.balls !== 75 && c.balls !== 90)) throw new IllegalMove('Pick 75 or 90 balls');
  if (c.callMode !== 'auto' && c.callMode !== 'roundRobin' && c.callMode !== 'combat') {
    throw new IllegalMove('Pick a calling mode');
  }
  const intInRange = (v: unknown, lo: number, hi: number, what: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new IllegalMove(`${what} must be ${lo}–${hi}`);
    return n;
  };
  const intervalSec = intInRange(c.intervalSec, 2, 60, 'Interval');
  const cardsPerPlayer = intInRange(c.cardsPerPlayer, 1, 6, 'Cards per player');
  const penalty = intInRange(c.penalty, 0, 1000, 'Penalty');
  if (!Array.isArray(c.prizes) || c.prizes.length === 0) throw new IllegalMove('Choose at least one prize');
  const seen = new Set<string>();
  const prizes = c.prizes.map((p) => {
    const def = PRIZE_BY_ID.get(String(p?.id));
    if (!def || def.balls !== c.balls) throw new IllegalMove(`Prize ${String(p?.id)} isn't available with ${c.balls} balls`);
    if (seen.has(def.id)) throw new IllegalMove(`${def.name} listed twice`);
    seen.add(def.id);
    return { id: def.id, points: intInRange(p.points, 0, 1000, `${def.name} points`) };
  });
  if (seen.has('house2') && !seen.has('house')) throw new IllegalMove('2nd Full House needs Full House too');
  return { balls: c.balls, callMode: c.callMode, intervalSec, cardsPerPlayer, penalty, prizes };
}

function recomputeScores(pub: BingoPublic): void {
  for (const seat of pub.order) pub.scores[seat] = 0 - (pub.penalties[seat] ?? 0);
  for (const prize of pub.prizes) {
    if (prize.winners.length === 0) continue;
    const share = Math.round(prize.points / prize.winners.length);
    for (const w of prize.winners) {
      if (w.seat in pub.scores) pub.scores[w.seat] = (pub.scores[w.seat] ?? 0) + share;
    }
  }
}

function finish(pub: BingoPublic, reason: string): void {
  pub.phase = 'over';
  pub.nextCallAt = null;
  pub.caller = null;
  recomputeScores(pub);
  log(pub, 'info', reason);
  if (pub.order.length === 0) {
    pub.winners = [];
    return;
  }
  const best = Math.max(...pub.order.map((s) => pub.scores[s] ?? 0));
  pub.winners = pub.order.filter((s) => (pub.scores[s] ?? 0) === best);
}

function nextInOrder(pub: BingoPublic, seat: Seat | null): Seat | null {
  if (pub.order.length === 0) return null;
  const idx = seat === null ? -1 : pub.order.indexOf(seat);
  return pub.order[(idx + 1) % pub.order.length]!;
}

/** Prizes still winnable: unclaimed, or shareable because no ball has been drawn since. */
function prizeOpen(pub: BingoPublic, prize: PrizeState): boolean {
  return prize.wonAtCall === null || prize.wonAtCall === pub.calls.length;
}

function allPrizesGone(pub: BingoPublic): boolean {
  return pub.prizes.every((p) => p.wonAtCall !== null);
}

/** Turn-based calling (a designated caller), as opposed to the auto timer. */
export function turnBased(mode: CallMode): boolean {
  return mode === 'roundRobin' || mode === 'combat';
}

/** Draw the next ball — random from the bag, or `chosen` in combat mode. */
function drawBall(s: State, seat: Seat, chosen?: number): void {
  const pub = s.public;
  const bag = hidden(s).bag;
  if (allPrizesGone(pub)) {
    finish(pub, 'All prizes won — game over!');
    return;
  }
  if (bag.length === 0) {
    finish(pub, 'Out of balls — game over!');
    return;
  }
  let n: number;
  if (chosen !== undefined) {
    const i = bag.indexOf(chosen);
    if (i === -1) {
      throw new IllegalMove(
        chosen >= 1 && chosen <= pub.config.balls ? `${chosen} has already been called` : `Pick a number 1–${pub.config.balls}`,
      );
    }
    bag.splice(i, 1);
    n = chosen;
  } else {
    n = bag.pop()!;
  }
  pub.calls.push(n);
  pub.lastCallAt = now();
  if (pub.config.callMode === 'combat') log(pub, 'call', `called ${ballLabel(pub.config.balls, n)}`, seat);
  else log(pub, 'call', ballLabel(pub.config.balls, n));
  if (pub.config.callMode === 'auto') {
    pub.nextCallAt = pub.lastCallAt + pub.config.intervalSec * 1000;
  } else {
    pub.caller = nextInOrder(pub, pub.caller);
  }
}

function requireHost(pub: BingoPublic, seat: Seat): void {
  if (seat !== pub.host) throw new IllegalMove('Only the host can do that');
}

function requirePlaying(pub: BingoPublic): void {
  if (pub.phase !== 'playing') throw new IllegalMove(pub.phase === 'setup' ? 'Game has not started' : 'Game over');
}

export const bingo: GameModule<BingoPublic, PlayerCards | Hidden, BingoMove> = {
  slug: 'bingo',
  displayName: 'Bingo / Tambola',
  rulesVersion: '1.0.0',
  minPlayers: 1,
  maxPlayers: 16,
  teams: 'none',

  setup(seats) {
    const order = seats.map((x) => x.seat);
    const zero = () => Object.fromEntries(order.map((s) => [s, 0])) as Record<Seat, number>;
    const priv: Record<Seat, PlayerCards | Hidden> = { [HIDDEN_ZONE]: { bag: [] } };
    for (const seat of order) priv[seat] = { cards: [], marks: [] };
    return {
      public: {
        phase: 'setup',
        host: order[0]!,
        order,
        config: defaultConfig(75),
        calls: [],
        caller: null,
        nextCallAt: null,
        lastCallAt: 0,
        autoPaused: false,
        prizes: [],
        penalties: zero(),
        bogeys: zero(),
        scores: zero(),
        log: [],
        winners: null,
      },
      private: priv,
    };
  },

  activePlayers(state) {
    const pub = state.public;
    if (pub.phase === 'setup') return [pub.host];
    if (pub.phase === 'over') return [];
    return pub.order; // anyone may mark / claim at any moment
  },

  moves: {
    CONFIGURE({ state, seat, payload }) {
      const pub = (state as State).public;
      requireHost(pub, seat);
      if (pub.phase !== 'setup') throw new IllegalMove('Game already started');
      pub.config = validateConfig((payload as { config: unknown }).config);
    },

    START({ state, seat, rng }) {
      const s = state as State;
      const pub = s.public;
      requireHost(pub, seat);
      if (pub.phase !== 'setup') throw new IllegalMove('Game already started');
      const cfg = pub.config;
      for (const p of pub.order) {
        const cards: Card[] = [];
        for (let i = 0; i < cfg.cardsPerPlayer; i++) {
          cards.push(cfg.balls === 75 ? generateCard75(rng) : generateCard90(rng));
        }
        s.private[p] = { cards, marks: cards.map(() => []) };
      }
      hidden(s).bag = rng.shuffle(Array.from({ length: cfg.balls }, (_, i) => i + 1));
      pub.prizes = cfg.prizes.map((p) => ({
        id: p.id,
        name: PRIZE_BY_ID.get(p.id)!.name,
        points: p.points,
        winners: [],
        wonAtCall: null,
      }));
      pub.phase = 'playing';
      pub.lastCallAt = now();
      if (cfg.callMode === 'auto') {
        pub.nextCallAt = pub.lastCallAt + FIRST_CALL_DELAY_MS;
      } else {
        pub.caller = pub.order[0]!;
      }
      log(pub, 'info', `${cfg.balls}-ball bingo — eyes down!`);
    },

    DRAW({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requirePlaying(pub);
      const at = Number((payload as { at?: number } | null)?.at);
      // a stale DRAW (another phone already drew this ball) is harmless — ignore it
      if (Number.isInteger(at) && at !== pub.calls.length) return;
      if (pub.config.callMode === 'auto') {
        if (pub.autoPaused) throw new IllegalMove('Calling is paused');
        if (pub.nextCallAt !== null && now() < pub.nextCallAt - EARLY_TOLERANCE_MS) {
          throw new IllegalMove('Next ball is not due yet');
        }
      } else if (seat !== pub.caller && now() - pub.lastCallAt < CALLER_STALL_MS) {
        throw new IllegalMove("It's not your turn to call");
      }
      let chosen: number | undefined;
      if (pub.config.callMode === 'combat' && !allPrizesGone(pub) && hidden(s).bag.length > 0) {
        chosen = Number((payload as { n?: number }).n);
        if (!Number.isInteger(chosen)) throw new IllegalMove('Choose a number to call');
      }
      drawBall(s, seat, chosen);
    },

    MARK({ state, seat, payload }) {
      const s = state as State;
      requirePlaying(s.public);
      const { card, n } = payload as { card: number; n: number };
      const mine = cardsOf(s, seat);
      const c = mine.cards[card];
      if (!c) throw new IllegalMove('No such card');
      if (!cardNumbers(c).includes(n)) throw new IllegalMove(`${n} is not on that card`);
      const marks = mine.marks[card]!;
      const i = marks.indexOf(n);
      if (i === -1) marks.push(n);
      else marks.splice(i, 1);
    },

    CLAIM({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requirePlaying(pub);
      const { prize: prizeId, card: cardIdx } = payload as { prize: string; card: number };
      const prize = pub.prizes.find((p) => p.id === prizeId);
      if (!prize) throw new IllegalMove('That prize is not in this game');
      const def = PRIZE_BY_ID.get(prize.id)!;
      const mine = cardsOf(s, seat);
      const card = mine.cards[cardIdx];
      if (!card) throw new IllegalMove('No such card');
      // procedural rejections — no penalty
      if (!prizeOpen(pub, prize)) throw new IllegalMove(`${prize.name} has already been won`);
      if (prize.winners.some((w) => w.seat === seat)) throw new IllegalMove(`You already won ${prize.name}`);
      if (prize.id === 'house2') {
        const first = pub.prizes.find((p) => p.id === 'house')!;
        if (first.wonAtCall === null || first.wonAtCall === pub.calls.length) {
          throw new IllegalMove('2nd Full House opens after the first Full House is settled');
        }
        if (first.winners.some((w) => w.seat === seat && w.card === cardIdx)) {
          throw new IllegalMove('That card already won Full House');
        }
      }

      const called = new Set(pub.calls);
      const marked = new Set(mine.marks[cardIdx]);
      const valid = def.check(card, (n) => n === FREE || (marked.has(n) && called.has(n)));
      if (valid) {
        if (prize.wonAtCall === null) prize.wonAtCall = pub.calls.length;
        const sharing = prize.winners.length > 0;
        prize.winners.push({ seat, card: cardIdx });
        log(pub, 'win', `${sharing ? 'shares' : 'wins'} ${prize.name}!`, seat);
      } else {
        const wrong = [...marked].filter((n) => !called.has(n)).sort((a, b) => a - b);
        const looksDone = def.check(card, (n) => n === FREE || marked.has(n));
        const why = looksDone && wrong.length > 0
          ? `${wrong.join(', ')} ${wrong.length === 1 ? "wasn't" : "weren't"} called`
          : 'pattern not complete';
        pub.penalties[seat] = (pub.penalties[seat] ?? 0) + pub.config.penalty;
        pub.bogeys[seat] = (pub.bogeys[seat] ?? 0) + 1;
        log(pub, 'bogey', `bogey on ${prize.name} (${why}) — −${pub.config.penalty}`, seat);
      }
      recomputeScores(pub);
    },

    PAUSE({ state, seat }) {
      const pub = (state as State).public;
      requireHost(pub, seat);
      requirePlaying(pub);
      if (pub.config.callMode !== 'auto') throw new IllegalMove('Only auto calling can be paused');
      pub.autoPaused = true;
      pub.nextCallAt = null;
      log(pub, 'info', 'Calling paused');
    },

    RESUME({ state, seat }) {
      const pub = (state as State).public;
      requireHost(pub, seat);
      requirePlaying(pub);
      if (!pub.autoPaused) return;
      pub.autoPaused = false;
      pub.nextCallAt = now() + pub.config.intervalSec * 1000;
      log(pub, 'info', 'Calling resumed');
    },

    SET_INTERVAL({ state, seat, payload }) {
      const pub = (state as State).public;
      requireHost(pub, seat);
      const sec = Number((payload as { sec: number }).sec);
      if (!Number.isInteger(sec) || sec < 2 || sec > 60) throw new IllegalMove('Interval must be 2–60s');
      pub.config.intervalSec = sec;
      if (pub.phase === 'playing' && !pub.autoPaused && pub.config.callMode === 'auto') {
        pub.nextCallAt = Math.max(pub.lastCallAt + sec * 1000, now() + 1000);
      }
    },

    END({ state, seat }) {
      const pub = (state as State).public;
      requireHost(pub, seat);
      if (pub.phase === 'over') throw new IllegalMove('Game over');
      finish(pub, 'The host ended the game');
    },
  },

  endIf(state) {
    const pub = state.public;
    if (pub.phase === 'over' && pub.winners) return { winners: pub.winners };
    return null;
  },

  view(state, viewer) {
    const s = state as State;
    const pub = s.public;
    const msUntilNext =
      pub.phase === 'playing' && pub.nextCallAt !== null ? Math.max(0, pub.nextCallAt - now()) : null;
    const yourCards = viewer === 'SPECTATOR' || !pub.order.includes(viewer) ? null : cardsOf(s, viewer);
    return { ...pub, msUntilNext, yourCards } satisfies BingoView;
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const pub = (state as State).public;
    if (pub.phase === 'playing' && turnBased(pub.config.callMode) && pub.caller === seat) {
      pub.caller = nextInOrder(pub, seat);
      pub.lastCallAt = now();
    }
  },

  onPlayerRemoved(state, seat) {
    const pub = (state as State).public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    const nextCaller = pub.caller === seat ? nextInOrder(pub, seat) : pub.caller;
    pub.order.splice(idx, 1);
    delete pub.scores[seat];
    if (pub.host === seat && pub.order.length > 0) pub.host = pub.order[0]!;
    if (pub.order.length === 0) {
      finish(pub, 'Everyone left');
      return;
    }
    pub.caller = nextCaller === seat ? null : nextCaller;
    if (pub.phase === 'playing' && turnBased(pub.config.callMode) && pub.caller === null) {
      pub.caller = pub.order[0]!;
    }
    recomputeScores(pub);
  },
};
