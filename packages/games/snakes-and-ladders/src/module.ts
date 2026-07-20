import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';

/**
 * Snakes & Ladders — 100 squares, roll and move, snakes slide you down,
 * ladders climb you up, exact roll to finish (overshoot = stay put),
 * rolling a 6 grants another roll. Zero decisions: the only move is ROLL.
 */

// square → destination (classic Milton Bradley layout)
export const SNAKES: Record<number, number> = {
  16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
};
export const LADDERS: Record<number, number> = {
  1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
};

export interface SnlPublic {
  /** seat → square (0 = not on board yet / start) */
  positions: Record<Seat, number>;
  /** turn order (seat list) and pointer into it */
  order: Seat[];
  turnIndex: number;
  lastRoll: { seat: Seat; die: number; from: number; to: number; slide: number | null } | null;
  winner: Seat | null;
}

export type SnlPrivate = Record<string, never>;
export type SnlMove = { kind: 'ROLL' };

type State = GameState<SnlPublic, SnlPrivate>;

function currentSeat(pub: SnlPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function advanceTurn(pub: SnlPublic): void {
  pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
}

export const snakesAndLadders: GameModule<SnlPublic, SnlPrivate, SnlMove> = {
  slug: 'snakes-and-ladders',
  displayName: 'Snakes & Ladders',
  description: 'Pure luck: climb the ladders, dodge the snakes, first to 100.',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 6,
  teams: 'none',

  setup(seats) {
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

      const die = rng.int(1, 6);
      const from = pub.positions[seat] ?? 0;
      let to = from + die;
      if (to > 100) to = from; // must land exactly on 100

      let slide: number | null = null;
      if (SNAKES[to] !== undefined) {
        slide = SNAKES[to]!;
      } else if (LADDERS[to] !== undefined) {
        slide = LADDERS[to]!;
      }
      const finalPos = slide ?? to;
      pub.positions[seat] = finalPos;
      pub.lastRoll = { seat, die, from, to, slide };

      if (finalPos === 100) {
        pub.winner = seat;
        return;
      }
      if (die !== 6) advanceTurn(pub); // a 6 grants another roll
    },
  },

  legalMoves(state, seat) {
    if (state.public.winner !== null) return [];
    return seat === currentSeat(state.public) ? [{ kind: 'ROLL' }] : [];
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
    if (currentSeat(state.public) === seat) advanceTurn(state.public);
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
    if (pub.order.length > 0) {
      const newIdx = pub.order.indexOf(pointerSeat as Seat);
      pub.turnIndex = newIdx === -1 ? 0 : newIdx;
    }
    if (pub.order.length === 1) {
      pub.winner = pub.order[0] as Seat; // last player standing
    }
  },
};
