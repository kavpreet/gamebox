import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove } from '@gamebox/core-engine';
import { monopoly, rentFor, BOARD, type MonopolyPublic } from '@gamebox/game-monopoly';

function newGame(seed = 1, players = 3) {
  const seats = Array.from({ length: players }, (_, i) => ({ seat: i }));
  return GameRuntime.start(monopoly, seats, seed);
}

function pubOf(rt: GameRuntime): MonopolyPublic {
  return (rt as any).state.public as MonopolyPublic;
}

describe('monopoly board', () => {
  it('has 40 spaces, 22 streets, 4 railroads, 2 utilities', () => {
    expect(BOARD).toHaveLength(40);
    expect(BOARD.filter((s) => s.type === 'street')).toHaveLength(22);
    expect(BOARD.filter((s) => s.type === 'railroad')).toHaveLength(4);
    expect(BOARD.filter((s) => s.type === 'utility')).toHaveLength(2);
  });
});

describe('monopoly rent', () => {
  it('doubles base rent on a full group and uses house table', () => {
    const rt = newGame();
    const pub = pubOf(rt);
    // brown group = positions 1, 3
    pub.properties[1] = { owner: 0, houses: 0, mortgaged: false };
    expect(rentFor(pub, 1, 7)).toBe(2); // partial group → base
    pub.properties[3] = { owner: 0, houses: 0, mortgaged: false };
    expect(rentFor(pub, 1, 7)).toBe(4); // full group → double
    pub.properties[1]!.houses = 3;
    expect(rentFor(pub, 1, 7)).toBe(90);
  });

  it('railroad rent scales 25/50/100/200 and utilities use dice', () => {
    const rt = newGame();
    const pub = pubOf(rt);
    pub.properties[5] = { owner: 0, houses: 0, mortgaged: false };
    expect(rentFor(pub, 5, 7)).toBe(25);
    pub.properties[15] = { owner: 0, houses: 0, mortgaged: false };
    pub.properties[25] = { owner: 0, houses: 0, mortgaged: false };
    expect(rentFor(pub, 5, 7)).toBe(100); // 3 railroads
    pub.properties[12] = { owner: 1, houses: 0, mortgaged: false };
    expect(rentFor(pub, 12, 7)).toBe(28); // one utility → 4× dice
  });

  it('mortgaged property charges no rent', () => {
    const rt = newGame();
    const pub = pubOf(rt);
    pub.properties[1] = { owner: 0, houses: 0, mortgaged: true };
    expect(rentFor(pub, 1, 7)).toBe(0);
  });
});

describe('monopoly gameplay', () => {
  it('buying pays the bank and takes ownership', () => {
    const rt = newGame(1, 2);
    const pub = pubOf(rt);
    const seat = pub.order[pub.turnIndex]!;
    pub.phase = 'ACT';
    pub.pendingBuy = 39; // Boardwalk, $400
    rt.applyMove(seat, 'BUY', {});
    expect(pub.properties[39]).toMatchObject({ owner: seat, houses: 0 });
    expect(pub.players[seat]!.cash).toBe(1100);
  });

  it('declining sends the property to a sealed-bid auction with all seats active', () => {
    const rt = newGame(2, 3);
    const pub = pubOf(rt);
    const seat = pub.order[pub.turnIndex]!;
    pub.phase = 'ACT';
    pub.pendingBuy = 1;
    rt.applyMove(seat, 'DECLINE_BUY', {});
    expect(pub.phase).toBe('AUCTION');
    expect(rt.activeSeats().sort()).toEqual([0, 1, 2]); // multi-active!
    rt.applyMove(0, 'BID', { amount: 50 });
    rt.applyMove(1, 'BID', { amount: 80 });
    expect(rt.activeSeats()).toEqual([2]);
    rt.applyMove(2, 'BID', { amount: 80 }); // tie → lower seat wins
    expect(pub.properties[1]!.owner).toBe(1);
    expect(pub.players[1]!.cash).toBe(1500 - 80);
    expect(pub.phase).toBe('ACT');
  });

  it('enforces even building on a full group', () => {
    const rt = newGame(3, 2);
    const pub = pubOf(rt);
    const seat = pub.order[pub.turnIndex]!;
    pub.phase = 'ACT';
    pub.properties[1] = { owner: seat, houses: 0, mortgaged: false };
    pub.properties[3] = { owner: seat, houses: 0, mortgaged: false };
    rt.applyMove(seat, 'BUILD', { position: 1 });
    expect(pubOf(rt).properties[1]!.houses).toBe(1);
    // second house on same street before evening out → illegal
    expect(() => rt.applyMove(seat, 'BUILD', { position: 1 })).toThrow(IllegalMove);
    rt.applyMove(seat, 'BUILD', { position: 3 });
    rt.applyMove(seat, 'BUILD', { position: 1 });
    expect(pubOf(rt).properties[1]!.houses).toBe(2);
  });

  it('trade: propose exact swap, target becomes active, accept executes', () => {
    const rt = newGame(4, 2);
    const pub = pubOf(rt);
    const a = pub.order[pub.turnIndex]!;
    const b = a === 0 ? 1 : 0;
    pub.phase = 'ACT';
    pub.properties[5] = { owner: a, houses: 0, mortgaged: false };
    pub.properties[15] = { owner: b, houses: 0, mortgaged: false };
    rt.applyMove(a, 'PROPOSE_TRADE', { to: b, giveProps: [5], giveCash: 100, getProps: [15], getCash: 0 });
    expect(rt.activeSeats()).toEqual([b]);
    rt.applyMove(b, 'RESPOND_TRADE', { accept: true });
    expect(pub.properties[5]!.owner).toBe(b);
    expect(pub.properties[15]!.owner).toBe(a);
    expect(pub.players[a]!.cash).toBe(1400);
    expect(pub.players[b]!.cash).toBe(1600);
  });

  it('debt → bankruptcy hands assets to the creditor and ends a 2p game', () => {
    const rt = newGame(5, 2);
    const pub = pubOf(rt);
    const a = pub.order[pub.turnIndex]!;
    const b = a === 0 ? 1 : 0;
    pub.players[a]!.cash = 10;
    pub.properties[1] = { owner: a, houses: 0, mortgaged: false };
    // simulate landing rent debt via charge path: set up debt state directly through a tax landing
    pub.phase = 'DEBT';
    pub.debt = { seat: a, amount: 500, creditor: b };
    expect(rt.activeSeats()).toEqual([a]);
    rt.applyMove(a, 'DECLARE_BANKRUPTCY', {});
    expect(pub.players[a]!.bankrupt).toBe(true);
    expect(pub.properties[1]!.owner).toBe(b);
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([b]);
  });

  it('random playout stays legal for hundreds of moves', () => {
    const rt = newGame(11, 3);
    let guard = 0;
    while (rt.currentStatus === 'active' && guard++ < 800) {
      const actives = rt.activeSeats();
      if (actives.length === 0) break;
      const seat = actives[Math.floor(Math.random() * actives.length)]!;
      const moves = rt.legalMoves(seat) as any[];
      expect(moves.length).toBeGreaterThan(0);
      const move = moves[Math.floor(Math.random() * moves.length)];
      if (move.kind === 'BID') {
        const cash = pubOf(rt).players[seat]!.cash;
        rt.applyMove(seat, 'BID', { amount: Math.min(cash, Math.floor(Math.random() * 100)) });
      } else {
        rt.applyMove(seat, move.kind, move);
      }
    }
    expect(guard).toBeGreaterThan(50);
  });
});
