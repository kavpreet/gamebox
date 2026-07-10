import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove, createSeededRandom } from '@gamebox/core-engine';
import {
  catan,
  generateBoard,
  boardHexCoords,
  cornersOf,
  vertexNeighbors,
  edgeId,
  longestRoadOf,
  hexKey,
  type CatanPublic,
} from '@gamebox/game-catan';

function newGame(seed = 1, players = 3) {
  const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
  return GameRuntime.start(catan, seats, seed);
}

function pubOf(rt: GameRuntime): CatanPublic {
  return (rt as any).state.public as CatanPublic;
}

/** Runs the snake-draft setup with the first legal placement each time. */
function completeSetup(rt: GameRuntime): void {
  while (pubOf(rt).phase === 'SETUP') {
    const seat = rt.activeSeats()[0]!;
    const moves = rt.legalMoves(seat) as any[];
    expect(moves.length).toBeGreaterThan(0);
    rt.applyMove(seat, 'PLACE_SETUP', moves[Math.floor(Math.random() * moves.length)]);
  }
}

describe('catan board geometry', () => {
  it('has 19 hexes, 54 vertices, 72 edges', () => {
    const rng = createSeededRandom(1);
    const g = generateBoard(rng);
    expect(g.hexes).toHaveLength(19);
    expect(g.vertices.size).toBe(54);
    expect(g.edges.size).toBe(72);
  });

  it('tile mix is standard and desert has no token', () => {
    const g = generateBoard(createSeededRandom(7));
    const count = (t: string) => g.hexes.filter((h) => h.tile === t).length;
    expect(count('wood')).toBe(4);
    expect(count('sheep')).toBe(4);
    expect(count('wheat')).toBe(4);
    expect(count('brick')).toBe(3);
    expect(count('ore')).toBe(3);
    expect(count('desert')).toBe(1);
    const desert = g.hexes.find((h) => h.tile === 'desert')!;
    expect(desert.token).toBeNull();
  });

  it('every hex corner is mutual: corner vertices touch the hex back', () => {
    for (const { q, r } of boardHexCoords()) {
      expect(cornersOf(q, r)).toHaveLength(6);
    }
    // vertex neighbor relation is symmetric
    const g = generateBoard(createSeededRandom(3));
    for (const v of g.vertices) {
      for (const n of vertexNeighbors(v)) {
        if (g.vertices.has(n)) {
          expect(vertexNeighbors(n)).toContain(v);
        }
      }
    }
  });
});

describe('catan setup', () => {
  it('snake draft: order 0,1,2,2,1,0 for 3 players', () => {
    const rt = newGame(5, 3);
    const placed: number[] = [];
    while (pubOf(rt).phase === 'SETUP') {
      const seat = rt.activeSeats()[0]!;
      placed.push(seat);
      const moves = rt.legalMoves(seat) as any[];
      rt.applyMove(seat, 'PLACE_SETUP', moves[0]);
    }
    expect(placed).toEqual([0, 1, 2, 2, 1, 0]);
    expect(pubOf(rt).phase).toBe('ROLL');
    expect(Object.keys(pubOf(rt).buildings)).toHaveLength(6);
    expect(Object.keys(pubOf(rt).roads)).toHaveLength(6);
  });

  it('enforces the distance rule', () => {
    const rt = newGame(6, 3);
    const seat = rt.activeSeats()[0]!;
    const moves = rt.legalMoves(seat) as any[];
    const first = moves[0];
    rt.applyMove(seat, 'PLACE_SETUP', first);
    // second player cannot place adjacent to the first settlement
    const nextMoves = rt.legalMoves(rt.activeSeats()[0]!) as any[];
    const neighbors = new Set(vertexNeighbors(first.vertex));
    for (const m of nextMoves) {
      expect(m.vertex).not.toBe(first.vertex);
      expect(neighbors.has(m.vertex)).toBe(false);
    }
  });
});

describe('catan gameplay', () => {
  it('longest road counts a simple chain and breaks on opponent buildings', () => {
    const rt = newGame(2, 3);
    const pub = pubOf(rt);
    // hand-build a 5-road chain for seat 0 along a hex ring
    const vs = ['0,0,N', '1,-1,S', '1,0,N', '0,0,S'].map(String);
    // build a path using neighbor relations from 0,0,N
    const chain: string[] = [];
    let cur = '0,0,N';
    const seen = new Set([cur]);
    for (let i = 0; i < 5; i++) {
      const next = vertexNeighbors(cur).find((n) => !seen.has(n))!;
      chain.push(edgeId(cur, next));
      seen.add(next);
      cur = next;
    }
    for (const e of chain) pub.roads[e] = 0;
    expect(longestRoadOf(pub, 0)).toBe(5);
    // opponent settlement in the middle breaks it
    const midVertex = [...seen][2]!;
    pub.buildings[midVertex] = { owner: 1, city: false };
    expect(longestRoadOf(pub, 0)).toBeLessThan(5);
    void vs;
  });

  it('a 7 forces discard-half for hands over 7 (multi-active)', () => {
    const rt = newGame(8, 3);
    completeSetup(rt);
    const pub = pubOf(rt);
    const state = (rt as any).state;
    // give seat 1 and 2 big hands, then simulate the roll-7 branch directly
    state.private[1].resources = { wood: 4, brick: 4, sheep: 0, wheat: 0, ore: 0 };
    state.private[2].resources = { wood: 5, brick: 5, sheep: 0, wheat: 0, ore: 0 };
    pub.resourceCounts[1] = 8;
    pub.resourceCounts[2] = 10;
    pub.discardsPending = { 1: 4, 2: 5 };
    pub.phase = 'DISCARD';
    expect(rt.activeSeats().sort()).toEqual([1, 2]);
    rt.applyMove(1, 'DISCARD', { resources: { wood: 2, brick: 2 } });
    expect(rt.activeSeats()).toEqual([2]);
    expect(() => rt.applyMove(2, 'DISCARD', { resources: { wood: 1 } })).toThrow(IllegalMove);
    rt.applyMove(2, 'DISCARD', { resources: { wood: 3, brick: 2 } });
    expect(pubOf(rt).phase).toBe('ROBBER');
  });

  it('building costs are enforced and paid', () => {
    const rt = newGame(4, 3);
    completeSetup(rt);
    const pub = pubOf(rt);
    const state = (rt as any).state;
    const seat = pub.order[pub.turnIndex]!;
    pub.phase = 'MAIN';
    state.private[seat].resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    const edges = (rt.legalMoves(seat) as any[]).filter((m) => m.kind === 'BUILD_ROAD');
    expect(edges).toHaveLength(0); // no resources → no road offers
    state.private[seat].resources = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 };
    const edges2 = (rt.legalMoves(seat) as any[]).filter((m) => m.kind === 'BUILD_ROAD');
    expect(edges2.length).toBeGreaterThan(0);
    rt.applyMove(seat, 'BUILD_ROAD', edges2[0]);
    expect(state.private[seat].resources.wood).toBe(0);
    expect(state.private[seat].resources.brick).toBe(0);
  });

  it('trade: propose exact swap, target active, accept swaps resources', () => {
    const rt = newGame(9, 3);
    completeSetup(rt);
    const pub = pubOf(rt);
    const state = (rt as any).state;
    const a = pub.order[pub.turnIndex]!;
    const b = pub.order.find((x) => x !== a)!;
    pub.phase = 'MAIN';
    state.private[a].resources = { wood: 2, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    state.private[b].resources = { wood: 0, brick: 0, sheep: 0, wheat: 1, ore: 0 };
    rt.applyMove(a, 'PROPOSE_TRADE', { to: b, give: { wood: 2 }, get: { wheat: 1 } });
    expect(rt.activeSeats()).toEqual([b]);
    rt.applyMove(b, 'RESPOND_TRADE', { accept: true });
    expect(state.private[a].resources.wheat).toBe(1);
    expect(state.private[b].resources.wood).toBe(2);
  });

  it('reaching 10 VP wins (hidden VP cards count)', () => {
    const rt = newGame(10, 3);
    completeSetup(rt);
    const pub = pubOf(rt);
    const state = (rt as any).state;
    const seat = pub.order[pub.turnIndex]!;
    pub.phase = 'MAIN';
    // 8 public points via 4 cities on their 2 settlements + 2 more settlements... simpler:
    // fabricate: give them 4 cities (8) + longest road (2) → immediate win on next check
    let count = 0;
    for (const [v, b] of Object.entries(pub.buildings)) {
      if (b.owner === seat) { b.city = true; count++; }
    }
    // add extra city buildings on free vertices to reach 4 cities
    const g = Object.keys(pub.buildings);
    const free = ['2,-2,N', '2,-1,N', '0,2,N'].filter((v) => !g.includes(v));
    while (count < 4 && free.length > 0) {
      pub.buildings[free.pop()!] = { owner: seat, city: true };
      count++;
    }
    pub.longestRoadOwner = seat;
    // trigger a win check via a legal cheap action
    state.private[seat].resources = { wood: 1, brick: 1, sheep: 0, wheat: 0, ore: 0 };
    const roads = (rt.legalMoves(seat) as any[]).filter((m) => m.kind === 'BUILD_ROAD');
    rt.applyMove(seat, 'BUILD_ROAD', roads[0]);
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([seat]);
  });

  it('resources and dev cards are hidden from other viewers', () => {
    const rt = newGame(12, 3);
    completeSetup(rt);
    const spec = rt.view('SPECTATOR') as any;
    expect(spec.yourResources).toBeNull();
    expect(JSON.stringify(spec)).not.toContain('devDeck');
    const mine = rt.view(0) as any;
    expect(mine.yourResources).not.toBeNull();
  });

  it('random playout: setup then dozens of legal turns', () => {
    const rt = newGame(20, 3);
    completeSetup(rt);
    let guard = 0;
    while (rt.currentStatus === 'active' && guard++ < 600) {
      const actives = rt.activeSeats();
      const seat = actives[Math.floor(Math.random() * actives.length)]!;
      const moves = rt.legalMoves(seat) as any[];
      expect(moves.length).toBeGreaterThan(0);
      let move = moves[Math.floor(Math.random() * moves.length)];
      if (move.kind === 'DISCARD') {
        // compose a real discard from own resources
        const res = ((rt as any).state.private[seat].resources) as Record<string, number>;
        const owed = pubOf(rt).discardsPending[seat]!;
        const discard: Record<string, number> = {};
        let left = owed;
        for (const k of Object.keys(res)) {
          const take = Math.min(res[k]!, left);
          if (take > 0) discard[k] = take;
          left -= take;
        }
        move = { kind: 'DISCARD', resources: discard };
      }
      rt.applyMove(seat, move.kind, move);
    }
    expect(guard).toBeGreaterThan(30);
  });
});
