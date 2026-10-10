import type { GameModule, GameOptions, GameState, Seat, EmitBeat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { CLASSIC, layoutFor, type SnlLayout } from './boards.js';

/**
 * Snakes & Ladders — 100 squares, roll and move, snakes slide you down,
 * ladders climb you up, exact roll to finish (overshoot = stay put),
 * rolling a 6 grants another roll. Zero decisions: the only move is ROLL.
 *
 * The board arrangement itself is a lobby option (classic, snake-heavy,
 * ladder-heavy, swingy, or freshly generated) and travels in public state, so
 * the TV always draws the layout this match is actually playing on.
 *
 * In manual mode the roll only *tells you* where you are going: you then walk
 * your own counter square by square and take the snake or ladder yourself,
 * which is the whole of the physical game and was previously collapsed into a
 * single invisible state change.
 */

/** Classic layout, re-exported for anything that wants the canonical board. */
export const SNAKES: Record<number, number> = CLASSIC.snakes;
export const LADDERS: Record<number, number> = CLASSIC.ladders;

export interface SnlRules {
  /** 'stay' overshoot wastes the roll · 'bounce' walks back from 100 · 'any' just wins */
  overshoot: 'stay' | 'bounce' | 'any';
  sixRollsAgain: boolean;
  /** must roll a 6 to leave the start */
  rollToStart: boolean;
  /** landing exactly on an occupied square sends the other player back to start */
  bumpToStart: boolean;
}

export const SNL_STANDARD_RULES: SnlRules = {
  overshoot: 'stay',
  sixRollsAgain: true,
  rollToStart: false,
  bumpToStart: false,
};

export interface SnlPublic {
  /** seat → square (0 = not on board yet / start) */
  positions: Record<Seat, number>;
  /** turn order (seat list) and pointer into it */
  order: Seat[];
  turnIndex: number;
  /** the board this match is played on (may be randomly generated) */
  layout: SnlLayout;
  rules: SnlRules;
  lastRoll: {
    seat: Seat;
    die: number;
    from: number;
    to: number;
    slide: number | null;
    /** seat knocked back to the start by this landing, if any */
    bumped: Seat | null;
  } | null;
  /** 'ROLL' → throw; 'WALK' → step your counter; 'SLIDE' → take the snake/ladder. */
  phase: 'ROLL' | 'WALK' | 'SLIDE';
  pending: SnlPending | null;
  manual: boolean;
  winner: Seat | null;
}

/** What the roll committed to, while the player walks it out by hand. */
export interface SnlPending {
  die: number;
  from: number;
  /** Square the walk ends on, before any snake or ladder. */
  to: number;
  /** Where the snake/ladder at `to` leads, or null if there is none. */
  slide: number | null;
}

export type SnlPrivate = Record<string, never>;
export type SnlMove = { kind: 'ROLL' } | { kind: 'STEP' } | { kind: 'TAKE_SLIDE' };

type State = GameState<SnlPublic, SnlPrivate>;

function currentSeat(pub: SnlPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function rulesOf(pub: SnlPublic): SnlRules {
  return pub.rules ?? SNL_STANDARD_RULES;
}

function layoutOf(pub: SnlPublic): SnlLayout {
  return pub.layout ?? CLASSIC;
}

function snlRules(options: GameOptions): SnlRules {
  const overshoot = String(options.overshoot ?? 'stay');
  return {
    overshoot: overshoot === 'bounce' || overshoot === 'any' ? overshoot : 'stay',
    sixRollsAgain: (options.sixRollsAgain ?? true) === true,
    rollToStart: options.rollToStart === true,
    bumpToStart: options.bumpToStart === true,
  };
}

function advanceTurn(pub: SnlPublic): void {
  pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
}

/** House rule: whoever was already standing there gets sent home. */
function applyBump(pub: SnlPublic, seat: Seat, finalPos: number, emit?: EmitBeat): Seat | null {
  if (!rulesOf(pub).bumpToStart || finalPos <= 0 || finalPos >= 100) return null;
  let bumped: Seat | null = null;
  for (const other of pub.order) {
    if (other !== seat && pub.positions[other] === finalPos) {
      pub.positions[other] = 0;
      bumped = other;
      emit?.({
        kind: 'capture',
        seat,
        text: 'knocks a counter back to the start!',
        data: { victim: other, at: finalPos },
        holdMs: 1600,
      });
    }
  }
  return bumped;
}

/** Land the counter and hand the turn on (a 6 may keep it). */
function finishTurn(pub: SnlPublic, seat: Seat, final: number, emit: EmitBeat): void {
  pub.positions[seat] = final;
  const bumped = applyBump(pub, seat, final, emit);
  if (pub.lastRoll && bumped !== null) pub.lastRoll.bumped = bumped;
  pub.phase = 'ROLL';
  const die = pub.pending?.die ?? 0;
  pub.pending = null;

  if (final === 100) {
    pub.winner = seat;
    emit({ kind: 'reveal', seat, text: 'reaches 100 and wins!', holdMs: 2200 });
    return;
  }
  if (rulesOf(pub).sixRollsAgain && die === 6) {
    emit({ kind: 'turn', seat, text: 'rolled a 6 — throws again', holdMs: 900 });
    return;
  }
  advanceTurn(pub);
  emit({ kind: 'turn', seat: currentSeat(pub), text: 'to throw', holdMs: 600 });
}

/** Narrate a snake or ladder, and say which it was. */
function emitSlide(emit: EmitBeat, seat: Seat, to: number, slide: number): void {
  const down = slide < to;
  emit({
    kind: down ? 'jail' : 'build',
    seat,
    text: down ? `🐍 down the snake to ${slide}` : `🪜 up the ladder to ${slide}`,
    data: { from: to, to: slide, slide: true },
    holdMs: 1500,
  });
}

export const snakesAndLadders: GameModule<SnlPublic, SnlPrivate, SnlMove> = {
  slug: 'snakes-and-ladders',
  displayName: 'Snakes & Ladders',
  description: 'Pure luck: climb the ladders, dodge the snakes, first to 100.',
  rulesVersion: '1.2.0',
  supportsManual: true,
  minPlayers: 2,
  maxPlayers: 6,
  teams: 'none',

  options: [
    {
      id: 'layout',
      kind: 'choice',
      label: 'Board',
      default: 'classic',
      choices: [
        { value: 'classic', label: 'Classic', description: 'The board everyone grew up with — 9 ladders, 10 snakes.' },
        { value: 'gauntlet', label: 'Snake pit', description: 'Thirteen snakes, six ladders. The 90s are a minefield.' },
        { value: 'express', label: 'Express', description: 'Twelve ladders, six short snakes — games end fast.' },
        { value: 'skyfall', label: 'Skyfall', description: 'Few links, but huge ones. One roll can undo everything.' },
        { value: 'random', label: 'Surprise me', description: 'A brand-new board generated for this match.' },
      ],
    },
    {
      id: 'overshoot',
      kind: 'choice',
      label: 'Finishing',
      default: 'stay',
      choices: [
        { value: 'stay', label: 'Exact roll', description: 'Overshooting 100 wastes the roll — you stay put.' },
        { value: 'bounce', label: 'Bounce back', description: 'Overshoot and you walk back down from 100.' },
        { value: 'any', label: 'Just get there', description: 'Any roll that reaches 100 or beyond wins.' },
      ],
    },
    {
      id: 'sixRollsAgain',
      kind: 'toggle',
      label: 'Six rolls again',
      description: 'Rolling a 6 earns another roll.',
      default: true,
    },
    {
      id: 'rollToStart',
      kind: 'toggle',
      label: 'Roll a 6 to start',
      description: 'Nobody leaves the start square until they roll a 6.',
      default: false,
    },
    {
      id: 'bumpToStart',
      kind: 'toggle',
      label: 'Bumping',
      description: 'Land on another player and they go all the way back to the start.',
      default: false,
    },
  ],

  setup(seats, rng, options, table) {
    const positions: Record<Seat, number> = {};
    const priv: Record<Seat, SnlPrivate> = {};
    for (const { seat } of seats) {
      positions[seat] = 0;
      priv[seat] = {};
    }
    return {
      public: {
        positions,
        order: seats.map((s) => s.seat),
        turnIndex: 0,
        layout: layoutFor(String(options.layout ?? 'classic'), rng),
        rules: snlRules(options),
        lastRoll: null,
        phase: 'ROLL',
        pending: null,
        manual: Boolean(table?.manual),
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
    ROLL({ state, seat, rng, emit, table }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ROLL') throw new IllegalMove('Finish moving your counter first');
      const rules = rulesOf(pub);
      const layout = layoutOf(pub);

      const die = rng.int(1, 6);
      const from = pub.positions[seat] ?? 0;
      emit({ kind: 'dice', seat, text: `throws a ${die}`, data: { dice: [die] }, holdMs: 1200 });

      // House rule: stuck at the start until a 6 shows up.
      if (rules.rollToStart && from === 0 && die !== 6) {
        pub.lastRoll = { seat, die, from, to: from, slide: null, bumped: null };
        emit({ kind: 'say', seat, text: 'needs a 6 to leave the start', holdMs: 1300 });
        advanceTurn(pub);
        emit({ kind: 'turn', seat: currentSeat(pub), text: 'to throw', holdMs: 600 });
        return;
      }

      let to = from + die;
      if (to > 100) {
        if (rules.overshoot === 'stay') to = from;
        else if (rules.overshoot === 'bounce') to = 200 - to; // walk back down from 100
        else to = 100;
      }

      let slide: number | null = null;
      if (layout.snakes[to] !== undefined) {
        slide = layout.snakes[to]!;
      } else if (layout.ladders[to] !== undefined) {
        slide = layout.ladders[to]!;
      }
      const finalPos = slide ?? to;
      pub.lastRoll = { seat, die, from, to, slide, bumped: null };
      pub.pending = { die, from, to, slide };

      if (to === from) {
        // Overshoot with 'stay': the counter never leaves its square.
        emit({ kind: 'say', seat, text: `needs exactly ${100 - from} — stays on ${from}`, holdMs: 1400 });
        finishTurn(pub, seat, from, emit);
        return;
      }

      if (table.manual) {
        // The roll only names the destination; the player walks it themselves.
        pub.phase = 'WALK';
        emit({ kind: 'say', seat, text: `walks ${Math.abs(to - from)} squares — tap to step`, holdMs: 700 });
        return;
      }

      emit({
        kind: 'move',
        seat,
        text: `moves ${from === 0 ? 'onto the board at' : 'to'} ${to}`,
        data: { from, to, steps: Math.abs(to - from) },
        holdMs: 200 + Math.min(8, Math.abs(to - from)) * 220,
      });
      if (slide !== null) emitSlide(emit, seat, to, slide);
      finishTurn(pub, seat, finalPos, emit);
    },

    /**
     * Manual mode: advance the counter one square. The server already knows the
     * destination, so a player can only ever walk the distance they threw —
     * this is the physical act, not a second chance to choose it.
     */
    STEP({ state, seat, emit }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'WALK' || !pub.pending) throw new IllegalMove('Throw the die first');

      // The 'bounce' house rule walks back down from 100, so a step is not
      // always forwards.
      const here = pub.positions[seat] ?? 0;
      const dir = pub.pending.to > here ? 1 : -1;
      const next = here + dir;
      pub.positions[seat] = next;
      const remaining = Math.abs(pub.pending.to - next);
      emit({
        kind: 'move',
        seat,
        text: remaining > 0 ? `${next}… (${remaining} to go)` : `lands on ${next}`,
        data: { from: here, to: next, steps: 1 },
        holdMs: remaining > 0 ? 260 : 700,
      });

      if (remaining > 0) return;

      if (pub.pending.slide !== null) {
        pub.phase = 'SLIDE';
        const down = pub.pending.slide < pub.pending.to;
        emit({
          kind: 'say',
          seat,
          text: down ? '🐍 a snake! tap its tail' : '🪜 a ladder! tap to climb',
          holdMs: 900,
        });
        return;
      }
      finishTurn(pub, seat, next, emit);
    },

    /** Manual mode: take the snake down or the ladder up, by hand. */
    TAKE_SLIDE({ state, seat, emit }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'SLIDE' || !pub.pending || pub.pending.slide === null) {
        throw new IllegalMove('There is nothing to slide down or climb');
      }
      const slide = pub.pending.slide;
      emitSlide(emit, seat, pub.pending.to, slide);
      finishTurn(pub, seat, slide, emit);
    },
  },

  legalMoves(state, seat) {
    const pub = state.public;
    if (pub.winner !== null || seat !== currentSeat(pub)) return [];
    if (pub.phase === 'WALK') return [{ kind: 'STEP' }];
    if (pub.phase === 'SLIDE') return [{ kind: 'TAKE_SLIDE' }];
    return [{ kind: 'ROLL' }];
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  // Fully public game — every viewer sees the same thing.
  view(state) {
    return state.public;
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const pub = state.public;
    if (currentSeat(pub) !== seat) return;
    // A half-walked manual turn still has to resolve, or the counter would be
    // stranded mid-throw for the rest of the game.
    if (pub.pending) {
      pub.positions[seat] = pub.pending.slide ?? pub.pending.to;
      applyBump(pub, seat, pub.positions[seat]!);
      if (pub.positions[seat] === 100) pub.winner = seat;
      pub.pending = null;
    }
    pub.phase = 'ROLL';
    if (pub.winner === null) advanceTurn(pub);
  },

  onPlayerRemoved(state, seat) {
    const pub = state.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    const wasCurrent = currentSeat(pub) === seat;
    if (wasCurrent) {
      pub.phase = 'ROLL';
      pub.pending = null;
    }
    // Keep the pointer on the same "next player" after removal.
    const pointerSeat = wasCurrent
      ? pub.order[(pub.turnIndex + 1) % pub.order.length]
      : currentSeat(pub);
    pub.order.splice(idx, 1);
    delete pub.positions[seat];
    if (pub.order.length > 0) {
      const newIdx = pub.order.indexOf(pointerSeat as Seat);
      pub.turnIndex = newIdx === -1 ? 0 : newIdx;
    }
    if (pub.order.length === 1) {
      pub.winner = pub.order[0] as Seat; // last player standing
    }
  },
};
