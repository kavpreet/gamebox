import { describe, it, expect } from 'vitest';
import {
  createSeededRandom,
  createVote,
  castVote,
  GameRuntime,
  IllegalMove,
} from '@gamebox/core-engine';
import { snakesAndLadders, SNAKES, LADDERS } from '@gamebox/game-snakes-and-ladders';

describe('SeededRandom', () => {
  it('is deterministic from a seed', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('int() stays within bounds', () => {
    const rng = createSeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('shuffle preserves elements', () => {
    const rng = createSeededRandom(1);
    const items = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(items);
    expect(shuffled.slice().sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]); // input untouched
  });

  it('state round-trips for replay', () => {
    const a = createSeededRandom(99);
    a.next();
    a.next();
    const resumed = createSeededRandom(a.getState());
    const cont = createSeededRandom(99);
    cont.next();
    cont.next();
    expect(resumed.next()).toBe(cont.next());
  });
});

describe('disconnect vote', () => {
  it('resolves the instant an option has strict majority of connected voters', () => {
    const vote = createVote(2, ['skip', 'pause', 'kick']);
    // seats 0,1,3 connected (2 is the disconnected target)
    let r = castVote(vote, 0, 'kick', [0, 1, 3]);
    expect(r.resolved).toBe(false);
    r = castVote(vote, 1, 'kick', [0, 1, 3]);
    expect(r.resolved).toBe(true);
    expect(r.option).toBe('kick');
  });

  it('a tie with all votes in falls back to pause', () => {
    const vote = createVote(2, ['skip', 'pause', 'kick']);
    castVote(vote, 0, 'kick', [0, 1]);
    const r = castVote(vote, 1, 'skip', [0, 1]);
    expect(r.resolved).toBe(true);
    expect(r.option).toBe('pause');
  });

  it('in a 2-player game the lone remaining voter decides unilaterally', () => {
    const vote = createVote(1, ['pause', 'kick']);
    const r = castVote(vote, 0, 'kick', [0]);
    expect(r.resolved).toBe(true);
    expect(r.option).toBe('kick');
  });
});

describe('snakes & ladders', () => {
  function newGame(seed = 123, players = 2) {
    const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
    return GameRuntime.start(snakesAndLadders, seats, seed);
  }

  it('plays a full deterministic game to completion', () => {
    const rt = newGame(42);
    let guard = 0;
    while (rt.currentStatus === 'active' && guard++ < 2000) {
      const seat = rt.activeSeats()[0]!;
      rt.applyMove(seat, 'ROLL', {});
    }
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toHaveLength(1);
    const view = rt.view('SPECTATOR') as any;
    expect(view.positions[rt.endResult!.winners![0]!]).toBe(100);
  });

  it('replays identically from the same seed', () => {
    const play = (seed: number) => {
      const rt = newGame(seed);
      const log: number[] = [];
      while (rt.currentStatus === 'active') {
        const seat = rt.activeSeats()[0]!;
        rt.applyMove(seat, 'ROLL', {});
        log.push((rt.view('SPECTATOR') as any).lastRoll.die);
      }
      return log;
    };
    expect(play(7)).toEqual(play(7));
  });

  it('rejects out-of-turn rolls', () => {
    const rt = newGame(1);
    const active = rt.activeSeats()[0]!;
    const other = active === 0 ? 1 : 0;
    expect(() => rt.applyMove(other, 'ROLL', {})).toThrow(IllegalMove);
  });

  it('snakes/ladders tables are consistent (no square maps to itself or chains)', () => {
    for (const [from, to] of Object.entries({ ...SNAKES, ...LADDERS })) {
      expect(Number(from)).not.toBe(to);
      expect(SNAKES[to]).toBeUndefined();
      expect(LADDERS[to]).toBeUndefined();
    }
  });

  it('kick removes seat and last player standing wins', () => {
    const rt = newGame(5, 2);
    const result = rt.removePlayer(0);
    expect(result.status).toBe('completed');
    expect(rt.endResult?.winners).toEqual([1]);
  });

  it('skip advances the turn', () => {
    const rt = newGame(9, 3);
    const first = rt.activeSeats()[0]!;
    rt.skipSeat(first);
    expect(rt.activeSeats()[0]).not.toBe(first);
  });
});
