import { describe, it, expect } from 'vitest';
import {
  GameRuntime,
  IllegalMove,
  createTakebackVote,
  castTakebackVote,
  isUncontested,
} from '@gamebox/core-engine';
import { DEFAULT_TABLE_OPTIONS, normalizeTableOptions } from '@gamebox/shared-types';
import { snakesAndLadders, type SnlPublic } from '@gamebox/game-snakes-and-ladders';
import { monopoly, type MonopolyPublic } from '@gamebox/game-monopoly';
import { ludo } from '@gamebox/game-ludo';
import { uno, type UnoPublic } from '@gamebox/game-uno';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ seat: i }));

/** Roll until the runtime hands us a seat that is genuinely on the clock. */
function activeSeat(rt: GameRuntime): number {
  const [s] = rt.activeSeats();
  expect(s).toBeDefined();
  return s!;
}

describe('table options', () => {
  it('normalises unknown, missing and out-of-range values', () => {
    expect(normalizeTableOptions(undefined)).toEqual(DEFAULT_TABLE_OPTIONS);
    expect(normalizeTableOptions({ clock: 'nonsense' }).clock).toBe(DEFAULT_TABLE_OPTIONS.clock);
    expect(normalizeTableOptions({ clockSeconds: 5 }).clockSeconds).toBe(15);
    expect(normalizeTableOptions({ clockSeconds: 99999 }).clockSeconds).toBe(600);
    expect(normalizeTableOptions({ speed: 0 }).speed).toBe(0.25);
  });

  it('refuses manual mode for a module that has not implemented it', () => {
    // Ludo narrates but has no hand-played split, so asking for manual must
    // not leave players waiting on a step button that never renders.
    const rt = GameRuntime.start(ludo, seats(2), 7, {}, { manual: true });
    expect(ludo.supportsManual).toBeFalsy();
    expect(rt.tableOptions.manual).toBe(false);
  });

  it('survives a snapshot round-trip', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 11, {}, { manual: true, clockSeconds: 45 });
    const revived = new GameRuntime(monopoly, rt.snapshot());
    expect(revived.tableOptions.manual).toBe(true);
    expect(revived.tableOptions.clockSeconds).toBe(45);
  });

  it('defaults options for a snapshot written before they existed', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 3);
    const legacy = { ...rt.snapshot() };
    delete (legacy as { table?: unknown }).table;
    delete (legacy as { turnStartedAt?: unknown }).turnStartedAt;
    const revived = new GameRuntime(snakesAndLadders, legacy);
    expect(revived.tableOptions).toEqual(DEFAULT_TABLE_OPTIONS);
    expect(revived.clock()).not.toBeNull();
  });
});

describe('beats', () => {
  it('records the steps of a roll in order instead of one overwritten line', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42);
    const res = rt.applyMove(activeSeat(rt), 'ROLL', {});
    expect(res.beats.length).toBeGreaterThan(1);
    expect(res.beats[0]!.kind).toBe('dice');
    // Every beat is displayable on its own.
    for (const b of res.beats) expect(b.text.length).toBeGreaterThan(0);
  });

  it('hands each batch of beats out exactly once', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42);
    rt.applyMove(activeSeat(rt), 'ROLL', {});
    expect(rt.takeBeats().length).toBeGreaterThan(0);
    // A re-broadcast to a client that just joined must not replay the story.
    expect(rt.takeBeats()).toEqual([]);
  });

  it('narrates a monopoly roll as separate dice, move and outcome steps', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5);
    const res = rt.applyMove(activeSeat(rt), 'ROLL', {});
    const kinds = res.beats.map((b) => b.kind);
    expect(kinds[0]).toBe('dice');
    expect(kinds).toContain('move');
    expect(res.beats.length).toBeGreaterThanOrEqual(3);
  });

  it('narrates a system skip', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 9);
    const res = rt.skipSeat(activeSeat(rt));
    expect(res.beats.map((b) => b.kind)).toContain('turn');
  });
});

describe('turn clock', () => {
  it('derives a shared deadline from the configured allowance', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 1, {}, { clock: 'soft', clockSeconds: 60 });
    const clock = rt.clock()!;
    expect(clock.mode).toBe('soft');
    const span = Date.parse(clock.deadline!) - Date.parse(clock.startedAt);
    expect(span).toBe(60_000);
    expect(clock.seats).toEqual(rt.activeSeats());
  });

  it('has no deadline when switched off, and none once the game ends', () => {
    const off = GameRuntime.start(snakesAndLadders, seats(2), 1, {}, { clock: 'off' });
    expect(off.clock()!.deadline).toBeNull();
    off.pause();
    expect(off.clock()).toBeNull();
  });

  it('only reports expiry in hard mode', () => {
    const soft = GameRuntime.start(snakesAndLadders, seats(2), 1, {}, { clock: 'soft', clockSeconds: 30 });
    const hard = GameRuntime.start(snakesAndLadders, seats(2), 1, {}, { clock: 'hard', clockSeconds: 30 });
    const later = Date.now() + 60_000;
    expect(soft.expiredSeats(later)).toEqual([]);
    expect(hard.expiredSeats(later)).toEqual(hard.activeSeats());
    expect(hard.expiredSeats(Date.now())).toEqual([]);
  });

  it('restarts only when the baton actually changes hands', () => {
    // A multi-step manual turn (roll → walk → walk …) is one turn, so it must
    // run on one allowance rather than refreshing at every tap.
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42, {}, { manual: true, clockSeconds: 60 });
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    const afterRoll = rt.clock()!.startedAt;
    const pub = rt.view('SPECTATOR') as SnlPublic;
    if (pub.phase === 'WALK') {
      rt.applyMove(seat, 'STEP', {});
      expect(rt.clock()!.startedAt).toBe(afterRoll);
    }
  });
});

describe('snakes & ladders manual mode', () => {
  it('walks the counter one square at a time, and only as far as the throw', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42, {}, { manual: true });
    const seat = activeSeat(rt);
    const before = (rt.view('SPECTATOR') as SnlPublic).positions[seat]!;

    rt.applyMove(seat, 'ROLL', {});
    let pub = rt.view('SPECTATOR') as SnlPublic;
    // The throw commits a destination but must not move the counter itself.
    expect(pub.positions[seat]).toBe(before);
    expect(pub.phase).toBe('WALK');
    const die = pub.pending!.die;

    for (let i = 0; i < die; i++) {
      pub = rt.view('SPECTATOR') as SnlPublic;
      if (pub.phase !== 'WALK') break;
      rt.applyMove(seat, 'STEP', {});
    }
    pub = rt.view('SPECTATOR') as SnlPublic;
    expect(pub.positions[seat]).toBe(before + die);
    // Having arrived, the walk is over — you cannot keep stepping for free.
    if (pub.phase !== 'WALK') {
      expect(() => rt.applyMove(seat, 'STEP', {})).toThrow(IllegalMove);
    }
  });

  it('rejects stepping before the die is thrown', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 8, {}, { manual: true });
    expect(() => rt.applyMove(activeSeat(rt), 'STEP', {})).toThrow(IllegalMove);
  });

  it('resolves a half-walked turn when the seat is skipped', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42, {}, { manual: true });
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    const pending = (rt.view('SPECTATOR') as SnlPublic).pending!;
    rt.skipSeat(seat);
    const pub = rt.view('SPECTATOR') as SnlPublic;
    expect(pub.pending).toBeNull();
    expect(pub.phase).toBe('ROLL');
    // The counter lands where the throw said, rather than being stranded.
    expect(pub.positions[seat]).toBe(pending.slide ?? pending.to);
  });

  it('plays exactly as before when manual is off', () => {
    const auto = GameRuntime.start(snakesAndLadders, seats(2), 42);
    const seat = activeSeat(auto);
    auto.applyMove(seat, 'ROLL', {});
    const pub = auto.view('SPECTATOR') as SnlPublic;
    expect(pub.phase).toBe('ROLL');
    expect(pub.pending).toBeNull();
    expect(pub.positions[seat]).not.toBe(0);
  });
});

describe('monopoly manual mode', () => {
  /** Walk a manual roll all the way out, returning the resulting public state. */
  function rollAndWalk(rt: GameRuntime, seat: number): MonopolyPublic {
    rt.applyMove(seat, 'ROLL', {});
    for (let guard = 0; guard < 24; guard++) {
      const pub = rt.view('SPECTATOR') as MonopolyPublic;
      if (pub.phase !== 'WALK') return pub;
      rt.applyMove(seat, 'STEP_TOKEN', {});
    }
    throw new Error('walk never finished');
  }

  it('holds the token still until the player walks it', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5, {}, { manual: true });
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    const pub = rt.view('SPECTATOR') as MonopolyPublic;
    expect(pub.phase).toBe('WALK');
    expect(pub.players[seat]!.position).toBe(0);
    expect(pub.pendingWalk!.remaining).toBe(pub.lastRoll!.d1 + pub.lastRoll!.d2);
  });

  it('walks exactly the distance thrown and no further', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5, {}, { manual: true });
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    const total = (() => {
      const p = rt.view('SPECTATOR') as MonopolyPublic;
      return p.lastRoll!.d1 + p.lastRoll!.d2;
    })();
    for (let i = 0; i < total; i++) {
      const pub = rt.view('SPECTATOR') as MonopolyPublic;
      if (pub.phase !== 'WALK') break;
      rt.applyMove(seat, 'STEP_TOKEN', {});
    }
    const pub = rt.view('SPECTATOR') as MonopolyPublic;
    expect(pub.players[seat]!.position).toBe(total % 40);
    expect(pub.pendingWalk).toBeNull();
    expect(() => rt.applyMove(seat, 'STEP_TOKEN', {})).toThrow(IllegalMove);
  });

  it('gates an affordable rent behind an explicit payment', () => {
    // Hand seat 1 every square, then roll seeds until seat 0 lands on one that
    // actually charges rent (some squares are tax, chance, or corners).
    let gated = 0;
    for (let seed = 1; seed <= 40 && gated === 0; seed++) {
      const snap = GameRuntime.start(monopoly, seats(2), seed, {}, { manual: true }).snapshot();
      const pub = snap.state.public as MonopolyPublic;
      for (let pos = 0; pos < 40; pos++) {
        pub.properties[pos] = { owner: 1, houses: 0, mortgaged: false };
      }
      const live = new GameRuntime(monopoly, snap);
      const seat = activeSeat(live);
      const after = rollAndWalk(live, seat);
      if (!after.pendingPayment) continue;

      gated++;
      // Landing on an owned square stops and asks, rather than silently
      // debiting the player as part of somebody else's dice roll.
      expect(after.phase).toBe('PAY');
      const owed = after.pendingPayment.amount;
      const before = after.players[seat]!.cash;
      const creditor = after.pendingPayment.to;
      const creditorBefore = creditor === null ? 0 : after.players[creditor]!.cash;

      live.applyMove(seat, 'PAY', {});
      const settled = live.view('SPECTATOR') as MonopolyPublic;
      expect(settled.players[seat]!.cash).toBe(before - owed);
      if (creditor !== null) expect(settled.players[creditor]!.cash).toBe(creditorBefore + owed);
      expect(settled.pendingPayment).toBeNull();
      expect(settled.phase).toBe('ACT');
      // The charge is settled once — you cannot be billed twice for it.
      expect(() => live.applyMove(seat, 'PAY', {})).toThrow(IllegalMove);
    }
    expect(gated).toBe(1);
  });

  it('rejects paying a charge that is not yours, and paying nothing', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5, {}, { manual: true });
    expect(() => rt.applyMove(activeSeat(rt), 'PAY', {})).toThrow(IllegalMove);
  });

  it('settles a half-finished manual turn when the seat is skipped', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5, {}, { manual: true });
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    rt.skipSeat(seat);
    const pub = rt.view('SPECTATOR') as MonopolyPublic;
    expect(pub.pendingWalk).toBeNull();
    expect(pub.pendingPayment).toBeNull();
    expect(pub.phase).toBe('ROLL');
  });

  it('is untouched when manual is off', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5);
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    const pub = rt.view('SPECTATOR') as MonopolyPublic;
    expect(pub.pendingWalk).toBeNull();
    expect(['ACT', 'DEBT']).toContain(pub.phase);
    expect(pub.players[seat]!.position).toBe(pub.lastRoll!.d1 + pub.lastRoll!.d2);
  });
});

describe('uno call', () => {
  /** Play on until some seat is down to one card, optionally declaring UNO. */
  function playUntilOneCard(rt: GameRuntime, declare: boolean): number | null {
    for (let guard = 0; guard < 400; guard++) {
      const seat = rt.activeSeats()[0];
      if (seat === undefined) return null;
      const legal = rt.legalMoves(seat) as { kind: string; card?: number; chooseColor?: string }[];
      const play = legal.find((m) => m.kind === 'PLAY');
      const hand = (rt.view(seat) as { hand?: unknown[] }).hand ?? [];
      if (play) {
        rt.applyMove(seat, 'PLAY', { card: play.card, chooseColor: play.chooseColor });
        if (hand.length === 2) {
          // The declaration is its own act, exactly as it is at a table.
          if (declare) rt.applyMove(seat, 'DECLARE_UNO', {});
          return seat;
        }
      } else if (legal.some((m) => m.kind === 'DRAW')) {
        rt.applyMove(seat, 'DRAW', {});
      } else if (legal.some((m) => m.kind === 'PASS')) {
        rt.applyMove(seat, 'PASS', {});
      } else {
        return null;
      }
    }
    return null;
  }

  /**
   * Deal until we get a hand where somebody genuinely reaches one card without
   * immediately winning — otherwise the assertions below would pass vacuously.
   */
  function reachOneCard(declare: boolean): { rt: GameRuntime; seat: number } {
    for (let seed = 1; seed <= 80; seed++) {
      const rt = GameRuntime.start(uno, seats(3), seed);
      const seat = playUntilOneCard(rt, declare);
      if (seat === null) continue;
      const pub = rt.view('SPECTATOR') as UnoPublic;
      if (pub.winner !== null || pub.handCounts[seat] !== 1) continue;
      // A skip or reverse can hand the turn straight back; we need somebody
      // *else* on the clock to do the catching.
      const next = rt.activeSeats()[0];
      if (next === undefined || next === seat) continue;
      return { rt, seat };
    }
    throw new Error('no deal reached a one-card state');
  }

  it('leaves a silent player open to being caught, and penalises them', () => {
    const { rt, seat: quiet } = reachOneCard(false);
    const pub = rt.view('SPECTATOR') as UnoPublic;
    expect(pub.handCounts[quiet]).toBe(1);
    expect(pub.unoDeclared).not.toContain(quiet);

    const catcher = rt.activeSeats()[0]!;
    expect(catcher).not.toBe(quiet);
    const before = pub.handCounts[quiet]!;
    rt.applyMove(catcher, 'CATCH_UNO', { target: quiet });
    const after = rt.view('SPECTATOR') as UnoPublic;
    expect(after.handCounts[quiet]).toBeGreaterThan(before);
    // The lapse is spent: nobody gets to catch the same one twice.
    expect(() => rt.applyMove(rt.activeSeats()[0]!, 'CATCH_UNO', { target: quiet })).toThrow(
      IllegalMove,
    );
  });

  it('protects a player who calls it', () => {
    const { rt, seat: caller } = reachOneCard(true);
    const pub = rt.view('SPECTATOR') as UnoPublic;
    expect(pub.handCounts[caller]).toBe(1);
    expect(pub.unoDeclared).toContain(caller);
    const other = rt.activeSeats()[0]!;
    expect(() => rt.applyMove(other, 'CATCH_UNO', { target: caller })).toThrow(IllegalMove);
  });
});
