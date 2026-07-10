import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove } from '@gamebox/core-engine';
import { chess, type ChessPublic } from '@gamebox/game-chess';

function newGame() {
  return GameRuntime.start(chess, [{ seat: 0 }, { seat: 1 }], 1);
}

describe('chess', () => {
  it("scholar's mate ends the game for white", () => {
    const rt = newGame();
    const moves: [number, string, string][] = [
      [0, 'e2', 'e4'], [1, 'e7', 'e5'],
      [0, 'f1', 'c4'], [1, 'b8', 'c6'],
      [0, 'd1', 'h5'], [1, 'g8', 'f6'],
      [0, 'h5', 'f7'],
    ];
    for (const [seat, from, to] of moves) {
      rt.applyMove(seat, 'MOVE', { from, to });
    }
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([0]);
    const view = rt.view('SPECTATOR') as ChessPublic;
    expect(view.resultReason).toBe('checkmate');
  });

  it('rejects illegal moves and out-of-turn play', () => {
    const rt = newGame();
    expect(() => rt.applyMove(0, 'MOVE', { from: 'e2', to: 'e5' })).toThrow(IllegalMove);
    expect(() => rt.applyMove(1, 'MOVE', { from: 'e7', to: 'e5' })).toThrow(IllegalMove);
  });

  it('enumerates 20 legal opening moves for white and 0 for black', () => {
    const rt = newGame();
    expect(rt.legalMoves(0)).toHaveLength(20);
    expect(rt.legalMoves(1)).toHaveLength(0);
  });

  it('kick = resignation', () => {
    const rt = newGame();
    rt.removePlayer(0);
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([1]);
  });

  it('offers no skip option', () => {
    const rt = newGame();
    expect(rt.disconnectOptions()).toEqual(['pause', 'kick']);
  });
});
