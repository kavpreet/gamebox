import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove } from '@gamebox/core-engine';
import {
  chineseCheckers,
  allCells,
  armCells,
  destinations,
  type CCPublic,
} from '@gamebox/game-chinese-checkers';

function newGame(players = 2) {
  const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
  return GameRuntime.start(chineseCheckers, seats, 1);
}

describe('chinese checkers', () => {
  it('board has exactly 121 holes and arms have 10 each', () => {
    expect(allCells()).toHaveLength(121);
    for (let arm = 0; arm < 6; arm++) {
      expect(armCells(arm)).toHaveLength(10);
    }
    // arms are disjoint
    const all = new Set([0, 1, 2, 3, 4, 5].flatMap((a) => armCells(a)));
    expect(all.size).toBe(60);
  });

  it('2 players sit in opposite arms with 10 pegs each', () => {
    const rt = newGame(2);
    const pub = rt.view('SPECTATOR') as CCPublic;
    expect(Object.values(pub.pegs)).toHaveLength(20);
    expect((pub.homes[0]! + 3) % 6).toBe(pub.homes[1]);
  });

  it('jump chains reach multi-hop destinations', () => {
    // artificial line of pegs: 0,0 empty jumps over 1,0 → land 2,0; then chain over 3,0 → 4,0
    const pegs: Record<string, number> = { '0,0': 0, '1,0': 1, '3,0': 1 };
    const dests = destinations(pegs, '0,0');
    expect(dests).toContain('2,0'); // single jump
    expect(dests).toContain('4,0'); // chained double jump
    expect(dests).toContain('0,1'); // simple step
    expect(dests).not.toContain('1,0'); // occupied
  });

  it('rejects moving an opponent peg or unreachable hole', () => {
    const rt = newGame(2);
    const pub = rt.view('SPECTATOR') as CCPublic;
    const seat0Cell = Object.entries(pub.pegs).find(([, s]) => s === 0)![0];
    const seat1Cell = Object.entries(pub.pegs).find(([, s]) => s === 1)![0];
    expect(() => rt.applyMove(0, 'MOVE', { from: seat1Cell, to: '0,0' })).toThrow(IllegalMove);
    expect(() => rt.applyMove(0, 'MOVE', { from: seat0Cell, to: '0,0' })).toThrow(IllegalMove);
  });

  it('legal moves exist at the start and play alternates', () => {
    const rt = newGame(2);
    const moves = rt.legalMoves(0) as any[];
    expect(moves.length).toBeGreaterThan(0);
    const m = moves[0];
    rt.applyMove(0, 'MOVE', m);
    expect(rt.activeSeats()).toEqual([1]);
  });

  it('winning = filling the opposite arm', () => {
    const rt = newGame(2);
    const state = (rt as any).state as { public: CCPublic };
    const pub = state.public;
    const target = (pub.homes[0]! + 3) % 6;
    const targetCells = armCells(target);
    // teleport seat 0's pegs into all but one target cell, then move in the
    // last one (clear the board first — the target arm starts full of the
    // opponent's pegs, which in a real game would have moved out)
    for (const cell of Object.keys(pub.pegs)) delete pub.pegs[cell];
    // Fill all but one target cell, choosing the empty one so it has a free
    // in-star neighbor to step in from (arm tips have no outside neighbors).
    const board = new Set(allCells());
    const freeNeighborOf = (cell: string, occupied: Set<string>): string | null => {
      const [x, z] = cell.split(',').map(Number) as [number, number];
      const opts = [
        `${x + 1},${z}`, `${x - 1},${z}`, `${x},${z + 1}`, `${x},${z - 1}`, `${x + 1},${z - 1}`, `${x - 1},${z + 1}`,
      ];
      return opts.find((c) => board.has(c) && !occupied.has(c)) ?? null;
    };
    let last = '';
    let start = '';
    for (const candidate of targetCells) {
      const others = targetCells.filter((c) => c !== candidate);
      const occupied = new Set([...others, ...Object.keys(pub.pegs)]);
      const n = freeNeighborOf(candidate, occupied);
      if (n) {
        last = candidate;
        start = n;
        others.forEach((c) => (pub.pegs[c] = 0));
        pub.pegs[n] = 0;
        break;
      }
    }
    expect(last).not.toBe('');
    pub.turnIndex = 0;
    rt.applyMove(0, 'MOVE', { from: start, to: last });
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([0]);
  });
});
