import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import {
  azul,
  wallColumnFor,
  type AzulPublic,
  type AzulMove,
  type TileColor,
} from '@gamebox/game-azul';

const seats2 = [{ seat: 0 }, { seat: 1 }];

function pub(rt: GameRuntime): AzulPublic {
  return (rt.snapshot().state as { public: AzulPublic }).public;
}

function playRandomGame(seed: number): GameRuntime {
  const rt = GameRuntime.start(azul, seats2, seed);
  let guard = 0;
  while (rt.currentStatus === 'active') {
    if (++guard > 5000) throw new Error('game did not terminate');
    const seat = rt.activeSeats()[0]!;
    const legal = rt.legalMoves(seat) as AzulMove[];
    expect(legal.length).toBeGreaterThan(0);
    // prefer pattern-line placements over floor dumps so the game progresses
    const lines = legal.filter((m) => m.line !== 'floor');
    const pick = (lines.length > 0 ? lines : legal)[guard % (lines.length > 0 ? lines.length : legal.length)]!;
    rt.applyMove(seat, 'DRAFT', pick);
  }
  return rt;
}

describe('azul', () => {
  it('sets up 5 factories of 4 tiles for 2 players and a 100-tile supply', () => {
    const rt = GameRuntime.start(azul, seats2, 42);
    const p = pub(rt);
    expect(p.factories).toHaveLength(5);
    for (const f of p.factories) expect(f).toHaveLength(4);
    expect(p.bagSize).toBe(100 - 20);
    expect(p.firstMarkerInCenter).toBe(true);
  });

  it('3 and 4 players get 7 and 9 factories', () => {
    expect(pub(GameRuntime.start(azul, [{ seat: 0 }, { seat: 1 }, { seat: 2 }], 1)).factories).toHaveLength(7);
    expect(pub(GameRuntime.start(azul, [{ seat: 0 }, { seat: 1 }, { seat: 2 }, { seat: 3 }], 1)).factories).toHaveLength(9);
  });

  it('drafting from a factory moves leftovers to the center', () => {
    const rt = GameRuntime.start(azul, seats2, 7);
    const p = pub(rt);
    const f0 = p.factories[0]!;
    const color = f0[0]!;
    const taken = f0.filter((t) => t === color).length;
    const rest = f0.length - taken;
    rt.applyMove(0, 'DRAFT', { kind: 'DRAFT', source: 0, color, line: 0 });
    const after = pub(rt);
    expect(after.factories[0]).toHaveLength(0);
    expect(after.center).toHaveLength(rest);
    const line0 = after.boards[0]!.lines[0]!;
    // line 0 holds max 1 tile — overflow goes to the floor
    expect(line0.count).toBe(1);
    expect(after.boards[0]!.floor).toHaveLength(taken - 1);
  });

  it('first center draft takes the first-player marker to the floor', () => {
    const rt = GameRuntime.start(azul, seats2, 7);
    const f0 = pub(rt).factories[0]!;
    rt.applyMove(0, 'DRAFT', { kind: 'DRAFT', source: 0, color: f0[0], line: 'floor' });
    const center = pub(rt).center;
    if (center.length === 0) return; // factory was uniform — nothing to test
    rt.applyMove(1, 'DRAFT', { kind: 'DRAFT', source: 'center', color: center[0], line: 'floor' });
    const p = pub(rt);
    expect(p.firstMarkerInCenter).toBe(false);
    expect(p.nextStarter).toBe(1);
    expect(p.boards[1]!.floor[0]).toBe('first');
  });

  it('rejects placing a color on a line already holding another color', () => {
    const rt = GameRuntime.start(azul, seats2, 11);
    // find a factory with 2+ distinct colors somewhere, else use two factories
    const p = pub(rt);
    const fi = p.factories.findIndex((f) => new Set(f).size >= 2);
    expect(fi).toBeGreaterThanOrEqual(0);
    const colors = [...new Set(p.factories[fi]!)];
    rt.applyMove(0, 'DRAFT', { kind: 'DRAFT', source: fi, color: colors[0], line: 4 });
    // opponent turn: dump something on the floor
    const p2 = pub(rt);
    const src = p2.factories.findIndex((f) => f.length > 0);
    rt.applyMove(1, 'DRAFT', { kind: 'DRAFT', source: src >= 0 ? src : 'center', color: (src >= 0 ? p2.factories[src]! : p2.center)[0], line: 'floor' });
    // back to seat 0: try the OTHER color on the same line
    const p3 = pub(rt);
    const other = colors[1]! as TileColor;
    const src2 = p3.factories.findIndex((f) => f.includes(other));
    const source = src2 >= 0 ? src2 : 'center';
    if (src2 >= 0 || p3.center.includes(other)) {
      expect(() => rt.applyMove(0, 'DRAFT', { kind: 'DRAFT', source, color: other, line: 4 })).toThrow();
    }
  });

  it('random playouts terminate with a completed wall row and sane scores', () => {
    for (const seed of [3, 99, 2026]) {
      const rt = playRandomGame(seed);
      expect(rt.currentStatus).toBe('completed');
      const p = pub(rt);
      expect(p.gameOver).toBe(true);
      const someRowDone = p.order.some((s) => p.boards[s]!.wall.some((row) => row.every(Boolean)));
      expect(someRowDone).toBe(true);
      const winners = rt.endResult?.winners ?? [];
      expect(winners.length).toBeGreaterThan(0);
      const best = Math.max(...p.order.map((s) => p.boards[s]!.score));
      for (const w of winners) expect(p.boards[w]!.score).toBe(best);
      for (const s of p.order) expect(p.boards[s]!.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('wall pattern helper matches the classic Azul layout', () => {
    // row 0: color c sits at column c; each row shifts right by one
    expect(wallColumnFor(0, 0)).toBe(0);
    expect(wallColumnFor(1, 0)).toBe(1);
    expect(wallColumnFor(4, 4)).toBe(3);
  });
});
