import { describe, it, expect } from 'vitest';
import { GameRuntime } from '@gamebox/core-engine';
import { codenames, type CodenamesPublic, type CardKind } from '@gamebox/game-codenames';

const seats4 = [
  { seat: 0, team: 0 }, // red spymaster
  { seat: 1, team: 0 }, // red guesser
  { seat: 2, team: 1 }, // blue spymaster
  { seat: 3, team: 1 }, // blue guesser
];

function pub(rt: GameRuntime): CodenamesPublic {
  return (rt.snapshot().state as { public: CodenamesPublic }).public;
}

function key(rt: GameRuntime): CardKind[] {
  const v = rt.view(pub(rt).spymasters[pub(rt).currentTeam]!) as { key: CardKind[] };
  return v.key;
}

function spymaster(rt: GameRuntime): number {
  return pub(rt).spymasters[pub(rt).currentTeam]!;
}

function guesser(rt: GameRuntime): number {
  const p = pub(rt);
  return seats4.find((s) => s.team === p.currentTeam && s.seat !== p.spymasters[p.currentTeam])!.seat;
}

describe('codenames', () => {
  it('sets up 25 words with a 9/8/7/1 key and starting team advantage', () => {
    const rt = GameRuntime.start(codenames, seats4, 42);
    const p = pub(rt);
    expect(p.words).toHaveLength(25);
    expect(new Set(p.words).size).toBe(25);
    const k = key(rt);
    const counts = { team0: 0, team1: 0, neutral: 0, assassin: 0 };
    for (const c of k) counts[c]++;
    expect(counts[p.startingTeam === 0 ? 'team0' : 'team1']).toBe(9);
    expect(counts[p.startingTeam === 0 ? 'team1' : 'team0']).toBe(8);
    expect(counts.neutral).toBe(7);
    expect(counts.assassin).toBe(1);
    expect(p.remaining[p.startingTeam]).toBe(9);
  });

  it('shows the key only to spymasters — guessers and TV get key:null', () => {
    const rt = GameRuntime.start(codenames, seats4, 7);
    const p = pub(rt);
    for (const sm of [p.spymasters[0]!, p.spymasters[1]!]) {
      expect((rt.view(sm) as { key: unknown }).key).toHaveLength(25);
    }
    for (const viewer of [1, 3, 'SPECTATOR'] as const) {
      const v = rt.view(viewer) as { key: unknown };
      expect(v.key).toBeNull();
      expect(JSON.stringify(v)).not.toContain('assassin'); // nothing leaks pre-reveal
    }
  });

  it('only the current spymaster may clue; only current-team guessers may guess', () => {
    const rt = GameRuntime.start(codenames, seats4, 7);
    const otherSm = pub(rt).spymasters[pub(rt).currentTeam === 0 ? 1 : 0]!;
    expect(() => rt.applyMove(otherSm, 'CLUE', { word: 'HI', count: 1 })).toThrow();
    expect(() => rt.applyMove(guesser(rt), 'GUESS', { index: 0 })).toThrow(); // no clue yet
    rt.applyMove(spymaster(rt), 'CLUE', { word: 'ANIMALS', count: 2 });
    expect(pub(rt).phase).toBe('GUESS');
    expect(() => rt.applyMove(spymaster(rt), 'GUESS', { index: 0 })).toThrow(); // spymaster can't guess
  });

  it('rejects multi-word clues and clues matching a board word', () => {
    const rt = GameRuntime.start(codenames, seats4, 9);
    const sm = spymaster(rt);
    expect(() => rt.applyMove(sm, 'CLUE', { word: 'TWO WORDS', count: 1 })).toThrow();
    expect(() => rt.applyMove(sm, 'CLUE', { word: pub(rt).words[0], count: 1 })).toThrow();
  });

  it('correct guesses continue (count+1 total), wrong guesses end the turn', () => {
    const rt = GameRuntime.start(codenames, seats4, 11);
    const p = pub(rt);
    const team = p.currentTeam;
    const own: CardKind = team === 0 ? 'team0' : 'team1';
    const k = key(rt);
    const ownIdx = k.map((c, i) => (c === own ? i : -1)).filter((i) => i >= 0);
    const neutralIdx = k.findIndex((c) => c === 'neutral');

    rt.applyMove(spymaster(rt), 'CLUE', { word: 'STUFF', count: 2 });
    rt.applyMove(guesser(rt), 'GUESS', { index: ownIdx[0]! });
    expect(pub(rt).currentTeam).toBe(team); // still guessing
    rt.applyMove(guesser(rt), 'GUESS', { index: neutralIdx });
    expect(pub(rt).currentTeam).toBe(team === 0 ? 1 : 0); // neutral flips the turn
    expect(pub(rt).phase).toBe('CLUE');
  });

  it('guessing the assassin loses instantly', () => {
    const rt = GameRuntime.start(codenames, seats4, 13);
    const team = pub(rt).currentTeam;
    const assassinIdx = key(rt).findIndex((c) => c === 'assassin');
    rt.applyMove(spymaster(rt), 'CLUE', { word: 'OOPS', count: 1 });
    rt.applyMove(guesser(rt), 'GUESS', { index: assassinIdx });
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winningTeam).toBe(team === 0 ? 1 : 0);
  });

  it('revealing all of a team\'s agents wins the game', () => {
    const rt = GameRuntime.start(codenames, seats4, 17);
    const team = pub(rt).currentTeam;
    const own: CardKind = team === 0 ? 'team0' : 'team1';
    const ownIdx = key(rt).map((c, i) => (c === own ? i : -1)).filter((i) => i >= 0);
    expect(ownIdx).toHaveLength(9);
    // one giant clue, then run the board
    rt.applyMove(spymaster(rt), 'CLUE', { word: 'EVERYTHING', count: 9 });
    for (const idx of ownIdx) rt.applyMove(guesser(rt), 'GUESS', { index: idx });
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winningTeam).toBe(team);
  });

  it('PASS hands the turn to the other team', () => {
    const rt = GameRuntime.start(codenames, seats4, 19);
    const team = pub(rt).currentTeam;
    rt.applyMove(spymaster(rt), 'CLUE', { word: 'MEH', count: 1 });
    rt.applyMove(guesser(rt), 'PASS', {});
    expect(pub(rt).currentTeam).toBe(team === 0 ? 1 : 0);
  });

  it('removing a spymaster promotes a teammate; a 1-player team forfeits', () => {
    const seats6 = [
      { seat: 0, team: 0 }, { seat: 1, team: 0 }, { seat: 2, team: 0 },
      { seat: 3, team: 1 }, { seat: 4, team: 1 }, { seat: 5, team: 1 },
    ];
    const rt = GameRuntime.start(codenames, seats6, 23);
    expect(pub(rt).spymasters[0]).toBe(0);
    rt.removePlayer(0);
    expect(pub(rt).spymasters[0]).toBe(1);
    rt.removePlayer(1); // team 0 down to one player → forfeits
    expect(rt.currentStatus).toBe('completed');
    expect(rt.endResult?.winningTeam).toBe(1);
  });
});
