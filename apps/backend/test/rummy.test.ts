import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import {
  rummy,
  isValidSet,
  isValidRun,
  canLayOff,
  findMeldCandidates,
  type Card,
} from '@gamebox/game-rummy';

const c = (suit: Card['suit'], rank: number): Card => ({ suit, rank });

describe('rummy meld validation', () => {
  it('validates sets', () => {
    expect(isValidSet([c('S', 7), c('H', 7), c('D', 7)])).toBe(true);
    expect(isValidSet([c('S', 7), c('H', 7), c('D', 7), c('C', 7)])).toBe(true);
    expect(isValidSet([c('S', 7), c('S', 7), c('D', 7)])).toBe(false); // dup suit
    expect(isValidSet([c('S', 7), c('H', 8), c('D', 7)])).toBe(false); // mixed rank
    expect(isValidSet([c('S', 7), c('H', 7)])).toBe(false); // too short
  });

  it('validates runs with ace low and high', () => {
    expect(isValidRun([c('S', 1), c('S', 2), c('S', 3)])).toBe(true); // A-2-3
    expect(isValidRun([c('S', 12), c('S', 13), c('S', 1)])).toBe(true); // Q-K-A
    expect(isValidRun([c('S', 13), c('S', 1), c('S', 2)])).toBe(false); // no wraparound
    expect(isValidRun([c('S', 4), c('H', 5), c('S', 6)])).toBe(false); // mixed suit
    expect(isValidRun([c('S', 4), c('S', 6), c('S', 7)])).toBe(false); // gap
  });

  it('lay-off keeps melds valid', () => {
    const run = { cards: [c('S', 4), c('S', 5), c('S', 6)], type: 'run' as const };
    expect(canLayOff(run, c('S', 3))).toBe(true);
    expect(canLayOff(run, c('S', 7))).toBe(true);
    expect(canLayOff(run, c('H', 7))).toBe(false);
    const set = { cards: [c('S', 9), c('H', 9), c('D', 9)], type: 'set' as const };
    expect(canLayOff(set, c('C', 9))).toBe(true);
    expect(canLayOff(set, c('S', 9))).toBe(false); // dup suit
  });

  it('finds meld candidates in a hand', () => {
    const hand = [c('S', 4), c('S', 5), c('S', 6), c('H', 9), c('D', 9), c('C', 9), c('S', 2)];
    const found = findMeldCandidates(hand);
    const asCards = found.map((m) => m.map((i) => `${hand[i]!.suit}${hand[i]!.rank}`).sort().join(' '));
    expect(asCards).toContain('S4 S5 S6');
    expect(asCards).toContain('C9 D9 H9');
  });
});

describe('rummy gameplay', () => {
  it('plays random games to completion', () => {
    for (const seed of [3, 17]) {
      const rt = GameRuntime.start(rummy, [{ seat: 0 }, { seat: 1 }], seed);
      let guard = 0;
      while (rt.currentStatus === 'active' && guard++ < 20000) {
        const seat = rt.activeSeats()[0]!;
        const moves = rt.legalMoves(seat) as any[];
        expect(moves.length).toBeGreaterThan(0);
        // bias toward melds/layoffs so games actually end
        const meld = moves.find((m: any) => m.kind === 'MELD' || m.kind === 'LAYOFF');
        const move = meld ?? moves[Math.floor(Math.random() * moves.length)];
        rt.applyMove(seat, move.kind, move);
      }
      expect(rt.currentStatus).toBe('completed');
    }
  });

  it('hides hands and piles from other viewers', () => {
    const rt = GameRuntime.start(rummy, [{ seat: 0 }, { seat: 1 }], 5);
    const spec = rt.view('SPECTATOR') as any;
    expect(spec.hand).toBeNull();
    expect(JSON.stringify(spec)).not.toContain('"stock":');
    const mine = rt.view(0) as any;
    expect(mine.hand).toHaveLength(10); // 2 players → 10 cards
  });
});
