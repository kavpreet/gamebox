import type { GameModule, GameState, Seat, EmitBeat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';

/**
 * Snakes & Ladders — 100 squares, roll and move, snakes slide you down,
 * ladders climb you up, exact roll to finish (overshoot = stay put),
 * rolling a 6 grants another roll.
 *
 * In automatic mode the only decision is still ROLL. In manual mode the roll
 * only *tells you* where you are going: you then walk your own counter square
 * by square and take the snake or ladder yourself, which is the whole of the
 * physical game and was previously collapsed into one invisible state change.
 */

// square → destination (classic Milton Bradley layout)
export const SNAKES: Record<number, number> = {
  16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
};
export const LADDERS: Record<number, number> = {
  1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
};

/** What the roll committed to, while the player walks it out by hand. */
export interface SnlPending {
  die: number;
  from: number;
  /** Square the walk ends on, before any snake or ladder. */
  to: number;
  /** Where the snake/ladder at `to` leads, or null if there is none. */
  slide: number | null;
}

export interface SnlPublic {
  /** seat → square (0 = not on board yet / start) */
  positions: Record<Seat, number>;
  /** turn order (seat list) and pointer into it */
  order: Seat[];
  turnIndex: number;
  lastRoll: { seat: Seat; die: number; from: number; to: number; slide: number | null } | null;
  winner: Seat | null;
  /** 'ROLL' → throw; 'WALK' → step your counter; 'SLIDE' → take the snake/ladder. */
  phase: 'ROLL' | 'WALK' | 'SLIDE';
  pending: SnlPending | null;
  manual: boolean;
}

export type SnlPrivate = Record<string, never>;
export type SnlMove = { kind: 'ROLL' } | { kind: 'STEP' } | { kind: 'TAKE_SLIDE' };

type State = GameState<SnlPublic, SnlPrivate>;

function currentSeat(pub: SnlPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function advanceTurn(pub: SnlPublic): void {
  pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
}

function slideAt(square: number): number | null {
  if (SNAKES[square] !== undefined) return SNAKES[square]!;
  if (LADDERS[square] !== undefined) return LADDERS[square]!;
  return null;
}

/** Land the counter and hand the turn on (a 6 keeps it). */
function finishTurn(pub: SnlPublic, seat: Seat, final: number, emit: EmitBeat): void {
  pub.positions[seat] = final;
  pub.phase = 'ROLL';
  const die = pub.pending?.die ?? 0;
  pub.pending = null;

  if (final === 100) {
    pub.winner = seat;
    emit({ kind: 'reveal', seat, text: 'reaches 100 and wins!', holdMs: 2200 });
    return;
  }
  if (die === 6) {
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
  rulesVersion: '1.1.0',
  minPlayers: 2,
  maxPlayers: 6,
  teams: 'none',
  supportsManual: true,

  setup(seats, _rng, options) {
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
        lastRoll: null,
        winner: null,
        phase: 'ROLL',
        pending: null,
        manual: Boolean(options?.manual),
      },
      private: priv,
    };
  },

  activePlayers(state: State) {
    if (state.public.winner !== null) return [];
    return [currentSeat(state.public)];
  },

  moves: {
    ROLL({ state, seat, rng, emit, options }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ROLL') throw new IllegalMove('Finish moving your counter first');

      const die = rng.int(1, 6);
      const from = pub.positions[seat] ?? 0;
      let to = from + die;
      if (to > 100) to = from; // must land exactly on 100

      const slide = slideAt(to);
      pub.lastRoll = { seat, die, from, to, slide };
      emit({ kind: 'dice', seat, text: `throws a ${die}`, data: { dice: [die] }, holdMs: 1200 });

      if (to === from) {
        // Overshoot: the counter never leaves its square.
        emit({ kind: 'say', seat, text: `needs exactly ${100 - from} — stays on ${from}`, holdMs: 1400 });
        finishTurn(pub, seat, from, emit);
        return;
      }

      if (options.manual) {
        // The roll only names the destination; the player walks it themselves.
        pub.phase = 'WALK';
        pub.pending = { die, from, to, slide };
        emit({ kind: 'say', seat, text: `walks ${die} squares — tap to step`, holdMs: 700 });
        return;
      }

      pub.pending = { die, from, to, slide };
      emit({
        kind: 'move',
        seat,
        text: `moves ${from === 0 ? 'onto the board at' : 'to'} ${to}`,
        data: { from, to, steps: die },
        holdMs: 200 + die * 220,
      });
      if (slide !== null) emitSlide(emit, seat, to, slide);
      finishTurn(pub, seat, slide ?? to, emit);
    },

    /**
     * Manual mode: advance the counter one square. The server already knows
     * the destination, so a player can only ever walk the distance they threw
     * — this is the physical act, not a second chance to choose it.
     */
    STEP({ state, seat, emit }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'WALK' || !pub.pending) throw new IllegalMove('Throw the die first');

      const next = (pub.positions[seat] ?? 0) + 1;
      pub.positions[seat] = next;
      const remaining = pub.pending.to - next;
      emit({
        kind: 'move',
        seat,
        text: remaining > 0 ? `${next}… (${remaining} to go)` : `lands on ${next}`,
        data: { from: next - 1, to: next, steps: 1 },
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
      if (pub.phase !== 'SLIDE' || pub.pending?.slide === null || !pub.pending) {
        throw new IllegalMove('There is nothing to slide down or climb');
      }
      const slide = pub.pending.slide!;
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
    // A half-walked turn still has to resolve, or the counter would be left
    // stranded mid-throw for the rest of the game.
    if (pub.pending) {
      pub.positions[seat] = pub.pending.slide ?? pub.pending.to;
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
    // Keep the pointer on the same "next player" after removal.
    const pointerSeat = wasCurrent
      ? pub.order[(pub.turnIndex + 1) % pub.order.length]
      : currentSeat(pub);
    pub.order.splice(idx, 1);
    delete pub.positions[seat];
    if (wasCurrent) {
      pub.phase = 'ROLL';
      pub.pending = null;
    }
    if (pub.order.length > 0) {
      const newIdx = pub.order.indexOf(pointerSeat as Seat);
      pub.turnIndex = newIdx === -1 ? 0 : newIdx;
    }
    if (pub.order.length === 1) {
      pub.winner = pub.order[0] as Seat; // last player standing
    }
  },
};
