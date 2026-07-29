import type { GameModule, GameOptions, GameState, Seat } from '@gamebox/core-engine';
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
  winner: Seat | null;
}

export type SnlPrivate = Record<string, never>;
export type SnlMove = { kind: 'ROLL' };

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

export const snakesAndLadders: GameModule<SnlPublic, SnlPrivate, SnlMove> = {
  slug: 'snakes-and-ladders',
  displayName: 'Snakes & Ladders',
  description: 'Pure luck: climb the ladders, dodge the snakes, first to 100.',
  rulesVersion: '1.1.0',
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

  setup(seats, rng, options) {
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
      const rules = rulesOf(pub);
      const layout = layoutOf(pub);

      const die = rng.int(1, 6);
      const from = pub.positions[seat] ?? 0;

      // House rule: stuck at the start until a 6 shows up.
      if (rules.rollToStart && from === 0 && die !== 6) {
        pub.lastRoll = { seat, die, from, to: from, slide: null, bumped: null };
        advanceTurn(pub);
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

      // House rule: whoever was already standing there gets sent home.
      let bumped: Seat | null = null;
      if (rules.bumpToStart && finalPos > 0 && finalPos < 100) {
        for (const other of pub.order) {
          if (other !== seat && pub.positions[other] === finalPos) {
            pub.positions[other] = 0;
            bumped = other;
          }
        }
      }

      pub.positions[seat] = finalPos;
      pub.lastRoll = { seat, die, from, to, slide, bumped };

      if (finalPos === 100) {
        pub.winner = seat;
        return;
      }
      if (!(rules.sixRollsAgain && die === 6)) advanceTurn(pub);
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
