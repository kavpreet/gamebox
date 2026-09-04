import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';

/**
 * Straight Rummy — draw (stock or discard) → optionally meld sets/runs and lay
 * off onto table melds → discard to end the turn. First empty hand wins.
 * Sets: 3–4 of a rank, distinct suits. Runs: 3+ consecutive, one suit,
 * ace low OR high (A-2-3 and Q-K-A both fine, no wraparound).
 */

export type Suit = 'S' | 'H' | 'D' | 'C';
export interface Card {
  suit: Suit;
  rank: number; // 1 (ace) .. 13 (king)
}

export interface Meld {
  cards: Card[];
  type: 'set' | 'run';
}

export interface RummyPublic {
  melds: Meld[];
  discardTop: Card | null;
  discardCount: number;
  stockSize: number;
  order: Seat[];
  turnIndex: number;
  phase: 'DRAW' | 'ACT';
  handCounts: Record<Seat, number>;
  lastEvent: string | null;
  winner: Seat | null;
}

export interface RummyPrivate {
  hand: Card[];
}

interface Hidden {
  stock: Card[];
  discard: Card[];
}

export type RummyMove =
  | { kind: 'DRAW'; source: 'stock' | 'discard' }
  | { kind: 'MELD'; cards: number[] }
  | { kind: 'LAYOFF'; card: number; meld: number }
  | { kind: 'DISCARD'; card: number };

const HIDDEN_ZONE = -1 as Seat;
type State = GameState<RummyPublic, RummyPrivate | Hidden>;

function hiddenOf(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}
function handOf(s: State, seat: Seat): Card[] {
  return (s.private[seat] as RummyPrivate).hand;
}
function currentSeat(pub: RummyPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

export function isValidSet(cards: Card[]): boolean {
  if (cards.length < 3 || cards.length > 4) return false;
  const rank = cards[0]!.rank;
  if (!cards.every((c) => c.rank === rank)) return false;
  const suits = new Set(cards.map((c) => c.suit));
  return suits.size === cards.length;
}

export function isValidRun(cards: Card[]): boolean {
  if (cards.length < 3) return false;
  const suit = cards[0]!.suit;
  if (!cards.every((c) => c.suit === suit)) return false;

  const tryOrder = (ranks: number[]): boolean => {
    const sorted = [...ranks].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! !== sorted[i - 1]! + 1) return false;
    }
    return true;
  };
  const ranks = cards.map((c) => c.rank);
  if (tryOrder(ranks)) return true;
  // ace-high: treat 1 as 14
  if (ranks.includes(1)) return tryOrder(ranks.map((r) => (r === 1 ? 14 : r)));
  return false;
}

export function classifyMeld(cards: Card[]): 'set' | 'run' | null {
  if (isValidSet(cards)) return 'set';
  if (isValidRun(cards)) return 'run';
  return null;
}

/** Would `meld.cards + card` still be a valid meld of the same kind? */
export function canLayOff(meld: Meld, card: Card): boolean {
  const combined = [...meld.cards, card];
  return meld.type === 'set' ? isValidSet(combined) : isValidRun(combined);
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
    for (let rank = 1; rank <= 13; rank++) deck.push({ suit, rank });
  }
  return deck;
}

function refreshCounts(s: State): void {
  const pub = s.public;
  for (const seat of pub.order) pub.handCounts[seat] = handOf(s, seat).length;
  pub.stockSize = hiddenOf(s).stock.length;
  pub.discardCount = hiddenOf(s).discard.length;
  pub.discardTop = hiddenOf(s).discard[hiddenOf(s).discard.length - 1] ?? null;
}

function drawFromStock(s: State, rng: SeededRandom): Card | null {
  const hidden = hiddenOf(s);
  if (hidden.stock.length === 0) {
    if (hidden.discard.length <= 1) return null;
    const top = hidden.discard.pop()!;
    hidden.stock = rng.shuffle(hidden.discard);
    hidden.discard = [top];
  }
  return hidden.stock.pop() ?? null;
}

function checkWin(s: State, seat: Seat): boolean {
  if (handOf(s, seat).length === 0) {
    s.public.winner = seat;
    return true;
  }
  return false;
}

/** Candidate melds worth suggesting (all valid sets + maximal runs in hand). */
export function findMeldCandidates(hand: Card[]): number[][] {
  const out: number[][] = [];
  // sets: group by rank
  const byRank = new Map<number, number[]>();
  hand.forEach((c, i) => {
    (byRank.get(c.rank) ?? byRank.set(c.rank, []).get(c.rank)!).push(i);
  });
  for (const idxs of byRank.values()) {
    if (idxs.length >= 3) {
      // all 3-subsets + the full 4
      for (let a = 0; a < idxs.length; a++)
        for (let b = a + 1; b < idxs.length; b++)
          for (let c = b + 1; c < idxs.length; c++) {
            const combo = [idxs[a]!, idxs[b]!, idxs[c]!];
            if (isValidSet(combo.map((i) => hand[i]!))) out.push(combo);
          }
      if (idxs.length === 4 && isValidSet(idxs.map((i) => hand[i]!))) out.push([...idxs]);
    }
  }
  // runs: per suit, sliding windows over sorted ranks (ace tried both ways)
  const bySuit = new Map<Suit, number[]>();
  hand.forEach((c, i) => {
    (bySuit.get(c.suit) ?? bySuit.set(c.suit, []).get(c.suit)!).push(i);
  });
  for (const idxs of bySuit.values()) {
    if (idxs.length < 3) continue;
    for (let len = 3; len <= idxs.length; len++) {
      // try every combination of size len? cheap approach: sort by rank and take windows
      const sortedLow = [...idxs].sort((a, b) => hand[a]!.rank - hand[b]!.rank);
      for (let start = 0; start + len <= sortedLow.length; start++) {
        const win = sortedLow.slice(start, start + len);
        if (isValidRun(win.map((i) => hand[i]!))) out.push(win);
      }
      const aceHigh = (r: number) => (r === 1 ? 14 : r);
      const sortedHigh = [...idxs].sort((a, b) => aceHigh(hand[a]!.rank) - aceHigh(hand[b]!.rank));
      for (let start = 0; start + len <= sortedHigh.length; start++) {
        const win = sortedHigh.slice(start, start + len);
        if (isValidRun(win.map((i) => hand[i]!))) out.push(win);
      }
    }
  }
  // dedupe
  const seen = new Set<string>();
  return out.filter((m) => {
    const k = [...m].sort((a, b) => a - b).join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const rummy: GameModule<RummyPublic, RummyPrivate | Hidden, RummyMove> = {
  slug: 'rummy',
  displayName: 'Rummy',
  description: 'Draw and discard to meld sets and runs; first to empty their hand wins.',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 6,
  teams: 'none',

  setup(seats, rng) {
    const deck = rng.shuffle(buildDeck());
    const handSize = seats.length === 2 ? 10 : seats.length <= 4 ? 7 : 6;
    const priv: Record<Seat, RummyPrivate | Hidden> = {};
    const handCounts: Record<Seat, number> = {};
    for (const { seat } of seats) {
      priv[seat] = { hand: deck.splice(0, handSize) };
      handCounts[seat] = handSize;
    }
    const firstDiscard = deck.pop()!;
    priv[HIDDEN_ZONE] = { stock: deck, discard: [firstDiscard] };
    return {
      public: {
        melds: [],
        discardTop: firstDiscard,
        discardCount: 1,
        stockSize: deck.length,
        order: seats.map((s) => s.seat),
        turnIndex: 0,
        phase: 'DRAW',
        handCounts,
        lastEvent: null,
        winner: null,
      },
      private: priv,
    };
  },

  activePlayers(state) {
    if (state.public.winner !== null) return [];
    return [currentSeat(state.public)];
  },

  moves: {
    DRAW({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'DRAW') throw new IllegalMove('You already drew');
      const source = (payload as { source: string }).source;
      let card: Card | null;
      if (source === 'discard') {
        card = hiddenOf(s).discard.pop() ?? null;
        if (!card) throw new IllegalMove('Discard pile is empty');
      } else {
        card = drawFromStock(s, rng);
        if (!card) throw new IllegalMove('No cards left to draw');
      }
      handOf(s, seat).push(card);
      pub.phase = 'ACT';
      pub.lastEvent = source === 'discard' ? 'took the discard' : 'drew from stock';
      refreshCounts(s);
    },

    MELD({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ACT') throw new IllegalMove('Draw first');
      const idxs = (payload as { cards: number[] }).cards;
      const hand = handOf(s, seat);
      if (new Set(idxs).size !== idxs.length || idxs.some((i) => !hand[i])) {
        throw new IllegalMove('Bad card selection');
      }
      const cards = idxs.map((i) => hand[i]!);
      const type = classifyMeld(cards);
      if (!type) throw new IllegalMove('Not a valid set or run');
      // remove from hand (descending index order)
      [...idxs].sort((a, b) => b - a).forEach((i) => hand.splice(i, 1));
      pub.melds.push({ cards, type });
      pub.lastEvent = `melded a ${type}`;
      refreshCounts(s);
      checkWin(s, seat);
    },

    LAYOFF({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ACT') throw new IllegalMove('Draw first');
      const { card: cardIdx, meld: meldIdx } = payload as { card: number; meld: number };
      const hand = handOf(s, seat);
      const card = hand[cardIdx];
      const meld = pub.melds[meldIdx];
      if (!card || !meld) throw new IllegalMove('Bad lay-off');
      if (!canLayOff(meld, card)) throw new IllegalMove("That card doesn't fit that meld");
      hand.splice(cardIdx, 1);
      meld.cards.push(card);
      // keep runs sorted for display
      if (meld.type === 'run') {
        const aceHigh = meld.cards.some((c) => c.rank === 13) && meld.cards.some((c) => c.rank === 1);
        meld.cards.sort((a, b) => {
          const ra = aceHigh && a.rank === 1 ? 14 : a.rank;
          const rb = aceHigh && b.rank === 1 ? 14 : b.rank;
          return ra - rb;
        });
      }
      pub.lastEvent = 'laid off a card';
      refreshCounts(s);
      checkWin(s, seat);
    },

    DISCARD({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (pub.phase !== 'ACT') throw new IllegalMove('Draw first');
      const idx = (payload as { card: number }).card;
      const hand = handOf(s, seat);
      const card = hand[idx];
      if (!card) throw new IllegalMove('No such card');
      hand.splice(idx, 1);
      hiddenOf(s).discard.push(card);
      pub.lastEvent = 'discarded';
      refreshCounts(s);
      if (!checkWin(s, seat)) {
        pub.phase = 'DRAW';
        pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
      }
    },
  },

  legalMoves(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.winner !== null || seat !== currentSeat(pub)) return [];
    if (pub.phase === 'DRAW') {
      const moves: RummyMove[] = [{ kind: 'DRAW', source: 'stock' }];
      if (pub.discardTop) moves.push({ kind: 'DRAW', source: 'discard' });
      return moves;
    }
    const hand = handOf(s, seat);
    const moves: RummyMove[] = [];
    for (const cards of findMeldCandidates(hand)) {
      moves.push({ kind: 'MELD', cards });
    }
    hand.forEach((card, i) => {
      pub.melds.forEach((meld, m) => {
        if (canLayOff(meld, card)) moves.push({ kind: 'LAYOFF', card: i, meld: m });
      });
      moves.push({ kind: 'DISCARD', card: i });
    });
    return moves;
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  view(state, viewer) {
    const s = state as State;
    const pub = s.public;
    if (viewer === 'SPECTATOR' || !(viewer in s.private) || viewer === HIDDEN_ZONE) {
      return { ...pub, hand: null };
    }
    return { ...pub, hand: handOf(s, viewer as Seat) };
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (currentSeat(pub) !== seat) return;
    // if mid-turn (already drew), auto-discard the drawn (last) card
    if (pub.phase === 'ACT') {
      const hand = handOf(s, seat);
      const card = hand.pop();
      if (card) hiddenOf(s).discard.push(card);
      refreshCounts(s);
    }
    pub.phase = 'DRAW';
    pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    // hand returns under the stock
    const hand = handOf(s, seat);
    hiddenOf(s).stock.unshift(...hand);
    hand.length = 0;
    delete s.private[seat];
    const wasCurrent = currentSeat(pub) === seat;
    const next = wasCurrent ? pub.order[(pub.turnIndex + 1) % pub.order.length] : currentSeat(pub);
    pub.order.splice(idx, 1);
    delete pub.handCounts[seat];
    if (pub.order.length > 0) {
      const ni = pub.order.indexOf(next as Seat);
      pub.turnIndex = ni === -1 ? 0 : ni;
      if (wasCurrent) pub.phase = 'DRAW';
    }
    refreshCounts(s);
    if (pub.order.length === 1) pub.winner = pub.order[0] as Seat;
  },
};
