import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import { scattergories, type ScattergoriesPublic } from '@gamebox/game-scattergories';

const seats3 = [{ seat: 0 }, { seat: 1 }, { seat: 2 }];

function pub(rt: GameRuntime): ScattergoriesPublic {
  return (rt.snapshot().state as { public: ScattergoriesPublic }).public;
}

/** Build a full answers array: `fill` for every category, overridden at given indexes. */
function answersWith(rt: GameRuntime, fill: string, overrides: Record<number, string> = {}): string[] {
  return pub(rt).categories.map((_, i) => overrides[i] ?? fill);
}

describe('scattergories', () => {
  it('starts with 10 categories, a letter, and all players active at once', () => {
    const rt = GameRuntime.start(scattergories, seats3, 42);
    const p = pub(rt);
    expect(p.categories).toHaveLength(10);
    expect(p.letter).toMatch(/^[A-Z]$/);
    expect(rt.activeSeats().sort()).toEqual([0, 1, 2]);
  });

  it('keeps answers private until everyone has submitted', () => {
    const rt = GameRuntime.start(scattergories, seats3, 7);
    const p = pub(rt);
    const secret = `${p.letter}ZZSECRETWORD`;
    rt.applyMove(0, 'SUBMIT', { answers: answersWith(rt, secret) });
    // seat 1 and the TV must not see seat 0's answers
    expect(JSON.stringify(rt.view(1))).not.toContain(secret);
    expect(JSON.stringify(rt.view('SPECTATOR'))).not.toContain(secret);
    // seat 0 sees their own (reconnect restore)
    expect(JSON.stringify(rt.view(0))).toContain(secret);
    expect(rt.activeSeats().sort()).toEqual([1, 2]); // 0 is done
    rt.applyMove(1, 'SUBMIT', { answers: answersWith(rt, '') });
    rt.applyMove(2, 'SUBMIT', { answers: answersWith(rt, '') });
    expect(pub(rt).phase).toBe('VOTE');
    expect(JSON.stringify(rt.view('SPECTATOR'))).toContain(secret); // now revealed
  });

  it('scores 1 for valid unique answers, 0 for duplicates and wrong letters', () => {
    const rt = GameRuntime.start(scattergories, seats3, 11);
    const L = pub(rt).letter;
    // cat 0: all three same (dup = 0 pts); cat 1: unique per player; cat 2: wrong letter
    rt.applyMove(0, 'SUBMIT', { answers: answersWith(rt, '', { 0: `${L}same`, 1: `${L}alpha`, 2: 'zzz-wrong' }) });
    rt.applyMove(1, 'SUBMIT', { answers: answersWith(rt, '', { 0: `${L}same`, 1: `${L}beta` }) });
    rt.applyMove(2, 'SUBMIT', { answers: answersWith(rt, '', { 0: `${L}SAME `, 1: `${L}gamma` }) });
    rt.applyMove(0, 'VOTE', { vetoes: [] });
    rt.applyMove(1, 'VOTE', { vetoes: [] });
    rt.applyMove(2, 'VOTE', { vetoes: [] });
    const p = pub(rt);
    const r = p.history[0]!;
    expect(r.points[0]).toBe(1); // only the unique cat-1 answer
    expect(r.points[1]).toBe(1);
    expect(r.points[2]).toBe(1);
    expect(r.accepted[0]![0]).toBe(true); // valid but duplicated → accepted yet 0 pts
    expect(r.accepted[0]![2]).toBe(false); // wrong letter
    expect(p.round).toBe(2);
  });

  it('a majority veto kills an answer', () => {
    const rt = GameRuntime.start(scattergories, seats3, 13);
    const L = pub(rt).letter;
    rt.applyMove(0, 'SUBMIT', { answers: answersWith(rt, '', { 0: `${L}dubious` }) });
    rt.applyMove(1, 'SUBMIT', { answers: answersWith(rt, '') });
    rt.applyMove(2, 'SUBMIT', { answers: answersWith(rt, '') });
    // both other players veto seat 0's category-0 answer (majority of 2-of-2 others)
    rt.applyMove(1, 'VOTE', { vetoes: [{ seat: 0, index: 0 }] });
    rt.applyMove(2, 'VOTE', { vetoes: [{ seat: 0, index: 0 }] });
    rt.applyMove(0, 'VOTE', { vetoes: [] });
    const r = pub(rt).history[0]!;
    expect(r.accepted[0]![0]).toBe(false);
    expect(r.points[0]).toBe(0);
  });

  it('plays 3 rounds then declares the highest scorer the winner', () => {
    const rt = GameRuntime.start(scattergories, seats3, 17);
    for (let round = 0; round < 3; round++) {
      const L = pub(rt).letter;
      rt.applyMove(0, 'SUBMIT', { answers: answersWith(rt, `${L}win${round}`) }); // 10 unique valid
      rt.applyMove(1, 'SUBMIT', { answers: answersWith(rt, '') });
      rt.applyMove(2, 'SUBMIT', { answers: answersWith(rt, '') });
      for (const s of [0, 1, 2]) rt.applyMove(s, 'VOTE', { vetoes: [] });
    }
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winners).toEqual([0]);
    expect(pub(rt).scores[0]).toBe(30);
    // rounds never reuse a letter or category
    const letters = pub(rt).history.map((h) => h.letter);
    expect(new Set(letters).size).toBe(3);
    const cats = pub(rt).history.flatMap((h) => h.categories);
    expect(new Set(cats).size).toBe(30);
  });

  it('skipping a seat treats them as submitted so the round can proceed', () => {
    const rt = GameRuntime.start(scattergories, seats3, 19);
    rt.applyMove(0, 'SUBMIT', { answers: answersWith(rt, '') });
    rt.applyMove(1, 'SUBMIT', { answers: answersWith(rt, '') });
    rt.skipSeat(2);
    expect(pub(rt).phase).toBe('VOTE');
  });

  it('removing a player mid-wait completes the phase for the rest', () => {
    const rt = GameRuntime.start(scattergories, seats3, 23);
    rt.applyMove(0, 'SUBMIT', { answers: answersWith(rt, '') });
    rt.applyMove(1, 'SUBMIT', { answers: answersWith(rt, '') });
    rt.removePlayer(2);
    expect(pub(rt).phase).toBe('VOTE');
    expect(pub(rt).order).toEqual([0, 1]);
  });
});
