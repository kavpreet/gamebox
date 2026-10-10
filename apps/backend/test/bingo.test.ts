import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameRuntime, createSeededRandom } from '@gamebox/core-engine';
import {
  bingo,
  defaultConfig,
  generateCard75,
  generateCard90,
  CALLER_STALL_MS,
  FREE,
  type BingoConfig,
  type BingoPublic,
  type BingoView,
} from '@gamebox/game-bingo';

const seats3 = [{ seat: 0 }, { seat: 1 }, { seat: 2 }];

function pub(rt: GameRuntime): BingoPublic {
  return (rt.snapshot().state as { public: BingoPublic }).public;
}
function view(rt: GameRuntime, seat: number): BingoView {
  return rt.view(seat) as BingoView;
}
function card(rt: GameRuntime, seat: number, i = 0) {
  return view(rt, seat).yourCards!.cards[i]!;
}

function startGame(config: Partial<BingoConfig>, seed = 1, seats = seats3): GameRuntime {
  const rt = GameRuntime.start(bingo, seats, seed);
  rt.applyMove(0, 'CONFIGURE', { config: { ...defaultConfig(config.balls ?? 75), ...config } });
  rt.applyMove(0, 'START', {});
  return rt;
}

/** Round-robin: let whoever's turn it is draw until `pred` holds. */
function drawUntil(rt: GameRuntime, pred: (calls: number[]) => boolean): void {
  for (let guard = 0; guard < 100 && !pred(pub(rt).calls); guard++) {
    const p = pub(rt);
    rt.applyMove(p.caller!, 'DRAW', { at: p.calls.length });
  }
  expect(pred(pub(rt).calls)).toBe(true);
}

function markAll(rt: GameRuntime, seat: number, nums: number[], cardIdx = 0): void {
  for (const n of nums) if (n !== FREE) rt.applyMove(seat, 'MARK', { card: cardIdx, n });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-10T20:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('bingo cards', () => {
  it('75-ball cards: 5 per BINGO column in range, free centre, no repeats', () => {
    const rng = createSeededRandom(5);
    for (let k = 0; k < 50; k++) {
      const c = generateCard75(rng);
      expect(c.cells[2]![2]).toBe(FREE);
      const all = c.cells.flat().filter((n) => n !== FREE) as number[];
      expect(new Set(all).size).toBe(24);
      c.cells.forEach((row, r) =>
        row.forEach((n, col) => {
          if (r === 2 && col === 2) return;
          expect(n).toBeGreaterThanOrEqual(col * 15 + 1);
          expect(n).toBeLessThanOrEqual(col * 15 + 15);
        }),
      );
    }
  });

  it('90-ball tickets: 3×9, five numbers per row, every column used, ascending', () => {
    const rng = createSeededRandom(9);
    for (let k = 0; k < 200; k++) {
      const t = generateCard90(rng);
      expect(t.cells).toHaveLength(3);
      for (const row of t.cells) {
        expect(row).toHaveLength(9);
        expect(row.filter((n) => n !== null)).toHaveLength(5);
      }
      for (let col = 0; col < 9; col++) {
        const nums = t.cells.map((r) => r[col]).filter((n): n is number => n !== null);
        expect(nums.length).toBeGreaterThanOrEqual(1);
        expect([...nums].sort((a, b) => a - b)).toEqual(nums);
        const lo = col === 0 ? 1 : col * 10;
        const hi = col === 8 ? 90 : col * 10 + 9;
        for (const n of nums) {
          expect(n).toBeGreaterThanOrEqual(lo);
          expect(n).toBeLessThanOrEqual(hi);
        }
      }
    }
  });
});

describe('bingo setup', () => {
  it('only the host configures and starts; bad configs are rejected', () => {
    const rt = GameRuntime.start(bingo, seats3, 1);
    expect(rt.activeSeats()).toEqual([0]);
    expect(() => rt.applyMove(1, 'START', {})).toThrow();
    expect(() => rt.applyMove(0, 'CONFIGURE', { config: { ...defaultConfig(75), prizes: [] } })).toThrow(/prize/);
    expect(() =>
      rt.applyMove(0, 'CONFIGURE', { config: { ...defaultConfig(75), prizes: [{ id: 'early5', points: 5 }] } }),
    ).toThrow(/isn't available/);
    expect(() =>
      rt.applyMove(0, 'CONFIGURE', { config: { ...defaultConfig(90), prizes: [{ id: 'house2', points: 5 }] } }),
    ).toThrow(/needs Full House/);
    rt.applyMove(0, 'CONFIGURE', { config: { ...defaultConfig(90), cardsPerPlayer: 3 } });
    rt.applyMove(0, 'START', {});
    expect(pub(rt).phase).toBe('playing');
    expect(rt.activeSeats().sort()).toEqual([0, 1, 2]);
    expect(view(rt, 1).yourCards!.cards).toHaveLength(3);
  });

  it('cards are private: spectators and other seats never see them', () => {
    const rt = startGame({});
    expect(view(rt, 0).yourCards).not.toBeNull();
    expect((rt.view('SPECTATOR') as BingoView).yourCards).toBeNull();
    const mine = JSON.stringify(card(rt, 1).cells);
    expect(JSON.stringify(rt.view(0))).not.toContain(mine);
    expect(JSON.stringify(rt.view('SPECTATOR'))).not.toContain('"bag"');
  });
});

describe('bingo calling', () => {
  it('auto mode: draws only when due, stale draws are no-ops, host can pause', () => {
    const rt = startGame({ callMode: 'auto', intervalSec: 5 });
    expect(() => rt.applyMove(1, 'DRAW', { at: 0 })).toThrow(/not due/);
    vi.advanceTimersByTime(4_000);
    rt.applyMove(1, 'DRAW', { at: 0 });
    expect(pub(rt).calls).toHaveLength(1);
    rt.applyMove(2, 'DRAW', { at: 0 }); // a second phone raced — ignored
    expect(pub(rt).calls).toHaveLength(1);
    expect(view(rt, 0).msUntilNext).toBe(5_000);
    vi.advanceTimersByTime(5_000);
    rt.applyMove(2, 'DRAW', { at: 1 });
    expect(pub(rt).calls).toHaveLength(2);

    expect(() => rt.applyMove(1, 'PAUSE', {})).toThrow(/host/);
    rt.applyMove(0, 'PAUSE', {});
    vi.advanceTimersByTime(60_000);
    expect(() => rt.applyMove(1, 'DRAW', { at: 2 })).toThrow(/paused/);
    rt.applyMove(0, 'RESUME', {});
    vi.advanceTimersByTime(5_000);
    rt.applyMove(1, 'DRAW', { at: 2 });
    expect(new Set(pub(rt).calls).size).toBe(3);
  });

  it('round robin: callers take turns; a stalled caller can be covered', () => {
    const rt = startGame({ callMode: 'roundRobin' });
    expect(pub(rt).caller).toBe(0);
    expect(() => rt.applyMove(1, 'DRAW', { at: 0 })).toThrow(/not your turn/);
    rt.applyMove(0, 'DRAW', { at: 0 });
    expect(pub(rt).caller).toBe(1);
    rt.applyMove(1, 'DRAW', { at: 1 });
    expect(pub(rt).caller).toBe(2);
    vi.advanceTimersByTime(CALLER_STALL_MS + 1);
    rt.applyMove(0, 'DRAW', { at: 2 }); // seat 2 fell asleep
    expect(pub(rt).calls).toHaveLength(3);
    expect(pub(rt).caller).toBe(0);
  });

  it('combat: the caller chooses each number; turns rotate; picks are validated', () => {
    const rt = startGame({ callMode: 'combat', prizes: [{ id: 'row1', points: 10 }] });
    expect(pub(rt).caller).toBe(0);
    expect(() => rt.applyMove(1, 'DRAW', { at: 0, n: 5 })).toThrow(/not your turn/);
    expect(() => rt.applyMove(0, 'DRAW', { at: 0 })).toThrow(/Choose a number/);
    expect(() => rt.applyMove(0, 'DRAW', { at: 0, n: 76 })).toThrow(/1–75/);
    rt.applyMove(0, 'DRAW', { at: 0, n: 7 });
    expect(pub(rt).calls).toEqual([7]);
    expect(pub(rt).caller).toBe(1);
    expect(() => rt.applyMove(1, 'DRAW', { at: 1, n: 7 })).toThrow(/already been called/);
    expect(pub(rt).log.at(-1)).toMatchObject({ kind: 'call', seat: 0, text: 'called B 7' });

    // seat 1 completes their own top row by calling its numbers whenever it's their turn
    const target = (card(rt, 1).cells[0] as number[]).filter((n) => n !== FREE && n !== 7);
    let pick = 0;
    while (!target.every((n) => pub(rt).calls.includes(n))) {
      const p = pub(rt);
      const free = (n: number) => !p.calls.includes(n);
      const n = p.caller === 1
        ? target.find(free)!
        : Array.from({ length: 75 }, (_, i) => i + 1).find((x) => free(x) && !target.includes(x))!;
      rt.applyMove(p.caller!, 'DRAW', { at: p.calls.length, n });
      if (++pick > 40) throw new Error('loop');
    }
    markAll(rt, 1, card(rt, 1).cells[0] as number[]);
    rt.applyMove(1, 'CLAIM', { prize: 'row1', card: 0 });
    expect(pub(rt).scores[1]).toBe(10);
    // all prizes gone → the next call ends the game without needing a number
    rt.applyMove(pub(rt).caller!, 'DRAW', { at: pub(rt).calls.length });
    expect(rt.currentStatus).toBe('completed');
  });

  it('combat: every number can be called once, then the game ends', () => {
    const rt = startGame({ callMode: 'combat' });
    for (let n = 75; n >= 1; n--) rt.applyMove(pub(rt).caller!, 'DRAW', { at: 75 - n, n });
    expect(new Set(pub(rt).calls).size).toBe(75);
    rt.applyMove(pub(rt).caller!, 'DRAW', { at: 75 });
    expect(rt.currentStatus).toBe('completed');
  });

  it('runs out of balls and ends the game', () => {
    const rt = startGame({ callMode: 'roundRobin', balls: 90 });
    drawUntil(rt, (c) => c.length === 90);
    expect(new Set(pub(rt).calls).size).toBe(90);
    rt.applyMove(pub(rt).caller!, 'DRAW', { at: 90 });
    expect(rt.currentStatus).toBe('completed');
  });
});

describe('bingo claims', () => {
  it('players may mark uncalled numbers, but claiming on them is a bogey with a penalty', () => {
    const rt = startGame({ callMode: 'roundRobin', penalty: 7, prizes: [{ id: 'row1', points: 10 }] });
    const topRow = card(rt, 1).cells[0] as number[];
    markAll(rt, 1, topRow); // nothing called yet — dabbing is allowed
    expect(view(rt, 1).yourCards!.marks[0]).toHaveLength(5);
    rt.applyMove(1, 'CLAIM', { prize: 'row1', card: 0 });
    const p = pub(rt);
    expect(p.scores[1]).toBe(-7);
    expect(p.bogeys[1]).toBe(1);
    expect(p.log.at(-1)!.text).toMatch(/wasn't called|weren't called/);
    expect(p.prizes[0]!.winners).toHaveLength(0);
  });

  it('claiming an incomplete pattern is also a bogey', () => {
    const rt = startGame({ callMode: 'roundRobin', prizes: [{ id: 'blackout', points: 50 }] });
    rt.applyMove(0, 'CLAIM', { prize: 'blackout', card: 0 });
    expect(pub(rt).log.at(-1)!.text).toMatch(/not complete/);
    expect(pub(rt).scores[0]).toBe(-10);
  });

  it('a verified claim wins; ties on the same ball share; next ball closes the prize', () => {
    const rt = startGame({ callMode: 'roundRobin', prizes: [{ id: 'corners75', points: 20 }, { id: 'blackout', points: 50 }] });
    const corners = (seat: number) => {
      const c = card(rt, seat).cells as number[][];
      return [c[0]![0]!, c[0]![4]!, c[4]![0]!, c[4]![4]!];
    };
    const needed = new Set([...corners(1), ...corners(2)]);
    drawUntil(rt, (calls) => [...needed].every((n) => calls.includes(n)));
    markAll(rt, 1, corners(1));
    markAll(rt, 2, corners(2));
    rt.applyMove(1, 'CLAIM', { prize: 'corners75', card: 0 });
    rt.applyMove(2, 'CLAIM', { prize: 'corners75', card: 0 }); // same ball → shares
    let p = pub(rt);
    expect(p.prizes[0]!.winners.map((w) => w.seat)).toEqual([1, 2]);
    expect(p.scores[1]).toBe(10);
    expect(p.scores[2]).toBe(10);
    expect(() => rt.applyMove(1, 'CLAIM', { prize: 'corners75', card: 0 })).toThrow(/already won/);

    rt.applyMove(p.caller!, 'DRAW', { at: p.calls.length });
    markAll(rt, 0, corners(0).filter((n) => pub(rt).calls.includes(n)));
    expect(() => rt.applyMove(0, 'CLAIM', { prize: 'corners75', card: 0 })).toThrow(/already been won/);
    p = pub(rt);
    expect(p.scores[0]).toBe(0); // procedural rejection, no penalty
  });

  it('tambola: early five, full house, 2nd full house, then the game ends', () => {
    const rt = startGame({
      balls: 90,
      callMode: 'roundRobin',
      prizes: [{ id: 'early5', points: 10 }, { id: 'house', points: 50 }, { id: 'house2', points: 30 }],
    });
    const nums = (seat: number) => (card(rt, seat).cells.flat().filter((n) => n !== null) as number[]);
    const five = nums(1).slice(0, 5);
    drawUntil(rt, (calls) => five.every((n) => calls.includes(n)));
    markAll(rt, 1, five);
    rt.applyMove(1, 'CLAIM', { prize: 'early5', card: 0 });
    expect(pub(rt).scores[1]).toBe(10);

    expect(() => rt.applyMove(2, 'CLAIM', { prize: 'house2', card: 0 })).toThrow(/opens after/);

    drawUntil(rt, (calls) => nums(0).every((n) => calls.includes(n)) || nums(2).every((n) => calls.includes(n)));
    const first = nums(0).every((n) => pub(rt).calls.includes(n)) ? 0 : 2;
    const second = first === 0 ? 2 : 0;
    markAll(rt, first, nums(first));
    rt.applyMove(first, 'CLAIM', { prize: 'house', card: 0 });
    expect(pub(rt).prizes[1]!.winners[0]!.seat).toBe(first);

    drawUntil(rt, (calls) => nums(second).every((n) => calls.includes(n)) && calls.length > pub(rt).prizes[1]!.wonAtCall!);
    markAll(rt, second, nums(second));
    rt.applyMove(second, 'CLAIM', { prize: 'house2', card: 0 });
    expect(rt.currentStatus).toBe('active'); // last prize can still be shared this ball
    const p = pub(rt);
    rt.applyMove(p.caller!, 'DRAW', { at: p.calls.length });
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult!.winners).toEqual([first]);
  });

  it('5 lines (B-I-N-G-O): four lines is a bogey, five lines wins', () => {
    const rt = startGame({ callMode: 'combat', prizes: [{ id: 'lines5', points: 50 }] });
    const c = card(rt, 0).cells as number[][];
    const rows = [0, 1, 2, 3].map((r) => c[r]!.filter((n) => n !== FREE));
    const col4 = c.map((r) => r[4]!);
    const callAll = (nums: number[]) => {
      for (const n of nums) {
        if (pub(rt).calls.includes(n)) continue;
        // every seat "helps" seat 0 here — we only care about pattern checking
        rt.applyMove(pub(rt).caller!, 'DRAW', { at: pub(rt).calls.length, n });
      }
    };
    callAll(rows.flat());
    markAll(rt, 0, rows.flat());
    rt.applyMove(0, 'CLAIM', { prize: 'lines5', card: 0 }); // only 4 lines
    expect(pub(rt).bogeys[0]).toBe(1);
    callAll(col4);
    markAll(rt, 0, col4.filter((n) => !rows.flat().includes(n)));
    rt.applyMove(0, 'CLAIM', { prize: 'lines5', card: 0 });
    expect(pub(rt).prizes[0]!.winners).toEqual([{ seat: 0, card: 0 }]);
    expect(pub(rt).scores[0]).toBe(40); // 50 − one bogey
  });

  it('the host can end the game early; highest score wins', () => {
    const rt = startGame({ callMode: 'roundRobin' });
    rt.applyMove(1, 'CLAIM', { prize: 'line', card: 0 }); // bogey → −10
    expect(() => rt.applyMove(1, 'END', {})).toThrow(/host/);
    rt.applyMove(0, 'END', {});
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult!.winners!.sort()).toEqual([0, 2]);
  });

  it('removing the round-robin caller passes the turn on', () => {
    const rt = startGame({ callMode: 'roundRobin' });
    rt.applyMove(0, 'DRAW', { at: 0 });
    expect(pub(rt).caller).toBe(1);
    rt.removePlayer(1);
    expect(pub(rt).caller).toBe(2);
    rt.removePlayer(0);
    expect(pub(rt).host).toBe(2);
  });
});
