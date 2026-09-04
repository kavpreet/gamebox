import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { WORD_BANK } from './words.js';

/**
 * Codenames — the asymmetric-view stress test for the projection engine.
 * Two teams; each team's SPYMASTER sees the full key card (which words belong
 * to whom), the guessers and the TV see only what's been revealed. The key
 * lives in the hidden zone; view() copies it ONLY into a spymaster's view.
 *
 * Simplifications: clue words are trusted (no server-side "not a word on the
 * board" enforcement beyond an exact-match check), no timer.
 */

/** What a board card really is (key) / what a revealed card shows. */
export type CardKind = 'team0' | 'team1' | 'neutral' | 'assassin';

export interface CodenamesPublic {
  words: string[]; // 25 words
  revealed: (CardKind | null)[]; // null = still face down
  startingTeam: number;
  currentTeam: number;
  phase: 'CLUE' | 'GUESS';
  clue: { word: string; count: number } | null;
  guessesLeft: number;
  remaining: [number, number]; // unrevealed agent counts per team
  spymasters: Record<number, Seat>; // team → spymaster seat
  teamOf: Record<Seat, number>;
  winnerTeam: number | null;
  lastEvent: string | null;
}

interface Hidden {
  key: CardKind[];
}

export type CodenamesMove =
  | { kind: 'CLUE'; word: string; count: number }
  | { kind: 'GUESS'; index: number }
  | { kind: 'PASS' };

const HIDDEN_ZONE = -1 as Seat;

type State = GameState<CodenamesPublic, Hidden | Record<string, never>>;

function keyOf(state: State): CardKind[] {
  return (state.private[HIDDEN_ZONE] as Hidden).key;
}

function teamSeats(pub: CodenamesPublic, team: number): Seat[] {
  return Object.entries(pub.teamOf)
    .filter(([, t]) => t === team)
    .map(([s]) => Number(s) as Seat);
}

function guessers(pub: CodenamesPublic, team: number): Seat[] {
  return teamSeats(pub, team).filter((s) => pub.spymasters[team] !== s);
}

function otherTeam(team: number): number {
  return team === 0 ? 1 : 0;
}

function endTurn(pub: CodenamesPublic): void {
  pub.currentTeam = otherTeam(pub.currentTeam);
  pub.phase = 'CLUE';
  pub.clue = null;
  pub.guessesLeft = 0;
}

function reveal(state: State, index: number): CardKind {
  const kind = keyOf(state)[index]!;
  state.public.revealed[index] = kind;
  if (kind === 'team0') state.public.remaining[0]--;
  if (kind === 'team1') state.public.remaining[1]--;
  return kind;
}

export const codenames: GameModule<CodenamesPublic, Hidden | Record<string, never>, CodenamesMove> = {
  slug: 'codenames',
  displayName: 'Codenames',
  description: 'Spymasters give one-word clues; teams race to find their agents.',
  rulesVersion: '1.0.0',
  minPlayers: 4,
  maxPlayers: 10,
  teams: 'required',

  setup(seats, rng) {
    const teamOf: Record<Seat, number> = {};
    for (const { seat, team } of seats) teamOf[seat] = (team ?? 0) % 2;

    const t0 = seats.filter((s) => teamOf[s.seat] === 0).map((s) => s.seat);
    const t1 = seats.filter((s) => teamOf[s.seat] === 1).map((s) => s.seat);
    if (t0.length < 2 || t1.length < 2) {
      throw new IllegalMove('Codenames needs at least 2 players on each team');
    }
    // lowest seat of each team is the spymaster
    const spymasters: Record<number, Seat> = { 0: Math.min(...t0), 1: Math.min(...t1) };

    const words = rng.shuffle([...WORD_BANK]).slice(0, 25);
    const startingTeam = rng.int(0, 1);
    const kinds: CardKind[] = [
      ...Array<CardKind>(startingTeam === 0 ? 9 : 8).fill('team0'),
      ...Array<CardKind>(startingTeam === 1 ? 9 : 8).fill('team1'),
      ...Array<CardKind>(7).fill('neutral'),
      'assassin',
    ];
    const key = rng.shuffle(kinds);

    return {
      public: {
        words,
        revealed: Array(25).fill(null),
        startingTeam,
        currentTeam: startingTeam,
        phase: 'CLUE',
        clue: null,
        guessesLeft: 0,
        remaining: [startingTeam === 0 ? 9 : 8, startingTeam === 1 ? 9 : 8],
        spymasters,
        teamOf,
        winnerTeam: null,
        lastEvent: null,
      },
      private: { [HIDDEN_ZONE]: { key } },
    };
  },

  activePlayers(state) {
    const pub = state.public;
    if (pub.winnerTeam !== null) return [];
    if (pub.phase === 'CLUE') return [pub.spymasters[pub.currentTeam]!];
    return guessers(pub, pub.currentTeam);
  },

  moves: {
    CLUE({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.winnerTeam !== null) throw new IllegalMove('Game over');
      if (pub.phase !== 'CLUE') throw new IllegalMove('A clue was already given');
      if (seat !== pub.spymasters[pub.currentTeam]) throw new IllegalMove('Only the current spymaster gives clues');
      const { word, count } = payload as { word: string; count: number };
      const clean = String(word ?? '').trim().toUpperCase();
      if (!clean || clean.length > 30) throw new IllegalMove('Clue must be a single word');
      if (/\s/.test(clean)) throw new IllegalMove('Clue must be a single word');
      const unrevealedWords = pub.words.filter((_, i) => pub.revealed[i] === null);
      if (unrevealedWords.includes(clean)) throw new IllegalMove('Clue cannot be a word on the board');
      const n = Math.floor(Number(count));
      if (!Number.isFinite(n) || n < 0 || n > 9) throw new IllegalMove('Count must be 0–9');

      pub.clue = { word: clean, count: n };
      pub.guessesLeft = n === 0 ? 25 : n + 1; // 0 = unlimited-ish
      pub.phase = 'GUESS';
      pub.lastEvent = `Clue: ${clean} ${n}`;
    },

    GUESS({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.winnerTeam !== null) throw new IllegalMove('Game over');
      if (pub.phase !== 'GUESS') throw new IllegalMove('Wait for a clue');
      if (pub.teamOf[seat] !== pub.currentTeam) throw new IllegalMove('Not your team\'s turn');
      if (seat === pub.spymasters[pub.currentTeam]) throw new IllegalMove('Spymasters do not guess');
      const index = Number((payload as { index: number }).index);
      if (!Number.isInteger(index) || index < 0 || index >= 25) throw new IllegalMove('Bad card');
      if (pub.revealed[index] !== null) throw new IllegalMove('Already revealed');

      const team = pub.currentTeam;
      const kind = reveal(s, index);
      pub.lastEvent = `${pub.words[index]} was ${kind === 'team0' ? 'RED' : kind === 'team1' ? 'BLUE' : kind}`;

      if (kind === 'assassin') {
        pub.winnerTeam = otherTeam(team);
        return;
      }
      if (pub.remaining[0] === 0) { pub.winnerTeam = 0; return; }
      if (pub.remaining[1] === 0) { pub.winnerTeam = 1; return; }

      if (kind === (team === 0 ? 'team0' : 'team1')) {
        pub.guessesLeft--;
        if (pub.guessesLeft <= 0) endTurn(pub);
      } else {
        endTurn(pub); // neutral or enemy agent ends the turn
      }
    },

    PASS({ state, seat }) {
      const s = state as State;
      const pub = s.public;
      if (pub.winnerTeam !== null) throw new IllegalMove('Game over');
      if (pub.phase !== 'GUESS') throw new IllegalMove('Nothing to pass');
      if (pub.teamOf[seat] !== pub.currentTeam) throw new IllegalMove('Not your team\'s turn');
      if (seat === pub.spymasters[pub.currentTeam]) throw new IllegalMove('Spymasters do not guess');
      pub.lastEvent = 'Passed';
      endTurn(pub);
    },
  },

  legalMoves(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.winnerTeam !== null) return [];
    if (pub.phase === 'CLUE') return []; // free-text clue — UI provides the form
    if (pub.teamOf[seat] !== pub.currentTeam || seat === pub.spymasters[pub.currentTeam]) return [];
    const moves: CodenamesMove[] = [];
    pub.revealed.forEach((r, i) => {
      if (r === null) moves.push({ kind: 'GUESS', index: i });
    });
    moves.push({ kind: 'PASS' });
    return moves;
  },

  endIf(state) {
    if (state.public.winnerTeam !== null) return { winningTeam: state.public.winnerTeam };
    return null;
  },

  view(state, viewer) {
    const s = state as State;
    const pub = s.public;
    const isSpymaster =
      viewer !== 'SPECTATOR' && (pub.spymasters[0] === viewer || pub.spymasters[1] === viewer);
    return { ...pub, key: isSpymaster ? keyOf(s) : null };
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.winnerTeam !== null) return;
    if (pub.phase === 'CLUE' && seat === pub.spymasters[pub.currentTeam]) {
      endTurn(pub); // spymaster gone — their team forfeits the turn
    } else if (pub.phase === 'GUESS' && pub.teamOf[seat] === pub.currentTeam) {
      endTurn(pub);
    }
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const team = pub.teamOf[seat];
    delete pub.teamOf[seat];
    if (team === undefined) return;
    const left = teamSeats(pub, team);
    if (left.length < 2) {
      // team can no longer function — the other team wins
      if (pub.winnerTeam === null) pub.winnerTeam = otherTeam(team);
      return;
    }
    if (pub.spymasters[team] === seat) {
      pub.spymasters[team] = Math.min(...left);
      pub.lastEvent = 'Spymaster left — a teammate takes over';
    }
    if (pub.phase === 'CLUE' && pub.currentTeam === team && pub.spymasters[team] === undefined) {
      endTurn(pub);
    }
  },
};
