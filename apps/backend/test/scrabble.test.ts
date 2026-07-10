import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import { scrabble, LETTER_VALUES, premiumAt, type ScrabblePublic } from '@gamebox/game-scrabble';

const seats2 = [{ seat: 0 }, { seat: 1 }];

function pub(rt: GameRuntime): ScrabblePublic {
  return (rt.snapshot().state as { public: ScrabblePublic }).public;
}

/** Test-side peek at a player's rack via the (server-only) snapshot. */
function rack(rt: GameRuntime, seat: number): string[] {
  const priv = (rt.snapshot().state as { private: Record<number, { rack?: string[] }> }).private;
  return priv[seat]!.rack!;
}

/** Indexes of the first n non-blank tiles on the rack. */
function nonBlanks(rt: GameRuntime, seat: number, n: number): number[] {
  const out: number[] = [];
  rack(rt, seat).forEach((t, i) => {
    if (t !== '?' && out.length < n) out.push(i);
  });
  if (out.length < n) throw new Error('rack unexpectedly full of blanks');
  return out;
}

describe('scrabble', () => {
  it('deals 7-tile racks from a 100-tile bag', () => {
    const rt = GameRuntime.start(scrabble, seats2, 42);
    const p = pub(rt);
    expect(p.bagSize).toBe(100 - 14);
    expect(p.rackCounts[0]).toBe(7);
    expect(rack(rt, 0)).toHaveLength(7);
    expect(premiumAt(7, 7)).toBe('DW'); // center star doubles the first word
  });

  it('hides racks and the bag from opponents and the TV', () => {
    const rt = GameRuntime.start(scrabble, seats2, 7);
    const v1 = rt.view(1) as { rack: string[] | null };
    expect(v1.rack).toHaveLength(7);
    const v0asSpectator = rt.view('SPECTATOR') as { rack: string[] | null };
    expect(v0asSpectator.rack).toBeNull();
    expect(JSON.stringify(rt.view('SPECTATOR'))).not.toContain('"bag":');
    expect(JSON.stringify(rt.view(0))).not.toContain('"bag":');
  });

  it('first word must cover the center star and have 2+ letters', () => {
    const rt = GameRuntime.start(scrabble, seats2, 11);
    const [a, b] = nonBlanks(rt, 0, 2);
    expect(() =>
      rt.applyMove(0, 'PLACE', { tiles: [{ row: 0, col: 0, rackIndex: a }, { row: 0, col: 1, rackIndex: b }] }),
    ).toThrow(/center/);
    expect(() =>
      rt.applyMove(0, 'PLACE', { tiles: [{ row: 7, col: 7, rackIndex: a }] }),
    ).toThrow(/2 letters/);
  });

  it('scores the first word with the center double-word premium', () => {
    const rt = GameRuntime.start(scrabble, seats2, 13);
    const [a, b] = nonBlanks(rt, 0, 2);
    const letters = [rack(rt, 0)[a!]!, rack(rt, 0)[b!]!];
    const expected = (LETTER_VALUES[letters[0]!]! + LETTER_VALUES[letters[1]!]!) * 2;
    rt.applyMove(0, 'PLACE', {
      tiles: [
        { row: 7, col: 7, rackIndex: a },
        { row: 7, col: 8, rackIndex: b },
      ],
    });
    const p = pub(rt);
    expect(p.scores[0]).toBe(expected);
    expect(p.board[7]![7]!.letter).toBe(letters[0]);
    expect(p.rackCounts[0]).toBe(7); // refilled
    expect(p.turnIndex).toBe(1);
  });

  it('rejects gapped, disconnected and occupied placements', () => {
    const rt = GameRuntime.start(scrabble, seats2, 13);
    const [a, b] = nonBlanks(rt, 0, 2);
    rt.applyMove(0, 'PLACE', {
      tiles: [{ row: 7, col: 7, rackIndex: a }, { row: 7, col: 8, rackIndex: b }],
    });
    const [c, d] = nonBlanks(rt, 1, 2);
    // gap within the word
    expect(() =>
      rt.applyMove(1, 'PLACE', { tiles: [{ row: 3, col: 0, rackIndex: c }, { row: 3, col: 2, rackIndex: d }] }),
    ).toThrow();
    // disconnected from existing tiles
    expect(() =>
      rt.applyMove(1, 'PLACE', { tiles: [{ row: 0, col: 0, rackIndex: c }, { row: 0, col: 1, rackIndex: d }] }),
    ).toThrow(/connect/);
    // on top of an existing tile
    expect(() =>
      rt.applyMove(1, 'PLACE', { tiles: [{ row: 7, col: 7, rackIndex: c }] }),
    ).toThrow(/occupied/);
    // a proper hook: extend vertically through the played word
    rt.applyMove(1, 'PLACE', {
      tiles: [{ row: 6, col: 7, rackIndex: c }, { row: 8, col: 7, rackIndex: d }],
    });
    expect(pub(rt).scores[1]).toBeGreaterThan(0);
  });

  it('a blank needs a letter assignment and scores zero', () => {
    // find a seed where seat 0 holds a blank
    for (let seed = 1; seed < 300; seed++) {
      const rt = GameRuntime.start(scrabble, seats2, seed);
      const bi = rack(rt, 0).indexOf('?');
      if (bi === -1) continue;
      const [other] = nonBlanks(rt, 0, 1);
      const otherLetter = rack(rt, 0)[other!]!;
      expect(() =>
        rt.applyMove(0, 'PLACE', { tiles: [{ row: 7, col: 7, rackIndex: bi }, { row: 7, col: 8, rackIndex: other }] }),
      ).toThrow(/blank/);
      rt.applyMove(0, 'PLACE', {
        tiles: [{ row: 7, col: 7, rackIndex: bi, blankAs: 'Q' }, { row: 7, col: 8, rackIndex: other }],
      });
      const p = pub(rt);
      expect(p.board[7]![7]!.letter).toBe('Q');
      expect(p.board[7]![7]!.isBlank).toBe(true);
      // blank contributes 0, so the word is just the other letter, doubled by the center star
      expect(p.scores[0]).toBe(LETTER_VALUES[otherLetter]! * 2);
      return;
    }
    throw new Error('no seed produced a blank in 300 tries');
  });

  it('exchange swaps tiles without changing the bag size', () => {
    const rt = GameRuntime.start(scrabble, seats2, 17);
    const before = [...rack(rt, 0)];
    rt.applyMove(0, 'EXCHANGE', { rackIndexes: [0, 1, 2] });
    const p = pub(rt);
    expect(p.bagSize).toBe(86);
    expect(rack(rt, 0)).toHaveLength(7);
    expect(p.turnIndex).toBe(1);
    expect(p.consecutiveScoreless).toBe(1);
    expect(rack(rt, 0)).not.toEqual(before); // vanishingly unlikely to be identical
  });

  it('four consecutive scoreless turns end the game with rack deductions', () => {
    const rt = GameRuntime.start(scrabble, seats2, 19);
    rt.applyMove(0, 'PASS', {});
    rt.applyMove(1, 'PASS', {});
    rt.applyMove(0, 'PASS', {});
    rt.applyMove(1, 'PASS', {});
    expect(rt.currentStatus).toBe('completed');
    const p = pub(rt);
    for (const s of [0, 1]) expect(p.scores[s]).toBeLessThanOrEqual(0);
    expect(rt.endResult?.winners?.length).toBeGreaterThan(0);
  });
});
