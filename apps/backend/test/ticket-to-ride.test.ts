import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import {
  ticketToRide,
  CITY_POS, ROUTES, TICKETS, ROUTE_POINTS, TRAINS_PER_PLAYER,
  canAfford, payableColors, longestPathLength, ticketCompleted,
  type TtrPublic, type Card,
} from '@gamebox/game-ticket-to-ride';

function newGame(seed = 1, players = 3) {
  const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
  return GameRuntime.start(ticketToRide, seats, seed);
}

function pub(rt: GameRuntime): TtrPublic {
  return rt.view('SPECTATOR') as TtrPublic;
}

/** Resolve everyone's initial ticket offers (keep the first 2). */
function throughInitialTickets(rt: GameRuntime) {
  for (const seat of [...rt.activeSeats()]) {
    rt.applyMove(seat, 'CHOOSE_TICKETS', { keep: [0, 1] });
  }
}

function rawState(rt: GameRuntime) {
  return (rt as any).state as { public: TtrPublic; private: Record<number, any> };
}

describe('ticket to ride map', () => {
  it('routes and tickets only reference known cities, ids unique', () => {
    const ids = new Set<string>();
    for (const r of ROUTES) {
      expect(CITY_POS[r.a], r.id).toBeDefined();
      expect(CITY_POS[r.b], r.id).toBeDefined();
      expect(r.length).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeLessThanOrEqual(6);
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
    }
    for (const t of TICKETS) {
      expect(CITY_POS[t.a], `${t.a}→${t.b}`).toBeDefined();
      expect(CITY_POS[t.b], `${t.a}→${t.b}`).toBeDefined();
    }
  });

  it('the route graph is fully connected', () => {
    const adj = new Map<string, string[]>();
    for (const r of ROUTES) {
      (adj.get(r.a) ?? adj.set(r.a, []).get(r.a)!).push(r.b);
      (adj.get(r.b) ?? adj.set(r.b, []).get(r.b)!).push(r.a);
    }
    const seen = new Set(['seattle']);
    const q = ['seattle'];
    while (q.length) {
      for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    expect(seen.size).toBe(Object.keys(CITY_POS).length);
  });
});

describe('ticket to ride gameplay', () => {
  it('setup deals 4 cards, offers 3 tickets, shows a 5-card market', () => {
    const rt = newGame(7, 3);
    const view = pub(rt);
    expect(view.phase).toBe('INITIAL_TICKETS');
    expect(view.faceUp).toHaveLength(5);
    expect(rt.activeSeats()).toEqual([0, 1, 2]);
    for (let s = 0; s < 3; s++) {
      expect(view.handCounts[s]).toBe(4);
      expect(view.trainsLeft[s]).toBe(TRAINS_PER_PLAYER);
      const mine = rt.view(s) as any;
      expect(mine.offer).toHaveLength(3);
      expect(mine.hand).toHaveLength(4);
    }
    // hidden info never leaks to spectators
    expect((view as any).hand).toBeUndefined();
    expect((view as any).offer).toBeUndefined();
  });

  it('initial tickets require keeping 2, then play starts', () => {
    const rt = newGame(3, 2);
    expect(() => rt.applyMove(0, 'CHOOSE_TICKETS', { keep: [0] })).toThrow();
    rt.applyMove(0, 'CHOOSE_TICKETS', { keep: [0, 1] });
    rt.applyMove(1, 'CHOOSE_TICKETS', { keep: [0, 1, 2] });
    const view = pub(rt);
    expect(view.phase).toBe('PLAY');
    expect(view.ticketCounts[0]).toBe(2);
    expect(view.ticketCounts[1]).toBe(3);
    expect(rt.activeSeats()).toEqual([view.order[view.turnIndex]]);
  });

  it('drawing two train cards ends the turn; blind draw grows the hand', () => {
    const rt = newGame(5, 2);
    throughInitialTickets(rt);
    const seat = rt.activeSeats()[0]!;
    const before = (rt.view(seat) as any).hand.length;
    rt.applyMove(seat, 'DRAW_BLIND', {});
    expect(rt.activeSeats()).toEqual([seat]); // still their turn after one draw
    rt.applyMove(seat, 'DRAW_BLIND', {});
    expect((rt.view(seat) as any).hand.length).toBe(before + 2);
    expect(rt.activeSeats()).not.toEqual([seat]);
  });

  it('a face-up locomotive costs the whole turn and cannot be the second draw', () => {
    const rt = newGame(11, 2);
    throughInitialTickets(rt);
    const state = rawState(rt);
    const seat = rt.activeSeats()[0]!;
    state.public.faceUp = ['loco', 'red', 'red', 'blue', 'green'] as Card[];
    rt.applyMove(seat, 'DRAW_FACEUP', { index: 1 });
    expect(() => rt.applyMove(seat, 'DRAW_FACEUP', { index: 0 })).toThrow(/locomotive/i);
    rt.applyMove(seat, 'DRAW_FACEUP', { index: 1 });
    // fresh turn: taking the loco ends it immediately
    const seat2 = rt.activeSeats()[0]!;
    state.public.faceUp = ['loco', 'red', 'red', 'blue', 'green'] as Card[];
    rt.applyMove(seat2, 'DRAW_FACEUP', { index: 0 });
    expect(rt.activeSeats()).not.toEqual([seat2]);
  });

  it('claiming a route spends cards, trains, and scores points', () => {
    const rt = newGame(2, 2);
    throughInitialTickets(rt);
    const state = rawState(rt);
    const seat = rt.activeSeats()[0]!;
    state.private[seat].hand = ['red', 'red', 'red', 'loco'] as Card[];
    // salt-lake-city~denver is red, length 3
    rt.applyMove(seat, 'CLAIM_ROUTE', { route: 'salt-lake-city~denver' });
    const view = pub(rt);
    expect(view.claimed['salt-lake-city~denver']).toBe(seat);
    expect(view.trainsLeft[seat]).toBe(TRAINS_PER_PLAYER - 3);
    expect(view.routeScores[seat]).toBe(ROUTE_POINTS[3]);
    expect(view.handCounts[seat]).toBe(1); // 3 reds spent, loco kept
    // opponent cannot claim it again
    const seat2 = rt.activeSeats()[0]!;
    state.private[seat2].hand = ['red', 'red', 'red'] as Card[];
    expect(() => rt.applyMove(seat2, 'CLAIM_ROUTE', { route: 'salt-lake-city~denver' })).toThrow(/claimed/i);
  });

  it('gray routes need a declared color; locomotives fill gaps', () => {
    const rt = newGame(4, 2);
    throughInitialTickets(rt);
    const state = rawState(rt);
    const seat = rt.activeSeats()[0]!;
    state.private[seat].hand = ['blue', 'loco', 'green', 'yellow'] as Card[];
    expect(canAfford(state.private[seat].hand, 'blue', 2)).toBe(true);
    expect(payableColors(state.private[seat].hand, 'gray', 2)).toContain('blue');
    expect(() => rt.applyMove(seat, 'CLAIM_ROUTE', { route: 'los-angeles~las-vegas' })).toThrow();
    rt.applyMove(seat, 'CLAIM_ROUTE', { route: 'los-angeles~las-vegas', color: 'blue' });
    expect(pub(rt).claimed['los-angeles~las-vegas']).toBe(seat);
    // blue + loco were spent
    expect(state.private[seat].hand.sort()).toEqual(['green', 'yellow']);
  });

  it('ticket completion and longest path are computed from claimed routes', () => {
    const rt = newGame(1, 2);
    const state = rawState(rt);
    const p = state.public;
    p.claimed['seattle~portland'] = 0;
    p.claimed['portland~san-francisco'] = 0;
    p.claimed['san-francisco~los-angeles'] = 0;
    expect(ticketCompleted(p, 0, { a: 'seattle', b: 'los-angeles', points: 9 })).toBe(true);
    expect(ticketCompleted(p, 1, { a: 'seattle', b: 'los-angeles', points: 9 })).toBe(false);
    expect(longestPathLength(p, 0)).toBe(1 + 5 + 3);
    expect(longestPathLength(p, 1)).toBe(0);
  });

  it('low trains trigger a final round, then scoring with ticket ± and longest-path bonus', () => {
    const rt = newGame(9, 2);
    throughInitialTickets(rt);
    const state = rawState(rt);
    const p = state.public;
    const seat = rt.activeSeats()[0]!;
    const other = p.order.find((s) => s !== seat)!;
    // seat is about to run out of trains
    p.trainsLeft[seat] = 3;
    p.claimed['seattle~portland'] = seat; // some path for the bonus
    state.private[seat].tickets = [{ a: 'seattle', b: 'portland', points: 9 }];
    state.private[other].tickets = [{ a: 'winnipeg', b: 'miami', points: 20 }];
    state.private[seat].hand = ['yellow', 'yellow', 'yellow', 'loco'] as Card[];
    // claim san-francisco~los-angeles (yellow, 3) → trains drop to 0 → final round
    rt.applyMove(seat, 'CLAIM_ROUTE', { route: 'san-francisco~los-angeles' });
    expect(p.endTriggeredBy).toBe(seat);
    expect(rt.currentStatus).toBe('active');
    // both final turns: draw blind twice each (or pass through)
    for (let turns = 0; turns < 2 && rt.currentStatus === 'active'; turns++) {
      const s = rt.activeSeats()[0]!;
      rt.applyMove(s, 'DRAW_BLIND', {});
      if (rt.currentStatus === 'active' && rt.activeSeats()[0] === s) rt.applyMove(s, 'DRAW_BLIND', {});
    }
    expect(rt.currentStatus).toBe('completed');
    const final = pub(rt).finalScores!;
    // seat: only the claimed yellow route scored (seattle~portland was injected
    // directly into state, bypassing scoring); ticket +9, longest path 10
    expect(final[seat]!.route).toBe(ROUTE_POINTS[3]!);
    expect(final[seat]!.tickets).toBe(9);
    expect(final[seat]!.longestPath).toBe(10);
    // other: incomplete 20-point ticket counts against them
    expect(final[other]!.tickets).toBe(-20);
    expect(rt.endResult!.winners).toEqual([seat]);
  });

  it('drawing tickets mid-game offers 3, keep at least 1', () => {
    const rt = newGame(13, 2);
    throughInitialTickets(rt);
    const seat = rt.activeSeats()[0]!;
    rt.applyMove(seat, 'DRAW_TICKETS', {});
    expect(rt.activeSeats()).toEqual([seat]); // still them until they choose
    expect(() => rt.applyMove(seat, 'CHOOSE_TICKETS', { keep: [] })).toThrow();
    const offer = (rt.view(seat) as any).offer;
    expect(offer.length).toBeGreaterThanOrEqual(1);
    rt.applyMove(seat, 'CHOOSE_TICKETS', { keep: [0] });
    expect(rt.activeSeats()).not.toEqual([seat]); // choosing ended the turn
    expect(pub(rt).ticketCounts[seat]).toBe(3); // 2 initial + 1 kept
  });

  it('rejected tickets go to the BOTTOM of the ticket pile, not back on top', () => {
    const rt = newGame(17, 2);
    throughInitialTickets(rt);
    const state = rawState(rt);
    const hidden = (state.private as any)[-1];
    const seat = rt.activeSeats()[0]!;
    rt.applyMove(seat, 'DRAW_TICKETS', {});
    const offer = (rt.view(seat) as any).offer as { a: string; b: string; points: number }[];
    const rejected = [offer[1], offer[2]];
    rt.applyMove(seat, 'CHOOSE_TICKETS', { keep: [0] });
    // the two rejected tickets must now be the LAST two of the deck (draws splice from the front)
    expect(hidden.ticketDeck.slice(-2)).toEqual(rejected);
    // an immediate re-draw by the next player must NOT see the rejected tickets again
    const seat2 = rt.activeSeats()[0]!;
    rt.applyMove(seat2, 'DRAW_TICKETS', {});
    const offer2 = (rt.view(seat2) as any).offer as typeof offer;
    for (const t of rejected) expect(offer2).not.toContainEqual(t);
  });

  it('keeps a running action log attributing moves to seats', () => {
    const rt = newGame(19, 2);
    throughInitialTickets(rt);
    const seat = rt.activeSeats()[0]!;
    rt.applyMove(seat, 'DRAW_BLIND', {});
    const log = pub(rt).log;
    expect(log.length).toBeGreaterThanOrEqual(3); // 2× kept tickets + the draw
    const last = log[log.length - 1]!;
    expect(last.seat).toBe(seat);
    expect(last.text).toMatch(/drew a card/);
    expect(log.some((e) => e.text.match(/kept 2 destination tickets/))).toBe(true);
  });

  it('legal moves cover claims, draws and tickets on a fresh turn', () => {
    const rt = newGame(21, 2);
    throughInitialTickets(rt);
    const seat = rt.activeSeats()[0]!;
    const moves = rt.legalMoves(seat) as any[];
    const kinds = new Set(moves.map((m) => m.kind));
    expect(kinds.has('DRAW_BLIND')).toBe(true);
    expect(kinds.has('DRAW_FACEUP')).toBe(true);
    expect(kinds.has('DRAW_TICKETS')).toBe(true);
    // every listed claim must actually be payable
    for (const m of moves.filter((x) => x.kind === 'CLAIM_ROUTE')) {
      expect(ROUTES.find((r) => r.id === m.route)).toBeDefined();
      expect(m.color).toBeDefined();
    }
  });

  it('a full random game finishes with a winner', () => {
    for (const seed of [42, 99]) {
      const rt = newGame(seed, 3);
      let guard = 0;
      while (rt.currentStatus === 'active' && guard++ < 5000) {
        const seat = rt.activeSeats()[0]!;
        const moves = rt.legalMoves(seat) as any[];
        expect(moves.length).toBeGreaterThan(0);
        // prefer claims so the game actually ends
        const claims = moves.filter((m) => m.kind === 'CLAIM_ROUTE');
        const move = claims[guard % Math.max(1, claims.length)] ?? moves[guard % moves.length];
        rt.applyMove(seat, move.kind, move);
      }
      expect(rt.currentStatus).toBe('completed');
      expect(rt.endResult!.winners!.length).toBeGreaterThanOrEqual(1);
      const view = pub(rt);
      expect(view.finalScores).not.toBeNull();
    }
  });
});
