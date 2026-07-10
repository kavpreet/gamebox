import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove } from '@gamebox/core-engine';
import {
  risk,
  reinforcementsFor,
  ADJACENCY,
  TERRITORIES,
  CONTINENTS,
  type RiskPublic,
} from '@gamebox/game-risk';

function newGame(seed = 1, players = 3) {
  const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
  return GameRuntime.start(risk, seats, seed);
}

describe('risk map', () => {
  it('has 42 territories in 6 continents with symmetric adjacency', () => {
    expect(TERRITORIES).toHaveLength(42);
    expect(CONTINENTS.flatMap((c) => c.territories)).toHaveLength(42);
    for (const [t, neighbors] of Object.entries(ADJACENCY)) {
      for (const n of neighbors) {
        expect(ADJACENCY[n]!.has(t)).toBe(true);
      }
    }
    // spot checks of famous connections
    expect(ADJACENCY['alaska']!.has('kamchatka')).toBe(true);
    expect(ADJACENCY['brazil']!.has('north-africa')).toBe(true);
  });
});

describe('risk gameplay', () => {
  it('setup gives everyone the right army total and every territory an owner', () => {
    const rt = newGame(7, 3);
    const pub = rt.view('SPECTATOR') as RiskPublic;
    for (let seat = 0; seat < 3; seat++) {
      const armies = Object.values(pub.territories)
        .filter((t) => t.owner === seat)
        .reduce((sum, t) => sum + t.armies, 0);
      expect(armies).toBe(35); // 3 players → 35 armies
    }
    expect(Object.keys(pub.territories)).toHaveLength(42);
  });

  it('computes reinforcements with continent bonuses', () => {
    const rt = newGame(1, 2);
    const state = (rt as any).state as { public: RiskPublic };
    const pub = state.public;
    // give seat 0 all of South America (bonus 2) and exactly 9 territories
    for (const t of TERRITORIES) pub.territories[t]!.owner = 1;
    const sa = CONTINENTS.find((c) => c.name === 'South America')!.territories;
    for (const t of sa) pub.territories[t]!.owner = 0;
    for (const t of ['iceland', 'japan', 'egypt', 'ural', 'siam']) pub.territories[t]!.owner = 0;
    expect(reinforcementsFor(pub, 0)).toBe(3 + 2); // floor(9/3)=3 + SA bonus
  });

  it('conquest transfers ownership and requires the move-in', () => {
    const rt = newGame(1, 2);
    const state = (rt as any).state as { public: RiskPublic };
    const pub = state.public;
    pub.phase = 'ATTACK';
    pub.reinforcementsLeft = 0;
    const seat = pub.order[pub.turnIndex]!;
    // engineer a sure-win battle: 10 armies vs 1
    const from = 'brazil';
    const to = 'north-africa';
    pub.territories[from] = { owner: seat, armies: 10 };
    pub.territories[to] = { owner: seat === 0 ? 1 : 0, armies: 1 };

    // attack until conquered (dice luck varies)
    let guard = 0;
    while (pub.territories[to]!.owner !== seat && guard++ < 50) {
      rt.applyMove(seat, 'ATTACK', { from, to, dice: Math.min(3, pub.territories[from]!.armies - 1) });
    }
    expect(pub.territories[to]!.owner).toBe(seat);
    expect(pub.pendingConquest).not.toBeNull();
    // cannot attack again before moving in
    expect(() => rt.applyMove(seat, 'ATTACK', { from, to: 'venezuela', dice: 1 })).toThrow(IllegalMove);
    const minMove = pub.pendingConquest!.minMove;
    rt.applyMove(seat, 'MOVE_IN', { count: minMove });
    expect(pub.pendingConquest).toBeNull();
    expect(pub.territories[to]!.armies).toBe(minMove);
  });

  it('phases progress reinforce → attack → fortify → next player', () => {
    const rt = newGame(2, 2);
    const state = (rt as any).state as { public: RiskPublic };
    const pub = state.public;
    const seat = pub.order[pub.turnIndex]!;
    expect(pub.phase).toBe('REINFORCE');
    // place all reinforcements on one owned territory
    const mine = Object.entries(pub.territories).find(([, t]) => t.owner === seat)![0];
    rt.applyMove(seat, 'PLACE', { territory: mine, count: pub.reinforcementsLeft });
    expect(pub.phase).toBe('ATTACK');
    rt.applyMove(seat, 'END_ATTACK', {});
    expect(pub.phase).toBe('FORTIFY');
    rt.applyMove(seat, 'END_TURN', {});
    expect(pub.order[pub.turnIndex]).not.toBe(seat);
    expect(pub.phase).toBe('REINFORCE');
  });

  it('last player standing wins', () => {
    const rt = newGame(3, 2);
    const state = (rt as any).state as { public: RiskPublic };
    const pub = state.public;
    // hand every territory to seat 0 except one weak one, then conquer it
    for (const t of TERRITORIES) pub.territories[t] = { owner: 0, armies: 3 };
    pub.territories['japan'] = { owner: 1, armies: 1 };
    pub.turnIndex = pub.order.indexOf(0);
    pub.phase = 'ATTACK';
    pub.reinforcementsLeft = 0;
    let guard = 0;
    while (pub.territories['japan']!.owner !== 0 && guard++ < 100) {
      pub.territories['mongolia'] = { owner: 0, armies: 10 }; // keep attacker strong
      rt.applyMove(0, 'ATTACK', { from: 'mongolia', to: 'japan', dice: 3 });
    }
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([0]);
  });
});
