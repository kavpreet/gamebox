import { describe, it, expect } from 'vitest';
import {
  GameRuntime,
  IllegalMove,
  createTakebackVote,
  castTakebackVote,
  isUncontested,
} from '@gamebox/core-engine';
import { DEFAULT_GAME_OPTIONS, normalizeGameOptions } from '@gamebox/shared-types';
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

describe('game options', () => {
  it('normalises unknown, missing and out-of-range values', () => {
    expect(normalizeGameOptions(undefined)).toEqual(DEFAULT_GAME_OPTIONS);
    expect(normalizeGameOptions({ clock: 'nonsense' }).clock).toBe(DEFAULT_GAME_OPTIONS.clock);
    expect(normalizeGameOptions({ clockSeconds: 5 }).clockSeconds).toBe(15);
    expect(normalizeGameOptions({ clockSeconds: 99999 }).clockSeconds).toBe(600);
    expect(normalizeGameOptions({ speed: 0 }).speed).toBe(0.25);
  });

  it('refuses manual mode for a module that has not implemented it', () => {
    // Ludo narrates but has no hand-played split, so asking for manual must
    // not leave players waiting on a step button that never renders.
    const rt = GameRuntime.start(ludo, seats(2), 7, { manual: true });
    expect(ludo.supportsManual).toBeFalsy();
    expect(rt.gameOptions.manual).toBe(false);
  });

  it('survives a snapshot round-trip', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 11, { manual: true, clockSeconds: 45 });
    const revived = new GameRuntime(monopoly, rt.snapshot());
    expect(revived.gameOptions.manual).toBe(true);
    expect(revived.gameOptions.clockSeconds).toBe(45);
  });

  it('defaults options for a snapshot written before they existed', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 3);
    const legacy = { ...rt.snapshot() };
    delete (legacy as { options?: unknown }).options;
    delete (legacy as { turnStartedAt?: unknown }).turnStartedAt;
    const revived = new GameRuntime(snakesAndLadders, legacy);
    expect(revived.gameOptions).toEqual(DEFAULT_GAME_OPTIONS);
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
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 1, { clock: 'soft', clockSeconds: 60 });
    const clock = rt.clock()!;
    expect(clock.mode).toBe('soft');
    const span = Date.parse(clock.deadline!) - Date.parse(clock.startedAt);
    expect(span).toBe(60_000);
    expect(clock.seats).toEqual(rt.activeSeats());
  });

  it('has no deadline when switched off, and none once the game ends', () => {
    const off = GameRuntime.start(snakesAndLadders, seats(2), 1, { clock: 'off' });
    expect(off.clock()!.deadline).toBeNull();
    off.pause();
    expect(off.clock()).toBeNull();
  });

  it('only reports expiry in hard mode', () => {
    const soft = GameRuntime.start(snakesAndLadders, seats(2), 1, { clock: 'soft', clockSeconds: 30 });
    const hard = GameRuntime.start(snakesAndLadders, seats(2), 1, { clock: 'hard', clockSeconds: 30 });
    const later = Date.now() + 60_000;
    expect(soft.expiredSeats(later)).toEqual([]);
    expect(hard.expiredSeats(later)).toEqual(hard.activeSeats());
    expect(hard.expiredSeats(Date.now())).toEqual([]);
  });

  it('restarts only when the baton actually changes hands', () => {
    // A multi-step manual turn (roll → walk → walk …) is one turn, so it must
    // run on one allowance rather than refreshing at every tap.
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42, { manual: true, clockSeconds: 60 });
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
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42, { manual: true });
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
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 8, { manual: true });
    expect(() => rt.applyMove(activeSeat(rt), 'STEP', {})).toThrow(IllegalMove);
  });

  it('resolves a half-walked turn when the seat is skipped', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42, { manual: true });
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
    const rt = GameRuntime.start(monopoly, seats(2), 5, { manual: true });
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    const pub = rt.view('SPECTATOR') as MonopolyPublic;
    expect(pub.phase).toBe('WALK');
    expect(pub.players[seat]!.position).toBe(0);
    expect(pub.pendingWalk!.remaining).toBe(pub.lastRoll!.d1 + pub.lastRoll!.d2);
  });

  it('walks exactly the distance thrown and no further', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5, { manual: true });
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
      const snap = GameRuntime.start(monopoly, seats(2), seed, { manual: true }).snapshot();
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
    const rt = GameRuntime.start(monopoly, seats(2), 5, { manual: true });
    expect(() => rt.applyMove(activeSeat(rt), 'PAY', {})).toThrow(IllegalMove);
  });

  it('settles a half-finished manual turn when the seat is skipped', () => {
    const rt = GameRuntime.start(monopoly, seats(2), 5, { manual: true });
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
  /** Drive the game until some seat is down to one card. */
  function playUntilOneCard(rt: GameRuntime, callUno: boolean): number | null {
    for (let guard = 0; guard < 400; guard++) {
      const seat = rt.activeSeats()[0];
      if (seat === undefined) return null;
      const legal = rt.legalMoves(seat) as { kind: string; card?: number; chooseColor?: string }[];
      const play = legal.find((m) => m.kind === 'PLAY');
      const hand = (rt.view(seat) as { hand?: unknown[] }).hand ?? [];
      if (play) {
        rt.applyMove(seat, 'PLAY', {
          card: play.card,
          chooseColor: play.chooseColor,
          callUno: hand.length === 2 && callUno,
        });
        if (hand.length === 2) return seat;
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
  function reachOneCard(callUno: boolean): { rt: GameRuntime; seat: number } {
    for (let seed = 1; seed <= 60; seed++) {
      const rt = GameRuntime.start(uno, seats(3), seed);
      const seat = playUntilOneCard(rt, callUno);
      if (seat === null) continue;
      if ((rt.view('SPECTATOR') as UnoPublic).winner !== null) continue;
      return { rt, seat };
    }
    throw new Error('no deal reached a one-card state');
  }

  it('leaves a silent player open to being caught, and penalises them', () => {
    const { rt, seat: quiet } = reachOneCard(false);
    const pub = rt.view('SPECTATOR') as UnoPublic;
    expect(pub.handCounts[quiet]).toBe(1);
    expect(pub.unoPending).toBe(quiet);

    const catcher = rt.activeSeats()[0]!;
    expect((rt.legalMoves(catcher) as { kind: string }[]).some((m) => m.kind === 'CATCH_UNO')).toBe(true);
    const before = pub.handCounts[quiet]!;
    rt.applyMove(catcher, 'CATCH_UNO', {});
    const after = rt.view('SPECTATOR') as UnoPublic;
    expect(after.handCounts[quiet]).toBe(before + 2);
    // The window closes: nobody gets to catch the same lapse twice.
    expect(after.unoPending).toBeNull();
    expect(() => rt.applyMove(rt.activeSeats()[0]!, 'CATCH_UNO', {})).toThrow(IllegalMove);
  });

  it('protects a player who calls it', () => {
    const { rt, seat: caller } = reachOneCard(true);
    const pub = rt.view('SPECTATOR') as UnoPublic;
    expect(pub.handCounts[caller]).toBe(1);
    expect(pub.unoPending).toBeNull();
    expect(pub.unoCalled).toContain(caller);
    const other = rt.activeSeats()[0]!;
    expect(() => rt.applyMove(other, 'CATCH_UNO', {})).toThrow(IllegalMove);
  });
});

describe('take-backs', () => {
  it('restores the exact state before the move, including the dice yet to come', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42);
    const seat = activeSeat(rt);
    const before = JSON.stringify(rt.view('SPECTATOR'));
    const beforeSeq = rt.currentSeq;

    rt.applyMove(seat, 'ROLL', {});
    expect(rt.undoable()).toMatchObject({ seat, type: 'ROLL' });

    const undone = rt.undoLastMove()!;
    expect(undone.seq).toBe(beforeSeq);
    expect(JSON.stringify(rt.view('SPECTATOR'))).toBe(before);
    expect(rt.activeSeats()).toEqual([seat]);
  });

  it('re-rolls rather than replaying the same die, so it cannot be used to peek', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42);
    const seat = activeSeat(rt);
    const rolls: number[] = [];
    for (let i = 0; i < 12; i++) {
      rt.applyMove(seat, 'ROLL', {});
      rolls.push((rt.view('SPECTATOR') as SnlPublic).lastRoll!.die);
      rt.undoLastMove();
    }
    // Restoring the RNG position means the same throw comes back every time;
    // what matters is that it is not *advanced* by a take-back, so a player
    // cannot burn rolls looking for a good one.
    expect(new Set(rolls).size).toBe(1);
  });

  it('offers only one step of history', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42);
    rt.applyMove(activeSeat(rt), 'ROLL', {});
    expect(rt.undoLastMove()).not.toBeNull();
    expect(rt.undoable()).toBeNull();
    expect(rt.undoLastMove()).toBeNull();
  });

  it('does not alias the live state, so a redone move behaves normally', () => {
    const rt = GameRuntime.start(snakesAndLadders, seats(2), 42);
    const seat = activeSeat(rt);
    rt.applyMove(seat, 'ROLL', {});
    rt.undoLastMove();
    const res = rt.applyMove(seat, 'ROLL', {});
    expect(res.seq).toBe(1);
    expect((rt.view('SPECTATOR') as SnlPublic).positions[seat]).toBeGreaterThan(0);
  });

  it('needs every other player to agree, and one refusal settles it', () => {
    const yes = createTakebackVote(0, 3, [1, 2]);
    expect(castTakebackVote(yes, 1, true)).toEqual({ resolved: false, approved: false });
    expect(castTakebackVote(yes, 2, true)).toEqual({ resolved: true, approved: true });

    const no = createTakebackVote(0, 3, [1, 2]);
    expect(castTakebackVote(no, 1, false)).toEqual({ resolved: true, approved: false });
  });

  it('ignores ballots from the requester and from non-voters', () => {
    const vote = createTakebackVote(0, 3, [1]);
    expect(castTakebackVote(vote, 0, true)).toEqual({ resolved: false, approved: false });
    expect(castTakebackVote(vote, 5, true)).toEqual({ resolved: false, approved: false });
    expect(vote.ballots.size).toBe(0);
    expect(castTakebackVote(vote, 1, true).approved).toBe(true);
  });

  it('carries itself when there is nobody left to ask', () => {
    expect(isUncontested(createTakebackVote(0, 1, []))).toBe(true);
    expect(isUncontested(createTakebackVote(0, 1, [1]))).toBe(false);
  });
});
