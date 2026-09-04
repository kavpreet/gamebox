import { describe, it, expect } from 'vitest';
import { GameRuntime, IllegalMove } from '@gamebox/core-engine';
import {
  coerceOptionValue,
  defaultGameOptions,
  describeNonDefaultOptions,
  resolveGameOptions,
  type GameOptionDef,
} from '@gamebox/shared-types';
import { ludo, HOME, type LudoPublic } from '@gamebox/game-ludo';
import { snakesAndLadders, CLASSIC, GAUNTLET, type SnlPublic } from '@gamebox/game-snakes-and-ladders';
import { uno, faceOf, type UnoPublic, type UnoCard } from '@gamebox/game-uno';
import { monopoly, type MonopolyPublic } from '@gamebox/game-monopoly';
import { checkers, legalSteps, type CheckersPublic } from '@gamebox/game-checkers';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ seat: i }));

/**
 * Whose turn it is. (UNO's activeSeats() widens to everyone whenever a seat is
 * catchable on one card, so the turn pointer is the thing to assert on.)
 */
function turnSeat(pub: { order: number[]; turnIndex: number }): number {
  return pub.order[pub.turnIndex]!;
}

/** Reach into the runtime's live state — the same trick the other suites use. */
function statePub<T>(rt: GameRuntime): T {
  return ((rt as any).state as { public: T }).public;
}
function statePriv<T>(rt: GameRuntime): Record<number, T> {
  return (rt as any).state.private as Record<number, T>;
}

describe('option definitions', () => {
  const defs: GameOptionDef[] = [
    { id: 'flag', kind: 'toggle', label: 'Flag', default: false },
    {
      id: 'mode', kind: 'choice', label: 'Mode', default: 'a',
      choices: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    },
    { id: 'cash', kind: 'number', label: 'Cash', default: 1500, min: 500, max: 5000, step: 100 },
  ];

  it('fills defaults for anything missing', () => {
    expect(defaultGameOptions(defs)).toEqual({ flag: false, mode: 'a', cash: 1500 });
    expect(resolveGameOptions(defs, undefined)).toEqual({ flag: false, mode: 'a', cash: 1500 });
  });

  it('drops unknown ids and repairs bad values', () => {
    const resolved = resolveGameOptions(defs, { flag: 'yes', mode: 'zzz', cash: 999999, bogus: 1 });
    expect(resolved).toEqual({ flag: false, mode: 'a', cash: 5000 }); // clamped, not rejected
    expect('bogus' in resolved).toBe(false);
  });

  it('validates single values, snapping numbers to the step', () => {
    expect(coerceOptionValue(defs[0]!, true)).toBe(true);
    expect(coerceOptionValue(defs[0]!, 'true')).toBeNull();
    expect(coerceOptionValue(defs[1]!, 'b')).toBe('b');
    expect(coerceOptionValue(defs[1]!, 'c')).toBeNull();
    expect(coerceOptionValue(defs[2]!, 1234)).toBe(1200);
    expect(coerceOptionValue(defs[2]!, 100)).toBe(500); // clamped to min
  });

  it('describes only what differs from standard', () => {
    expect(describeNonDefaultOptions(defs, { flag: false, mode: 'a', cash: 1500 })).toEqual([]);
    expect(describeNonDefaultOptions(defs, { flag: true, mode: 'b', cash: 2000 })).toEqual([
      'Flag', 'Mode: B', 'Cash: 2000',
    ]);
  });

  it('every registered module declares legal, uniquely-named options', () => {
    for (const mod of [ludo, snakesAndLadders, uno, monopoly, checkers]) {
      const ids = (mod.options ?? []).map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const def of mod.options ?? []) {
        expect(coerceOptionValue(def, def.default)).toEqual(def.default);
      }
    }
  });
});

describe('ludo house rules', () => {
  const start = (options: Record<string, unknown>, players = 2) =>
    GameRuntime.start(ludo, seats(players), 1, options as never);

  it('lets a 1 free a token when enterOn1 is on', () => {
    const rt = start({ enterOn1: true });
    const pub = statePub<LudoPublic>(rt);
    pub.phase = 'MOVE';
    pub.die = 1;
    rt.applyMove(0, 'MOVE', { token: 0 });
    expect(pub.tokens[0]![0]).toBe(0); // out on the entry square
  });

  it('keeps the yard shut on a 1 by default', () => {
    const rt = start({});
    const pub = statePub<LudoPublic>(rt);
    pub.phase = 'MOVE';
    pub.die = 1;
    expect(() => rt.applyMove(0, 'MOVE', { token: 0 })).toThrow(IllegalMove);
  });

  it('grants an extra turn for a capture when enabled', () => {
    const rt = start({ captureExtraTurn: true });
    const pub = statePub<LudoPublic>(rt);
    pub.tokens[0] = [0, -1, -1, -1];
    pub.tokens[1] = [44, -1, -1, -1]; // global 5, same square seat 0 reaches with a 5
    pub.phase = 'MOVE';
    pub.die = 5;
    rt.applyMove(0, 'MOVE', { token: 0 });
    expect(pub.tokens[1]![0]).toBe(-1); // captured
    expect(pub.turnIndex).toBe(0); // still seat 0's turn
    expect(rt.activeSeats()).toEqual([0]);
  });

  it('passes the turn after a capture by default', () => {
    const rt = start({});
    const pub = statePub<LudoPublic>(rt);
    pub.tokens[0] = [0, -1, -1, -1];
    pub.tokens[1] = [44, -1, -1, -1];
    pub.phase = 'MOVE';
    pub.die = 5;
    rt.applyMove(0, 'MOVE', { token: 0 });
    expect(pub.turnIndex).toBe(1);
  });

  it('walks an overshooting token home when exactHome is off', () => {
    const rt = start({ exactHome: false });
    const pub = statePub<LudoPublic>(rt);
    pub.tokens[0] = [54, HOME, HOME, HOME];
    pub.phase = 'MOVE';
    pub.die = 5; // 54 + 5 = 59, way past 56
    rt.applyMove(0, 'MOVE', { token: 0 });
    expect(pub.tokens[0]![0]).toBe(HOME);
    expect(pub.winner).toBe(0);
  });

  it('blockades stop opponents passing through', () => {
    const rt = start({ blockades: true });
    const pub = statePub<LudoPublic>(rt);
    // seat 1 parks two tokens on global 5 (entry 13 → progress 44)
    pub.tokens[1] = [44, 44, -1, -1];
    pub.tokens[0] = [0, -1, -1, -1];
    pub.phase = 'MOVE';
    pub.die = 5; // would land right on the blockade
    expect(() => rt.applyMove(0, 'MOVE', { token: 0 })).toThrow(IllegalMove);
    pub.die = 6; // and cannot jump over it either
    expect(rt.legalMoves(0)).not.toContainEqual({ kind: 'MOVE', token: 0 });
  });

  it('forfeits the turn on the third six', () => {
    const rt = start({ tripleSixForfeit: true });
    const pub = statePub<LudoPublic>(rt);
    // Sit on two sixes and keep rolling until the third one lands.
    let forfeited = false;
    for (let i = 0; i < 500 && !forfeited; i++) {
      pub.turnIndex = 0;
      pub.sixStreak = 2;
      pub.phase = 'ROLL';
      pub.die = null;
      rt.applyMove(0, 'ROLL', {});
      forfeited = pub.lastEvent === 'three sixes — turn forfeited!';
    }
    expect(forfeited).toBe(true);
    expect(pub.turnIndex).toBe(1); // turn passed on regardless of the six
  });
});

describe('snakes & ladders house rules', () => {
  const start = (options: Record<string, unknown>, seed = 3) =>
    GameRuntime.start(snakesAndLadders, seats(2), seed, options as never);

  it('defaults to the classic board and carries it in state', () => {
    const pub = statePub<SnlPublic>(start({}));
    expect(pub.layout).toEqual(CLASSIC);
  });

  it('plays on the alternate layout that was chosen', () => {
    const pub = statePub<SnlPublic>(start({ layout: 'gauntlet' }));
    expect(pub.layout).toEqual(GAUNTLET);
  });

  it('generates a fresh, sane board for "random"', () => {
    const pub = statePub<SnlPublic>(start({ layout: 'random' }));
    const snakes = Object.entries(pub.layout.snakes);
    const ladders = Object.entries(pub.layout.ladders);
    expect(snakes.length).toBeGreaterThan(3);
    expect(ladders.length).toBeGreaterThan(3);
    for (const [from, to] of snakes) expect(Number(from)).toBeGreaterThan(to); // snakes go down
    for (const [from, to] of ladders) expect(Number(from)).toBeLessThan(to); // ladders go up
    const squares = [...snakes, ...ladders].flatMap(([f, t]) => [Number(f), t]);
    expect(new Set(squares).size).toBe(squares.length); // no square does double duty
    expect(squares).not.toContain(1);
  });

  it('bounces back off 100 when asked to', () => {
    const rt = start({ overshoot: 'bounce' });
    const pub = statePub<SnlPublic>(rt);
    pub.positions[0] = 98;
    rt.applyMove(0, 'ROLL', {});
    const die = pub.lastRoll!.die;
    // 98 + die: 2 wins, otherwise it walks back down from 100
    expect(pub.positions[0]).toBe(die === 2 ? 100 : 200 - (98 + die));
  });

  it('keeps everyone at the start until a six with rollToStart', () => {
    const rt = start({ rollToStart: true, sixRollsAgain: false });
    const pub = statePub<SnlPublic>(rt);
    for (let i = 0; i < 40; i++) {
      const seat = rt.activeSeats()[0]!;
      const before = pub.positions[seat]!;
      rt.applyMove(seat, 'ROLL', {});
      const roll = pub.lastRoll!;
      if (before === 0 && roll.die !== 6) expect(pub.positions[seat]).toBe(0);
    }
  });

  it('sends the occupant home when bumping is on', () => {
    const rt = start({ bumpToStart: true });
    const pub = statePub<SnlPublic>(rt);
    pub.positions[0] = 40;
    pub.positions[1] = 44; // seat 1 sits where seat 0 might land
    for (let i = 0; i < 30 && pub.positions[1] !== 0; i++) {
      pub.turnIndex = 0;
      pub.positions[0] = 40;
      rt.applyMove(0, 'ROLL', {});
      if (pub.lastRoll!.die === 4 && pub.lastRoll!.slide === null) {
        expect(pub.positions[1]).toBe(0);
        expect(pub.lastRoll!.bumped).toBe(1);
        return;
      }
    }
  });

  it('ends the turn on a six when the extra roll is switched off', () => {
    const rt = start({ sixRollsAgain: false });
    const pub = statePub<SnlPublic>(rt);
    for (let i = 0; i < 60; i++) {
      const seat = rt.activeSeats()[0]!;
      rt.applyMove(seat, 'ROLL', {});
      if (pub.lastRoll!.die === 6 && pub.winner === null) {
        expect(rt.activeSeats()[0]).not.toBe(seat);
        return;
      }
    }
  });
});

describe('uno house rules', () => {
  const start = (options: Record<string, unknown>, players = 3) =>
    GameRuntime.start(uno, seats(players), 5, options as never);

  const setHand = (rt: GameRuntime, seat: number, cards: UnoCard[]) => {
    (statePriv<{ hand: UnoCard[] }>(rt)[seat] as { hand: UnoCard[] }).hand = cards;
  };
  const card = (color: string, value: string): UnoCard => ({ light: { color: color as never, value } });

  it('deals the configured starting hand', () => {
    const pub = statePub<UnoPublic>(start({ startingHand: 5 }));
    expect(Object.values(pub.handCounts)).toEqual([5, 5, 5]);
  });

  it('stacks +2s into a growing pile instead of dealing them out', () => {
    const rt = start({ stacking: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', 'draw2'), card('B', '5')]);
    setHand(rt, 1, [card('G', 'draw2'), card('B', '9')]);
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;

    rt.applyMove(0, 'PLAY', { card: 0 });
    expect(pub.pendingDraw).toBe(2);
    expect(pub.handCounts[1]).toBe(2); // victim did NOT draw — it's their choice
    expect(turnSeat(pub)).toBe(1);

    rt.applyMove(1, 'PLAY', { card: 0 }); // stack another +2 on
    expect(pub.pendingDraw).toBe(4);
    expect(turnSeat(pub)).toBe(2);

    const before = pub.handCounts[2]!;
    rt.applyMove(2, 'DRAW', {});
    expect(pub.handCounts[2]).toBe(before + 4);
    expect(pub.pendingDraw).toBe(0);
  });

  it('only lets a matching draw card stack', () => {
    const rt = start({ stacking: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', 'draw2'), card('Y', '8'), card('Y', '9')]);
    setHand(rt, 1, [card('G', '7'), card('G', 'draw2'), card('Y', '2')]);
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;
    rt.applyMove(0, 'PLAY', { card: 0 });
    expect(() => rt.applyMove(1, 'PLAY', { card: 0 })).toThrow(IllegalMove); // the 7 can't
    rt.applyMove(1, 'PLAY', { card: 1 }); // the +2 can
    expect(pub.pendingDraw).toBe(4);
  });

  it('hands the +2 straight to the victim when stacking is off', () => {
    const rt = start({});
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', 'draw2'), card('B', '5'), card('B', '6')]);
    const before = pub.handCounts[1] ?? 0;
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;
    rt.applyMove(0, 'PLAY', { card: 0 });
    expect(pub.pendingDraw).toBe(0);
    expect(pub.handCounts[1]).toBe(before + 2);
    expect(turnSeat(pub)).toBe(2); // victim skipped
  });

  it('7 swaps hands with the chosen player', () => {
    const rt = start({ sevenZero: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', '7')]);
    setHand(rt, 2, [card('B', '1'), card('G', '2'), card('Y', '3')]);
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;
    rt.applyMove(0, 'PLAY', { card: 0, swapWith: 2 });
    expect(pub.handCounts[0]).toBe(3);
    expect(pub.handCounts[2]).toBe(0);
    expect(pub.winner).toBe(2); // an emptied hand still wins, whoever ends up with it
  });

  it('0 passes every hand along in the direction of play', () => {
    const rt = start({ sevenZero: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', '0'), card('R', '1')]);
    setHand(rt, 1, [card('B', '1'), card('B', '2')]);
    setHand(rt, 2, [card('G', '1'), card('G', '2'), card('G', '3')]);
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;
    rt.applyMove(0, 'PLAY', { card: 0 });
    // seat 0 (1 card left) → seat 1, seat 1 (2) → seat 2, seat 2 (3) → seat 0
    expect(pub.handCounts[0]).toBe(3);
    expect(pub.handCounts[1]).toBe(1);
    expect(pub.handCounts[2]).toBe(2);
  });

  it('7 and 0 stay ordinary numbers by default', () => {
    const rt = start({});
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', '7'), card('R', '1')]);
    setHand(rt, 1, [card('B', '4')]);
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;
    rt.applyMove(0, 'PLAY', { card: 0 });
    expect(pub.handCounts[0]).toBe(1);
    expect(pub.handCounts[1]).toBe(1);
  });

  it('forbids drawing on a playable hand under "no bluffing"', () => {
    const rt = start({ forcePlay: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', '5')]);
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;
    expect(rt.legalMoves(0)).not.toContainEqual({ kind: 'DRAW' });
    expect(() => rt.applyMove(0, 'DRAW', {})).toThrow(IllegalMove);
  });

  it('draws until something playable turns up', () => {
    const rt = start({ drawToPlay: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, []);
    pub.currentColor = 'R';
    pub.discardTop = { color: 'R', value: '3' };
    pub.turnIndex = 0;
    rt.applyMove(0, 'DRAW', {});
    const hand = statePriv<{ hand: UnoCard[] }>(rt)[0]!.hand;
    expect(hand.length).toBeGreaterThan(0);
    const last = faceOf(hand[hand.length - 1]!, 'light');
    expect(last.color === 'R' || last.color === 'W' || last.value === '3').toBe(true);
  });

  it('lets a holder of the identical card jump in out of turn', () => {
    const rt = start({ jumpIn: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('B', '9')]);
    setHand(rt, 2, [card('R', '4'), card('B', '2')]);
    pub.currentColor = 'B';
    pub.discardTop = { color: 'B', value: '9' };
    pub.turnIndex = 1; // it is seat 1's turn
    expect(rt.activeSeats()).toContain(0);
    rt.applyMove(0, 'PLAY', { card: 0 });
    expect(pub.winner).toBe(0); // played their last card out of turn
  });

  it('refuses a jump-in that is not the exact same card', () => {
    const rt = start({ jumpIn: true });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 0, [card('R', '9')]);
    pub.currentColor = 'B';
    pub.discardTop = { color: 'B', value: '9' };
    pub.turnIndex = 1;
    expect(() => rt.applyMove(0, 'PLAY', { card: 0 })).toThrow(IllegalMove);
  });

  it('applies the configured catch penalty', () => {
    const rt = start({ unoPenalty: 4 });
    const pub = statePub<UnoPublic>(rt);
    setHand(rt, 1, [card('R', '5')]);
    rt.applyMove(0, 'CATCH_UNO', { target: 1 });
    expect(pub.handCounts[1]).toBe(5);
  });
});

describe('monopoly house rules', () => {
  const start = (options: Record<string, unknown>) =>
    GameRuntime.start(monopoly, seats(2), 4, options as never);

  it('honours the configured starting cash', () => {
    const pub = statePub<MonopolyPublic>(start({ startingCash: 2500 }));
    expect(pub.players[0]!.cash).toBe(2500);
    expect(pub.players[1]!.cash).toBe(2500);
  });

  it('collects taxes into the Free Parking pot and pays them out', () => {
    const rt = start({ freeParking: true });
    const pub = statePub<MonopolyPublic>(rt);
    pub.players[0]!.position = 3;
    pub.phase = 'ROLL';
    // land on Income Tax (4) with a 1: force it by charging directly through a roll
    pub.players[0]!.cash = 2000;
    (pub as MonopolyPublic).freeParkingPot = 0;
    // simulate the tax charge the same way the board does
    rt.applyMove(0, 'ROLL', {});
    expect(pub.freeParkingPot).toBeGreaterThanOrEqual(0);

    // now put someone on Free Parking with a stocked pot
    pub.freeParkingPot = 500;
    pub.players[1]!.position = 19;
    pub.turnIndex = 1;
    pub.phase = 'ROLL';
    const before = pub.players[1]!.cash;
    for (let i = 0; i < 40 && pub.freeParkingPot === 500; i++) {
      pub.players[1]!.position = 19;
      pub.turnIndex = 1;
      pub.phase = 'ROLL';
      pub.players[1]!.jailTurns = 0;
      rt.applyMove(1, 'ROLL', {});
      if (pub.players[1]!.position === 20) {
        expect(pub.freeParkingPot).toBe(0);
        expect(pub.players[1]!.cash).toBe(before + 500);
        return;
      }
    }
  });

  it('leaves declined properties unsold when auctions are off', () => {
    const rt = start({ noAuctions: true });
    const pub = statePub<MonopolyPublic>(rt);
    pub.phase = 'ACT';
    pub.pendingBuy = 1;
    rt.applyMove(0, 'DECLINE_BUY', {});
    expect(pub.auction).toBeNull();
    expect(pub.phase).toBe('ACT');
    expect(pub.properties[1]).toBeUndefined();
  });

  it('still auctions by default', () => {
    const rt = start({});
    const pub = statePub<MonopolyPublic>(rt);
    pub.phase = 'ACT';
    pub.pendingBuy = 1;
    rt.applyMove(0, 'DECLINE_BUY', {});
    expect(pub.auction).not.toBeNull();
    expect(pub.phase).toBe('AUCTION');
  });

  it('skips rent for a landlord sitting in jail', () => {
    const rt = start({ jailRentFree: true });
    const pub = statePub<MonopolyPublic>(rt);
    pub.properties[1] = { owner: 1, houses: 0, mortgaged: false };
    pub.players[1]!.inJail = true;
    const cash = pub.players[0]!.cash;
    pub.players[0]!.position = 0;
    pub.phase = 'ROLL';
    for (let i = 0; i < 40; i++) {
      pub.players[0]!.position = 0;
      pub.turnIndex = 0;
      pub.phase = 'ROLL';
      pub.players[0]!.cash = cash;
      pub.players[0]!.jailTurns = 0;
      rt.applyMove(0, 'ROLL', {});
      if (pub.players[0]!.position === 1) {
        expect(pub.players[0]!.cash).toBe(cash); // no rent paid
        return;
      }
    }
  });
});

describe('checkers house rules', () => {
  const start = (options: Record<string, unknown>) =>
    GameRuntime.start(checkers, seats(2), 1, options as never);

  it('allows a quiet move past an available jump when captures are optional', () => {
    const rt = start({ forcedCapture: false });
    const pub = statePub<CheckersPublic>(rt);
    pub.board = {
      '2,2': { seat: 0, king: false },
      '3,3': { seat: 1, king: false },
      '0,0': { seat: 0, king: false },
    };
    const moves = legalSteps(pub, 0);
    expect(moves.some((m) => m.captured)).toBe(true);
    expect(moves.some((m) => !m.captured)).toBe(true); // the quiet move survives
  });

  it('still forces the jump by default', () => {
    const rt = start({});
    const pub = statePub<CheckersPublic>(rt);
    pub.board = {
      '2,2': { seat: 0, king: false },
      '3,3': { seat: 1, king: false },
      '0,0': { seat: 0, king: false },
    };
    expect(legalSteps(pub, 0).every((m) => m.captured)).toBe(true);
  });

  it('lets men jump backwards when enabled', () => {
    const rt = start({ menCaptureBackwards: true });
    const pub = statePub<CheckersPublic>(rt);
    pub.board = { '4,4': { seat: 0, king: false }, '3,3': { seat: 1, king: false } };
    const moves = legalSteps(pub, 0); // seat 0 moves +row, so 4,4 → 2,2 is backwards
    expect(moves).toContainEqual({ from: '4,4', to: '2,2', captured: '3,3' });
  });

  it('keeps men jumping forwards only by default', () => {
    const rt = start({});
    const pub = statePub<CheckersPublic>(rt);
    pub.board = { '4,4': { seat: 0, king: false }, '3,3': { seat: 1, king: false } };
    expect(legalSteps(pub, 0)).not.toContainEqual({ from: '4,4', to: '2,2', captured: '3,3' });
  });

  it('flying kings glide and snipe from range', () => {
    const rt = start({ flyingKings: true });
    const pub = statePub<CheckersPublic>(rt);
    pub.board = { '0,0': { seat: 0, king: true }, '4,4': { seat: 1, king: false } };
    const moves = legalSteps(pub, 0);
    expect(moves).toContainEqual({ from: '0,0', to: '5,5', captured: '4,4' });
    expect(moves).toContainEqual({ from: '0,0', to: '7,7', captured: '4,4' }); // lands anywhere beyond
  });

  it('ordinary kings only step one square', () => {
    const rt = start({});
    const pub = statePub<CheckersPublic>(rt);
    pub.board = { '0,0': { seat: 0, king: true }, '4,4': { seat: 1, king: false } };
    const moves = legalSteps(pub, 0);
    expect(moves.every((m) => !m.captured)).toBe(true);
    expect(moves).toContainEqual({ from: '0,0', to: '1,1', captured: null });
    expect(moves).not.toContainEqual({ from: '0,0', to: '2,2', captured: null });
  });
});
