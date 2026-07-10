import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove } from '@gamebox/core-engine';
import { ludo, movableTokens, globalSquare, HOME, type LudoPublic } from '@gamebox/game-ludo';

function newGame(seed = 1, players = 2) {
  const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
  return GameRuntime.start(ludo, seats, seed);
}

function pub(rt: GameRuntime): LudoPublic {
  return rt.view('SPECTATOR') as LudoPublic;
}

describe('ludo', () => {
  it('needs a 6 to leave the yard', () => {
    const p: LudoPublic = {
      tokens: { 0: [-1, -1, -1, -1] },
      entries: { 0: 0 },
      order: [0],
      turnIndex: 0,
      phase: 'ROLL',
      die: null,
      lastEvent: null,
      winner: null,
    };
    expect(movableTokens(p, 0, 5)).toEqual([]);
    expect(movableTokens(p, 0, 6)).toEqual([0, 1, 2, 3]);
  });

  it('requires exact roll into home', () => {
    const p: LudoPublic = {
      tokens: { 0: [54, HOME, HOME, HOME] },
      entries: { 0: 0 },
      order: [0],
      turnIndex: 0,
      phase: 'ROLL',
      die: null,
      lastEvent: null,
      winner: null,
    };
    expect(movableTokens(p, 0, 2)).toEqual([0]); // 54+2 = 56 = home
    expect(movableTokens(p, 0, 3)).toEqual([]); // overshoot
  });

  it('maps seat progress to shifted global squares', () => {
    const p = pub(newGame(1, 2));
    expect(globalSquare(p, 0, 0)).toBe(p.entries[0]);
    expect(globalSquare(p, 1, 0)).toBe(p.entries[1]);
    expect(p.entries[1]! - p.entries[0]!).toBe(13);
    expect(globalSquare(p, 0, 51)).toBeNull(); // home column is private to the seat
  });

  it('plays a full game to completion under random play', () => {
    const rt = newGame(99, 2);
    let guard = 0;
    while (rt.currentStatus === 'active' && guard++ < 20000) {
      const seat = rt.activeSeats()[0]!;
      const moves = rt.legalMoves(seat) as any[];
      expect(moves.length).toBeGreaterThan(0);
      const move = moves[Math.floor(Math.random() * moves.length)];
      rt.applyMove(seat, move.kind, move);
    }
    expect(rt.currentStatus).toBe('completed');
    const winner = rt.endResult!.winners![0]!;
    expect(pub(rt).tokens[winner]!.every((t) => t === HOME)).toBe(true);
  });

  it('rejects moving before rolling', () => {
    const rt = newGame(5, 2);
    const seat = rt.activeSeats()[0]!;
    expect(() => rt.applyMove(seat, 'MOVE', { token: 0 })).toThrow(IllegalMove);
  });

  it('captures a lone opponent on a shared non-safe square', () => {
    const rt = newGame(1, 2);
    // Hand-craft: seat 1 token at global 5 (progress 5-13 mod 52 => set directly)
    const state = (rt as any).state as { public: LudoPublic };
    const p = state.public;
    p.tokens[0] = [0, -1, -1, -1]; // seat 0 entry at 0, token on global 0... move it to land on opponent
    p.tokens[1] = [44, -1, -1, -1]; // seat1 entry 13 → progress 44 → global (13+44)%52 = 5
    p.phase = 'MOVE';
    p.die = 5;
    p.turnIndex = 0;
    rt.applyMove(0, 'MOVE', { token: 0 }); // 0+5 → progress 5 → global 5 — capture!
    expect(p.tokens[1]![0]).toBe(-1);
  });

  it('safe squares protect from capture', () => {
    const rt = newGame(1, 2);
    const state = (rt as any).state as { public: LudoPublic };
    const p = state.public;
    // global 8 is a safe star: seat0 progress 8 lands there; seat1 progress 47 → (13+47)%52 = 8
    p.tokens[0] = [3, -1, -1, -1];
    p.tokens[1] = [47, -1, -1, -1];
    p.phase = 'MOVE';
    p.die = 5;
    p.turnIndex = 0;
    rt.applyMove(0, 'MOVE', { token: 0 }); // to progress 8 → global 8 (safe)
    expect(p.tokens[1]![0]).toBe(47); // not captured
  });
});
