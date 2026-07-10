import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import { pictionary, type PictionaryPublic } from '@gamebox/game-pictionary';

const seats3 = [{ seat: 0 }, { seat: 1 }, { seat: 2 }];

function pub(rt: GameRuntime): PictionaryPublic {
  return (rt.snapshot().state as { public: PictionaryPublic }).public;
}

function currentWord(rt: GameRuntime): string {
  return (rt.view(pub(rt).drawer) as { word: string }).word;
}

describe('pictionary', () => {
  it('starts with seat 0 drawing, everyone active, 2 rounds per player', () => {
    const rt = GameRuntime.start(pictionary, seats3, 42);
    const p = pub(rt);
    expect(p.drawer).toBe(0);
    expect(p.totalRounds).toBe(6);
    expect(rt.activeSeats().sort()).toEqual([0, 1, 2]);
    expect(p.wordHint.replace(/ /g, '')).toHaveLength(p.wordLength);
  });

  it('shows the word only to the drawer', () => {
    const rt = GameRuntime.start(pictionary, seats3, 7);
    const word = currentWord(rt);
    expect(word.length).toBeGreaterThan(2);
    for (const viewer of [1, 2, 'SPECTATOR'] as const) {
      const v = rt.view(viewer) as { word: string | null };
      expect(v.word).toBeNull();
      expect(JSON.stringify(v)).not.toContain(`"${word}"`);
    }
  });

  it('only the drawer may draw; strokes are validated and visible to all', () => {
    const rt = GameRuntime.start(pictionary, seats3, 7);
    expect(() => rt.applyMove(1, 'STROKE', { color: '#ff0000', width: 0.01, points: [0, 0, 0.5, 0.5] })).toThrow();
    expect(() => rt.applyMove(0, 'STROKE', { color: '#ff0000', width: 0.01, points: [0, 0, 2, 2] })).toThrow(/normalized/);
    expect(() => rt.applyMove(0, 'STROKE', { color: '#ff0000', width: 0.01, points: [0.5, 0.5] })).toThrow(/two points/);
    rt.applyMove(0, 'STROKE', { color: '#ff0000', width: 0.01, points: [0.1, 0.1, 0.9, 0.9] });
    const tv = rt.view('SPECTATOR') as { strokes: unknown[] };
    expect(tv.strokes).toHaveLength(1);
    rt.applyMove(0, 'UNDO', {});
    expect((rt.view('SPECTATOR') as { strokes: unknown[] }).strokes).toHaveLength(0);
  });

  it('a correct guess scores guesser +2 / drawer +1 and starts the next round', () => {
    const rt = GameRuntime.start(pictionary, seats3, 11);
    const word = currentWord(rt);
    rt.applyMove(1, 'GUESS', { text: 'definitely wrong answer' });
    expect(pub(rt).round).toBe(1);
    expect(pub(rt).guesses[0]).toMatchObject({ seat: 1, correct: false });
    rt.applyMove(2, 'GUESS', { text: ` ${word.toUpperCase()} ` }); // case/space insensitive
    const p = pub(rt);
    expect(p.scores[2]).toBe(2);
    expect(p.scores[0]).toBe(1);
    expect(p.round).toBe(2);
    expect(p.drawer).toBe(1); // rotated
    expect(p.strokes).toHaveLength(0); // fresh canvas
    expect(p.revealedWord).toBe(word);
  });

  it('the drawer cannot guess their own word', () => {
    const rt = GameRuntime.start(pictionary, seats3, 13);
    expect(() => rt.applyMove(0, 'GUESS', { text: currentWord(rt) })).toThrow();
  });

  it('SKIP forfeits the round for 0 points; a full game completes with a winner', () => {
    const rt = GameRuntime.start(pictionary, seats3, 17);
    // seat 1 wins every round by guessing correctly except when drawing (then seat 2 guesses)
    let guard = 0;
    while (rt.currentStatus === 'active') {
      if (++guard > 20) throw new Error('game did not terminate');
      const p = pub(rt);
      const word = currentWord(rt);
      const guesser = p.drawer === 1 ? 2 : 1;
      rt.applyMove(guesser, 'GUESS', { text: word });
    }
    expect(rt.currentStatus).toBe('completed');
    expect(pub(rt).round).toBe(6);
    expect(rt.endResult?.winners).toEqual([1]); // 2pts × 4 guesses + 1pt × 2 draws = 10
  });

  it('skipping and word rotation never repeat words within a game', () => {
    const rt = GameRuntime.start(pictionary, seats3, 19);
    const seen = new Set<string>();
    while (rt.currentStatus === 'active') {
      const w = currentWord(rt);
      expect(seen.has(w)).toBe(false);
      seen.add(w);
      rt.applyMove(pub(rt).drawer, 'SKIP', {});
    }
    expect(seen.size).toBe(6);
    const scores = pub(rt).scores;
    for (const s of [0, 1, 2]) expect(scores[s]).toBe(0);
  });

  it('removing the drawer reveals the word and moves on', () => {
    const rt = GameRuntime.start(pictionary, seats3, 23);
    const word = currentWord(rt);
    rt.removePlayer(0);
    const p = pub(rt);
    expect(p.revealedWord).toBe(word);
    expect(p.order).toEqual([1, 2]);
    expect(p.drawer === 1 || p.drawer === 2).toBe(true);
    expect(rt.currentStatus).toBe('active');
  });
});
