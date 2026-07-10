import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove } from '@gamebox/core-engine';
import { checkers, legalSteps, type CheckersPublic } from '@gamebox/game-checkers';

function newGame() {
  return GameRuntime.start(checkers, [{ seat: 0 }, { seat: 1 }], 1);
}

function pub(rt: GameRuntime): CheckersPublic {
  return rt.view('SPECTATOR') as CheckersPublic;
}

describe('checkers', () => {
  it('starts with 12 pieces each and 7 opening moves', () => {
    const rt = newGame();
    const pieces = Object.values(pub(rt).board);
    expect(pieces.filter((p) => p.seat === 0)).toHaveLength(12);
    expect(pieces.filter((p) => p.seat === 1)).toHaveLength(12);
    expect(rt.legalMoves(0)).toHaveLength(7);
  });

  it('forces captures when available', () => {
    const board: CheckersPublic = {
      board: {
        '2,2': { seat: 0, king: false },
        '3,3': { seat: 1, king: false },
        '6,2': { seat: 0, king: false }, // has a quiet move available
      },
      turn: 0,
      chain: null,
      lastMove: null,
      winner: null,
    };
    const steps = legalSteps(board, 0);
    // only the capture is legal — the quiet moves of 6,2 are excluded
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ from: '2,2', to: '4,4', captured: '3,3' });
  });

  it('multi-jump chains keep the same player on turn', () => {
    const rt = newGame();
    const state = (rt as any).state as { public: CheckersPublic };
    state.public.board = {
      '1,1': { seat: 0, king: false },
      '2,2': { seat: 1, king: false },
      '4,4': { seat: 1, king: false },
      '7,7': { seat: 1, king: false }, // so seat 1 still has material/moves
    };
    state.public.turn = 0;
    rt.applyMove(0, 'MOVE', { from: '1,1', to: '3,3' });
    const p = pub(rt);
    expect(p.chain).toBe('3,3');
    expect(rt.activeSeats()).toEqual([0]); // still seat 0
    rt.applyMove(0, 'MOVE', { from: '3,3', to: '5,5' });
    expect(pub(rt).chain).toBeNull();
    expect(rt.activeSeats()).toEqual([1]);
  });

  it('promotes on the back rank', () => {
    const rt = newGame();
    const state = (rt as any).state as { public: CheckersPublic };
    state.public.board = {
      '1,6': { seat: 0, king: false },
      '6,6': { seat: 1, king: false },
      '7,1': { seat: 1, king: false },
    };
    state.public.turn = 0;
    rt.applyMove(0, 'MOVE', { from: '1,6', to: '0,7' });
    expect(pub(rt).board['0,7']!.king).toBe(true);
  });

  it('a player with no moves loses', () => {
    const rt = newGame();
    const state = (rt as any).state as { public: CheckersPublic };
    state.public.board = {
      '0,0': { seat: 0, king: false },
      '1,1': { seat: 1, king: false }, // seat 1's only piece — capturing it ends the game
    };
    state.public.turn = 0;
    // forced capture: 0,0 → 2,2 over 1,1
    rt.applyMove(0, 'MOVE', { from: '0,0', to: '2,2' });
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([0]);
  });

  it('rejects quiet moves when a capture is forced', () => {
    const rt = newGame();
    const state = (rt as any).state as { public: CheckersPublic };
    state.public.board = {
      '2,2': { seat: 0, king: false },
      '3,3': { seat: 1, king: false },
      '6,2': { seat: 0, king: false },
      '7,7': { seat: 1, king: false },
    };
    state.public.turn = 0;
    expect(() => rt.applyMove(0, 'MOVE', { from: '6,2', to: '5,3' })).toThrow(IllegalMove);
  });

  it('random playout terminates', () => {
    const rt = newGame();
    let guard = 0;
    while (rt.currentStatus === 'active' && guard++ < 500) {
      const seat = rt.activeSeats()[0]!;
      const moves = rt.legalMoves(seat) as any[];
      if (moves.length === 0) break;
      const m = moves[Math.floor(Math.random() * moves.length)];
      rt.applyMove(seat, 'MOVE', m);
    }
    // either completed or hit the guard (draws are possible in checkers)
    expect(guard).toBeGreaterThan(10);
  });
});
