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
  while (rt.currentStatus === 'active' && guard++ < 20000) {
    const seat = rt.activeSeats()[0]!;
    const moves = rt.legalMoves(seat) as any[];
    expect(moves.length).toBeGreaterThan(0);
    // bias toward playing cards so games terminate even on pathological seeds
    const plays = moves.filter((m: any) => m.kind === 'PLAY');
    const move =
      plays.length > 0 && Math.random() < 0.85
        ? plays[Math.floor(Math.random() * plays.length)]
        : moves[Math.floor(Math.random() * moves.length)];
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

  it('an undeclared one-card player can be caught for 2; declaring UNO makes them safe', () => {
    const rt = newGame(uno, 6, 3);
    const state = (rt as any).state as { public: any; private: Record<number, any> };
    // force seat 1 down to one card
    const hand = state.private[1].hand;
    state.private[0].hand.push(...hand.splice(1)); // keep counts consistent-ish
    state.public.handCounts[1] = 1;
    state.public.handCounts[0] = state.private[0].hand.length;

    // everyone is active while a catch is possible
    expect(rt.activeSeats()).toEqual([0, 1, 2]);
    const catcherMoves = rt.legalMoves(2) as any[];
    expect(catcherMoves.some((m) => m.kind === 'CATCH_UNO' && m.target === 1)).toBe(true);
    expect(rt.legalMoves(1).some((m: any) => m.kind === 'DECLARE_UNO')).toBe(true);

    // catch: seat 1 draws 2 and is no longer catchable
    rt.applyMove(2, 'CATCH_UNO', { target: 1 });
    const view = rt.view('SPECTATOR') as any;
    expect(view.handCounts[1]).toBe(3);
    expect(rt.legalMoves(2).some((m: any) => m.kind === 'CATCH_UNO')).toBe(false);

    // now force seat 2 to one card and let them declare first
    state.private[0].hand.push(...state.private[2].hand.splice(1));
    state.public.handCounts[2] = 1;
    rt.applyMove(2, 'DECLARE_UNO', {});
    expect((rt.view('SPECTATOR') as any).unoDeclared).toContain(2);
    expect(() => rt.applyMove(0, 'CATCH_UNO', { target: 2 })).toThrow(/already called/i);
  });

  it('a stale UNO declaration clears when the hand size changes', () => {
    const rt = newGame(uno, 15, 2);
    const state = (rt as any).state as { public: any; private: Record<number, any> };
    const idle = rt.activeSeats()[0] === 0 ? 1 : 0;
    state.private[0].hand.push(...state.private[idle].hand.splice(1));
    state.public.handCounts[idle] = 1;
    rt.applyMove(idle, 'DECLARE_UNO', {});
    expect((rt.view('SPECTATOR') as any).unoDeclared).toContain(idle);
    // any hand-changing move refreshes counts and drops the stale declaration
    state.private[idle].hand.push(state.private[0].hand.pop());
    const turn = rt.activeSeats()[0]!;
    rt.applyMove(turn, 'DRAW', {});
    expect((rt.view('SPECTATOR') as any).unoDeclared).not.toContain(idle);
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

  it('everyone sees the INACTIVE side of every hand (backsides), never the active side', () => {
    const rt = newGame(unoFlip, 4, 2);
    const spectator = rt.view('SPECTATOR') as any;
    expect(spectator.side).toBe('light');
    expect(spectator.hand).toBeNull();
    expect(spectator.backsides[0]).toHaveLength(7);
    expect(spectator.backsides[1]).toHaveLength(7);

    const mine = rt.view(0) as any;
    expect(mine.hand).toHaveLength(7);
    // my backside row must be the DARK faces of my cards, not my light faces
    const state = (rt as any).state as { private: Record<number, any> };
    const darkFaces = state.private[0].hand.map((c: any) => c.dark);
    expect(mine.backsides[0]).toEqual(darkFaces);
    // classic uno has no backsides
    expect((newGame(uno, 4, 2).view('SPECTATOR') as any).backsides).toBeNull();
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
