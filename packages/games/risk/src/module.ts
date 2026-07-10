import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { ADJACENCY, CONTINENTS, TERRITORIES } from './map.js';

/**
 * Risk — world domination on the classic 42-territory map.
 * Turn = reinforce → attack (unbounded dice-battle sub-loop) → fortify.
 * - reinforcements: max(3, floor(territories/3)) + continent bonuses
 * - battle: attacker rolls min(3, armies-1) dice, defender min(2, armies);
 *   highest pairs compared, ties favor the defender
 * - conquering forces moving in at least the number of dice rolled
 * - fortify: one move between adjacent owned territories, optional
 * - win: own all 42 territories
 * Deliberate simplifications: no territory cards / trade-ins, no 2-player
 * neutral variant, setup auto-distributes territories and armies randomly.
 */

export interface Territory {
  owner: Seat;
  armies: number;
}

export interface RiskPublic {
  territories: Record<string, Territory>;
  phase: 'REINFORCE' | 'ATTACK' | 'FORTIFY';
  reinforcementsLeft: number;
  /** set after a conquering battle until MOVE_IN resolves */
  pendingConquest: { from: string; to: string; minMove: number } | null;
  order: Seat[];
  turnIndex: number;
  lastBattle: {
    from: string;
    to: string;
    attackerDice: number[];
    defenderDice: number[];
    attackerLosses: number;
    defenderLosses: number;
    conquered: boolean;
  } | null;
  eliminated: Seat[];
  winner: Seat | null;
}

export type RiskPrivate = Record<string, never>;

export type RiskMove =
  | { kind: 'PLACE'; territory: string; count: number }
  | { kind: 'ATTACK'; from: string; to: string; dice: number }
  | { kind: 'MOVE_IN'; count: number }
  | { kind: 'END_ATTACK' }
  | { kind: 'FORTIFY'; from: string; to: string; count: number }
  | { kind: 'END_TURN' };

type State = GameState<RiskPublic, RiskPrivate>;

const INITIAL_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };

function currentSeat(pub: RiskPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

export function reinforcementsFor(pub: RiskPublic, seat: Seat): number {
  const owned = Object.values(pub.territories).filter((t) => t.owner === seat).length;
  let n = Math.max(3, Math.floor(owned / 3));
  for (const cont of CONTINENTS) {
    if (cont.territories.every((t) => pub.territories[t]!.owner === seat)) {
      n += cont.bonus;
    }
  }
  return n;
}

function ownedBy(pub: RiskPublic, seat: Seat): string[] {
  return Object.entries(pub.territories)
    .filter(([, t]) => t.owner === seat)
    .map(([name]) => name);
}

function startTurn(pub: RiskPublic): void {
  pub.phase = 'REINFORCE';
  pub.reinforcementsLeft = reinforcementsFor(pub, currentSeat(pub));
  pub.pendingConquest = null;
}

function nextTurn(pub: RiskPublic): void {
  do {
    pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  } while (pub.eliminated.includes(currentSeat(pub)));
  startTurn(pub);
}

function checkElimination(pub: RiskPublic): void {
  for (const seat of pub.order) {
    if (pub.eliminated.includes(seat)) continue;
    if (ownedBy(pub, seat).length === 0) pub.eliminated.push(seat);
  }
  const alive = pub.order.filter((s) => !pub.eliminated.includes(s));
  if (alive.length === 1) pub.winner = alive[0] as Seat;
}

export const risk: GameModule<RiskPublic, RiskPrivate, RiskMove> = {
  slug: 'risk',
  displayName: 'Risk',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 6,
  teams: 'none',

  setup(seats, rng) {
    const order = seats.map((s) => s.seat);
    const shuffledTerritories = rng.shuffle(TERRITORIES);
    const territories: Record<string, Territory> = {};

    // deal territories round-robin, 1 army each
    shuffledTerritories.forEach((t, i) => {
      territories[t] = { owner: order[i % order.length]!, armies: 1 };
    });

    // distribute remaining initial armies randomly across own territories
    const perPlayer = INITIAL_ARMIES[order.length] ?? 20;
    for (const seat of order) {
      const mine = shuffledTerritories.filter((t) => territories[t]!.owner === seat);
      let remaining = perPlayer - mine.length;
      while (remaining > 0) {
        const t = mine[rng.int(0, mine.length - 1)]!;
        territories[t]!.armies += 1;
        remaining -= 1;
      }
    }

    const priv: Record<Seat, RiskPrivate> = {};
    for (const { seat } of seats) priv[seat] = {};

    const pub: RiskPublic = {
      territories,
      phase: 'REINFORCE',
      reinforcementsLeft: 0,
      pendingConquest: null,
      order,
      turnIndex: 0,
      lastBattle: null,
      eliminated: [],
      winner: null,
    };
    pub.reinforcementsLeft = reinforcementsFor(pub, currentSeat(pub));
    return { public: pub, private: priv };
  },

  activePlayers(state: State) {
    if (state.public.winner !== null) return [];
    return [currentSeat(state.public)];
  },

  moves: {
    PLACE({ state, seat, payload }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'REINFORCE') throw new IllegalMove('Not the reinforce phase');
      const { territory, count } = payload as { territory: string; count: number };
      const t = pub.territories[territory];
      if (!t || t.owner !== seat) throw new IllegalMove('Not your territory');
      if (!Number.isInteger(count) || count < 1 || count > pub.reinforcementsLeft) {
        throw new IllegalMove('Bad army count');
      }
      t.armies += count;
      pub.reinforcementsLeft -= count;
      if (pub.reinforcementsLeft === 0) pub.phase = 'ATTACK';
    },

    ATTACK({ state, seat, payload, rng }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ATTACK') throw new IllegalMove('Not the attack phase');
      if (pub.pendingConquest) throw new IllegalMove('Move armies into your conquest first');
      const { from, to, dice } = payload as { from: string; to: string; dice: number };
      const a = pub.territories[from];
      const d = pub.territories[to];
      if (!a || a.owner !== seat) throw new IllegalMove('Not your territory');
      if (!d || d.owner === seat) throw new IllegalMove('Target must be an enemy territory');
      if (!ADJACENCY[from]?.has(to)) throw new IllegalMove('Territories are not adjacent');
      const maxDice = Math.min(3, a.armies - 1);
      if (maxDice < 1) throw new IllegalMove('Need at least 2 armies to attack');
      if (!Number.isInteger(dice) || dice < 1 || dice > maxDice) throw new IllegalMove('Bad dice count');

      const attackerDice = Array.from({ length: dice }, () => rng.int(1, 6)).sort((x, y) => y - x);
      const defenderDice = Array.from({ length: Math.min(2, d.armies) }, () => rng.int(1, 6)).sort((x, y) => y - x);

      let attackerLosses = 0;
      let defenderLosses = 0;
      for (let i = 0; i < Math.min(attackerDice.length, defenderDice.length); i++) {
        if (attackerDice[i]! > defenderDice[i]!) defenderLosses++;
        else attackerLosses++;
      }
      a.armies -= attackerLosses;
      d.armies -= defenderLosses;

      let conquered = false;
      if (d.armies === 0) {
        conquered = true;
        d.owner = seat;
        pub.pendingConquest = { from, to, minMove: Math.min(dice, a.armies - 1) };
        checkElimination(pub);
      }
      pub.lastBattle = { from, to, attackerDice, defenderDice, attackerLosses, defenderLosses, conquered };
    },

    MOVE_IN({ state, seat, payload }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      const pc = pub.pendingConquest;
      if (!pc) throw new IllegalMove('No conquest pending');
      const { count } = payload as { count: number };
      const a = pub.territories[pc.from]!;
      const maxMove = a.armies - 1;
      if (!Number.isInteger(count) || count < pc.minMove || count > maxMove) {
        throw new IllegalMove(`Move between ${pc.minMove} and ${maxMove} armies`);
      }
      a.armies -= count;
      pub.territories[pc.to]!.armies += count;
      pub.pendingConquest = null;
    },

    END_ATTACK({ state, seat }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ATTACK') throw new IllegalMove('Not the attack phase');
      if (pub.pendingConquest) throw new IllegalMove('Move armies into your conquest first');
      pub.phase = 'FORTIFY';
    },

    FORTIFY({ state, seat, payload }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'FORTIFY') throw new IllegalMove('Not the fortify phase');
      const { from, to, count } = payload as { from: string; to: string; count: number };
      const a = pub.territories[from];
      const b = pub.territories[to];
      if (!a || !b || a.owner !== seat || b.owner !== seat) throw new IllegalMove('Both territories must be yours');
      if (!ADJACENCY[from]?.has(to)) throw new IllegalMove('Territories are not adjacent');
      if (!Number.isInteger(count) || count < 1 || count > a.armies - 1) throw new IllegalMove('Bad army count');
      a.armies -= count;
      b.armies += count;
      nextTurn(pub); // fortify is the turn's last action
    },

    END_TURN({ state, seat }) {
      const pub = state.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.pendingConquest) throw new IllegalMove('Move armies into your conquest first');
      if (pub.phase === 'REINFORCE') throw new IllegalMove('Place your reinforcements first');
      nextTurn(pub);
    },
  },

  legalMoves(state, seat) {
    const pub = state.public;
    if (pub.winner !== null || seat !== currentSeat(pub)) return [];
    const moves: RiskMove[] = [];

    if (pub.pendingConquest) {
      const a = pub.territories[pub.pendingConquest.from]!;
      for (let c = pub.pendingConquest.minMove; c <= a.armies - 1; c++) {
        moves.push({ kind: 'MOVE_IN', count: c });
      }
      return moves;
    }

    if (pub.phase === 'REINFORCE') {
      for (const t of ownedBy(pub, seat)) {
        moves.push({ kind: 'PLACE', territory: t, count: 1 });
      }
      return moves;
    }

    if (pub.phase === 'ATTACK') {
      for (const from of ownedBy(pub, seat)) {
        const a = pub.territories[from]!;
        if (a.armies < 2) continue;
        for (const to of ADJACENCY[from] ?? []) {
          if (pub.territories[to]!.owner !== seat) {
            moves.push({ kind: 'ATTACK', from, to, dice: Math.min(3, a.armies - 1) });
          }
        }
      }
      moves.push({ kind: 'END_ATTACK' });
      moves.push({ kind: 'END_TURN' });
      return moves;
    }

    // FORTIFY
    for (const from of ownedBy(pub, seat)) {
      const a = pub.territories[from]!;
      if (a.armies < 2) continue;
      for (const to of ADJACENCY[from] ?? []) {
        if (pub.territories[to]!.owner === seat) {
          moves.push({ kind: 'FORTIFY', from, to, count: 1 });
        }
      }
    }
    moves.push({ kind: 'END_TURN' });
    return moves;
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  view(state) {
    return state.public; // fully public without cards
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const pub = state.public;
    if (currentSeat(pub) !== seat) return;
    // resolve any dangling conquest with the minimum move, then pass the turn
    if (pub.pendingConquest) {
      const pc = pub.pendingConquest;
      const a = pub.territories[pc.from]!;
      const move = Math.min(pc.minMove, Math.max(0, a.armies - 1));
      a.armies -= move;
      pub.territories[pc.to]!.armies += move;
      pub.pendingConquest = null;
    }
    nextTurn(pub);
  },

  onPlayerRemoved(state, seat) {
    const pub = state.public;
    // territories become neutral-ish: keep armies but hand them to no one —
    // simplest sound model is to mark them eliminated and give their
    // territories to nobody; but ownership must be a seat, so they keep the
    // territories as inert obstacles (they never get a turn again).
    if (!pub.eliminated.includes(seat)) pub.eliminated.push(seat);
    if (currentSeat(pub) === seat && pub.winner === null) {
      pub.pendingConquest = null;
      nextTurn(pub);
    }
    checkElimination(pub);
  },
};
