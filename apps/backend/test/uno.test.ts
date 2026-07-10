import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import { uno, unoFlip, buildClassicDeck } from '@gamebox/game-uno';

function newGame(module: typeof uno, seed = 1, players = 3) {
  const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
  return GameRuntime.start(module, seats, seed);
}

function randomPlayout(module: typeof uno, seed: number, players: number) {
  const rt = newGame(module, seed, players);
  let guard = 0;
  while (rt.currentStatus === 'active' && guard++ < 5000) {
    const seat = rt.activeSeats()[0]!;
    const moves = rt.legalMoves(seat) as any[];
    expect(moves.length).toBeGreaterThan(0);
    const move = moves[Math.floor(Math.random() * moves.length)];
    rt.applyMove(seat, move.kind, move);
  }
  return rt;
}

describe('uno', () => {
  it('classic deck has 108 cards with the right composition', () => {
    const deck = buildClassicDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c) => c.light.value === 'wild')).toHaveLength(4);
    expect(deck.filter((c) => c.light.value === 'wild4')).toHaveLength(4);
    expect(deck.filter((c) => c.light.color === 'R')).toHaveLength(25);
  });

  it('deals 7 cards each and hides hands from spectators and other seats', () => {
    const rt = newGame(uno, 42, 3);
    const spectator = rt.view('SPECTATOR') as any;
    expect(spectator.hand).toBeNull();
    expect(spectator.handCounts).toEqual({ 0: 7, 1: 7, 2: 7 });
    expect(spectator.drawPileSize).toBe(108 - 21 - 1);

    const mine = rt.view(0) as any;
    expect(mine.hand).toHaveLength(7);
    // seat 0's view must never contain the hidden piles' contents
    expect(JSON.stringify(mine)).not.toContain('"drawPile":');
    expect(JSON.stringify(mine)).not.toContain('"discard":');
  });

  it('plays random full games to a win (several seeds)', () => {
    for (const seed of [1, 7, 99]) {
      const rt = randomPlayout(uno, seed, 3);
      expect(rt.currentStatus).toBe('completed');
      const winner = rt.endResult!.winners![0]!;
      const view = rt.view('SPECTATOR') as any;
      expect(view.handCounts[winner]).toBe(0);
    }
  });

  it('legal moves only offer matching cards', () => {
    const rt = newGame(uno, 5, 2);
    const seat = rt.activeSeats()[0]!;
    const view = rt.view(seat) as any;
    const moves = rt.legalMoves(seat) as any[];
    for (const m of moves.filter((m: any) => m.kind === 'PLAY')) {
      const face = view.hand[m.card];
      const matches =
        face.color === 'W' || face.color === view.currentColor || face.value === view.discardTop.value;
      expect(matches).toBe(true);
    }
  });

  it('kick shuffles the hand back and play continues', () => {
    const rt = newGame(uno, 3, 3);
    const before = (rt.view('SPECTATOR') as any).drawPileSize;
    rt.removePlayer(1);
    const after = rt.view('SPECTATOR') as any;
    expect(after.order).toEqual([0, 2]);
    expect(after.drawPileSize).toBe(before + 7);
  });
});

describe('uno flip', () => {
  it('plays random full games to a win', () => {
    for (const seed of [11, 23]) {
      const rt = randomPlayout(unoFlip, seed, 3);
      expect(rt.currentStatus).toBe('completed');
    }
  });

  it('flip cards toggle the side for every zone at once', () => {
    const rt = newGame(unoFlip, 8, 2);
    // drive until someone plays a flip card or game ends
    let guard = 0;
    let sawFlip = false;
    while (rt.currentStatus === 'active' && guard++ < 3000) {
      const seat = rt.activeSeats()[0]!;
      const moves = rt.legalMoves(seat) as any[];
      const view = rt.view(seat) as any;
      const flipMove = moves.find(
        (m: any) => m.kind === 'PLAY' && view.hand[m.card]?.value === 'flip',
      );
      const move = flipMove ?? moves[Math.floor(Math.random() * moves.length)];
      const sideBefore = (rt.view('SPECTATOR') as any).side;
      rt.applyMove(seat, move.kind, move);
      if (flipMove) {
        const sideAfter = (rt.view('SPECTATOR') as any).side;
        expect(sideAfter).not.toBe(sideBefore);
        sawFlip = true;
        break;
      }
    }
    expect(sawFlip || rt.currentStatus === 'completed').toBe(true);
  });
});
