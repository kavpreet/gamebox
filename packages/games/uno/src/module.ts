import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import {
  buildClassicDeck,
  buildFlipDeck,
  faceOf,
  isWildFace,
  type UnoCard,
  type UnoColor,
  type Face,
} from './cards.js';

/**
 * UNO and UNO Flip on one implementation. The public zone carries the discard
 * top, current color, direction and hand COUNTS; each seat's private zone
 * carries their actual hand — the view() projection is what keeps the TV and
 * other players from ever seeing card faces (plan §2's key milestone).
 *
 * Deliberate simplifications: no Wild-Draw-4 challenge, drawn card may be
 * played immediately or the turn passes (no keep-and-play-something-else).
 * The UNO call itself happens out loud at the table; the app enforces it:
 * a one-card player may tap DECLARE_UNO to become safe, and anyone may
 * CATCH_UNO an undeclared one-card player for a 2-card penalty.
 */

export interface UnoPublic {
  variant: 'uno' | 'uno-flip';
  side: 'light' | 'dark';
  discardTop: Face | null;
  discardCount: number;
  currentColor: UnoColor | null;
  direction: 1 | -1;
  order: Seat[];
  turnIndex: number;
  /** phase: normal turn, or the just-drew-may-play-it window */
  phase: 'PLAY' | 'PLAY_DRAWN_OR_PASS';
  handCounts: Record<Seat, number>;
  drawPileSize: number;
  lastEvent: string | null;
  /** who the last event is about (drives "Alice drew a card" lines in the UI) */
  lastEventSeat: Seat | null;
  /** the other seat involved (e.g. who got caught), for UI naming */
  lastEventTarget: Seat | null;
  /** seats that declared UNO while on one card — safe from CATCH_UNO */
  unoDeclared: Seat[];
  winner: Seat | null;
}

export interface UnoPrivate {
  hand: UnoCard[];
}

export type UnoMove =
  | { kind: 'PLAY'; card: number; chooseColor?: UnoColor }
  | { kind: 'DRAW' }
  | { kind: 'PASS' }
  | { kind: 'DECLARE_UNO' }
  | { kind: 'CATCH_UNO'; target: Seat };

interface Hidden {
  drawPile: UnoCard[];
  discard: UnoCard[];
}

/**
 * The draw/discard piles live inside a reserved private "seat" (-1) — server-
 * side state no real seat ever sees; view() never projects it to anyone.
 */
const HIDDEN_ZONE = -1 as Seat;

type State = GameState<UnoPublic, UnoPrivate | Hidden>;

function hiddenOf(state: State): Hidden {
  return state.private[HIDDEN_ZONE] as Hidden;
}

function handOf(state: State, seat: Seat): UnoCard[] {
  return (state.private[seat] as UnoPrivate).hand;
}

function currentSeat(pub: UnoPublic): Seat {
  return pub.order[pub.turnIndex] as Seat;
}

function stepTurn(pub: UnoPublic, steps = 1): void {
  const n = pub.order.length;
  pub.turnIndex = (((pub.turnIndex + pub.direction * steps) % n) + n) % n;
}

function refreshCounts(state: State): void {
  const pub = state.public;
  for (const seat of pub.order) {
    pub.handCounts[seat] = handOf(state, seat).length;
  }
  pub.drawPileSize = hiddenOf(state).drawPile.length;
  pub.discardCount = hiddenOf(state).discard.length;
  // an UNO declaration only holds while that player still has exactly 1 card
  pub.unoDeclared = pub.unoDeclared.filter((s) => pub.handCounts[s] === 1);
}

/** Seats that hold exactly one card and haven't declared UNO — fair game. */
function catchableSeats(state: State): Seat[] {
  const pub = state.public;
  return pub.order.filter(
    (s) => handOf(state, s).length === 1 && !pub.unoDeclared.includes(s),
  );
}

function drawCards(state: State, seat: Seat, count: number, rng: SeededRandom): UnoCard[] {
  const hidden = hiddenOf(state);
  const drawn: UnoCard[] = [];
  for (let i = 0; i < count; i++) {
    if (hidden.drawPile.length === 0) {
      // reshuffle discard (except top) into the draw pile
      if (hidden.discard.length <= 1) break; // nothing left anywhere — draw fizzles
      const top = hidden.discard.pop()!;
      hidden.drawPile = rng.shuffle(hidden.discard);
      hidden.discard = [top];
    }
    drawn.push(hidden.drawPile.pop()!);
  }
  handOf(state, seat).push(...drawn);
  return drawn;
}

function canPlayFace(pub: UnoPublic, face: Face): boolean {
  if (isWildFace(face)) return true;
  if (pub.currentColor && face.color === pub.currentColor) return true;
  if (pub.discardTop && face.value === pub.discardTop.value) return true;
  return false;
}

/** Applies the played face's effect. Returns how many turn-steps to advance. */
function applyEffect(state: State, seat: Seat, face: Face, chooseColor: UnoColor | undefined, rng: SeededRandom): number {
  const pub = state.public;

  if (isWildFace(face)) {
    if (!chooseColor) throw new IllegalMove('Pick a color for the wild');
    pub.currentColor = chooseColor;
  } else {
    pub.currentColor = face.color as UnoColor;
  }

  switch (face.value) {
    case 'reverse':
      pub.direction = pub.direction === 1 ? -1 : 1;
      if (pub.order.length === 2) return 2; // acts as skip in 2p
      return 1;
    case 'skip':
      return 2;
    case 'skipall':
      return 0; // current player goes again
    case 'draw1': {
      const victim = nextSeat(pub, 1);
      drawCards(state, victim, 1, rng);
      return 2;
    }
    case 'draw2': {
      const victim = nextSeat(pub, 1);
      drawCards(state, victim, 2, rng);
      return 2;
    }
    case 'draw5': {
      const victim = nextSeat(pub, 1);
      drawCards(state, victim, 5, rng);
      return 2;
    }
    case 'wild4': {
      const victim = nextSeat(pub, 1);
      drawCards(state, victim, 4, rng);
      return 2;
    }
    case 'wilddraw2': {
      const victim = nextSeat(pub, 1);
      drawCards(state, victim, 2, rng);
      return 2;
    }
    case 'wilddrawcolor': {
      // victim draws until they draw a card of the chosen color
      const victim = nextSeat(pub, 1);
      for (let guard = 0; guard < 200; guard++) {
        const drawn = drawCards(state, victim, 1, rng);
        if (drawn.length === 0) break;
        if (faceOf(drawn[0]!, pub.side).color === pub.currentColor) break;
      }
      return 2;
    }
    case 'flip': {
      // UNO Flip's signature bulk mutation: every zone's effective face flips.
      pub.side = pub.side === 'light' ? 'dark' : 'light';
      // current color becomes the flipped discard-top's color; wilds need the
      // next player to just match anything, so use null → treat as wildcard
      const top = hiddenOf(state).discard[hiddenOf(state).discard.length - 1];
      if (top) {
        const f = faceOf(top, pub.side);
        pub.currentColor = isWildFace(f) ? null : (f.color as UnoColor);
      }
      return 1;
    }
    default:
      return 1;
  }
}

function nextSeat(pub: UnoPublic, steps: number): Seat {
  const n = pub.order.length;
  const idx = (((pub.turnIndex + pub.direction * steps) % n) + n) % n;
  return pub.order[idx] as Seat;
}

function finishPlay(state: State, seat: Seat, steps: number): void {
  const pub = state.public;
  refreshCounts(state);
  if (handOf(state, seat).length === 0) {
    pub.winner = seat;
    return;
  }
  pub.phase = 'PLAY';
  stepTurn(pub, steps);
}

function makeModule(variant: 'uno' | 'uno-flip'): GameModule<UnoPublic, UnoPrivate | Hidden, UnoMove> {
  return {
    slug: variant,
    displayName: variant === 'uno' ? 'UNO' : 'UNO Flip',
    description: variant === 'uno'
      ? 'Match colors and numbers, sling action cards, call UNO on your last card.'
      : 'Double-sided UNO: a Flip card swaps everyone to the brutal dark side.',
    rulesVersion: '1.1.0',
    minPlayers: 2,
    maxPlayers: 8,
    teams: 'none',

    setup(seats, rng) {
      const deck = rng.shuffle(variant === 'uno' ? buildClassicDeck() : buildFlipDeck(rng));
      const priv: Record<Seat, UnoPrivate | Hidden> = {};
      const handCounts: Record<Seat, number> = {};

      for (const { seat } of seats) {
        priv[seat] = { hand: deck.splice(0, 7) };
        handCounts[seat] = 7;
      }

      // flip a non-wild starting card
      let top = deck.pop()!;
      while (isWildFace(faceOf(top, 'light'))) {
        deck.unshift(top);
        top = deck.pop()!;
      }

      priv[HIDDEN_ZONE] = { drawPile: deck, discard: [top] };
      const topFace = faceOf(top, 'light');

      return {
        public: {
          variant,
          side: 'light',
          discardTop: topFace,
          discardCount: 1,
          currentColor: topFace.color as UnoColor,
          direction: 1,
          order: seats.map((s) => s.seat),
          turnIndex: 0,
          phase: 'PLAY',
          handCounts,
          drawPileSize: deck.length,
          lastEvent: null,
          lastEventSeat: null,
          lastEventTarget: null,
          unoDeclared: [],
          winner: null,
        },
        private: priv,
      };
    },

    activePlayers(state) {
      const s = state as State;
      if (s.public.winner !== null) return [];
      // While someone is catchable, EVERY seat may act (declare or catch) —
      // the UI derives whose actual turn it is from order/turnIndex instead.
      if (catchableSeats(s).length > 0) return [...s.public.order];
      return [currentSeat(s.public)];
    },

    moves: {
      PLAY({ state, seat, payload, rng }) {
        const s = state as State;
        const pub = s.public;
        if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
        const { card: cardIdx, chooseColor } = payload as { card: number; chooseColor?: UnoColor };
        const hand = handOf(s, seat);
        const card = hand[cardIdx];
        if (!card) throw new IllegalMove('No such card');
        const face = faceOf(card, pub.side);
        if (!canPlayFace(pub, face)) throw new IllegalMove("That card doesn't match");
        if (pub.phase === 'PLAY_DRAWN_OR_PASS' && cardIdx !== hand.length - 1) {
          throw new IllegalMove('You may only play the card you just drew (or pass)');
        }

        hand.splice(cardIdx, 1);
        hiddenOf(s).discard.push(card);
        const steps = applyEffect(s, seat, face, chooseColor, rng);
        pub.discardTop = faceOf(card, pub.side);
        pub.lastEvent = `played ${describeFace(face)}${hand.length === 1 ? ' — one card left!' : ''}`;
        pub.lastEventSeat = seat;
        finishPlay(s, seat, steps);
      },

      DRAW({ state, seat, rng }) {
        const s = state as State;
        const pub = s.public;
        if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
        if (pub.phase !== 'PLAY') throw new IllegalMove('You already drew');

        const drawn = drawCards(s, seat, 1, rng);
        refreshCounts(s);
        pub.lastEvent = 'drew a card';
        pub.lastEventSeat = seat;
        if (drawn.length > 0 && canPlayFace(pub, faceOf(drawn[0]!, pub.side))) {
          pub.phase = 'PLAY_DRAWN_OR_PASS';
        } else {
          pub.phase = 'PLAY';
          stepTurn(pub, 1);
        }
      },

      PASS({ state, seat }) {
        const s = state as State;
        const pub = s.public;
        if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
        if (pub.phase !== 'PLAY_DRAWN_OR_PASS') throw new IllegalMove('You must play or draw');
        pub.phase = 'PLAY';
        pub.lastEvent = 'passed';
        pub.lastEventSeat = seat;
        stepTurn(pub, 1);
      },

      DECLARE_UNO({ state, seat }) {
        const s = state as State;
        const pub = s.public;
        if (handOf(s, seat).length !== 1) throw new IllegalMove('You can only call UNO on one card');
        if (pub.unoDeclared.includes(seat)) throw new IllegalMove('You already called UNO');
        pub.unoDeclared.push(seat);
        pub.lastEvent = 'shouted UNO! 🔔';
        pub.lastEventSeat = seat;
      },

      CATCH_UNO({ state, seat, payload, rng }) {
        const s = state as State;
        const pub = s.public;
        const { target } = payload as { target: Seat };
        if (target === seat) throw new IllegalMove("You can't catch yourself");
        if (!pub.order.includes(target)) throw new IllegalMove('No such player');
        if (handOf(s, target).length !== 1) throw new IllegalMove('They are not on one card');
        if (pub.unoDeclared.includes(target)) throw new IllegalMove('They already called UNO');
        drawCards(s, target, 2, rng);
        refreshCounts(s);
        pub.lastEvent = 'CAUGHT_UNO'; // UI formats "X caught Y — +2!"
        pub.lastEventSeat = seat;
        pub.lastEventTarget = target;
      },
    },

    legalMoves(state, seat) {
      const s = state as State;
      const pub = s.public;
      if (pub.winner !== null) return [];

      // out-of-turn calls, available to everyone
      const calls: UnoMove[] = [];
      if (handOf(s, seat).length === 1 && !pub.unoDeclared.includes(seat)) {
        calls.push({ kind: 'DECLARE_UNO' });
      }
      for (const target of catchableSeats(s)) {
        if (target !== seat) calls.push({ kind: 'CATCH_UNO', target });
      }
      if (seat !== currentSeat(pub)) return calls;

      const hand = handOf(s, seat);
      const moves: UnoMove[] = [...calls];

      if (pub.phase === 'PLAY_DRAWN_OR_PASS') {
        const idx = hand.length - 1;
        const face = faceOf(hand[idx]!, pub.side);
        if (canPlayFace(pub, face)) {
          if (isWildFace(face)) {
            for (const c of ['R', 'Y', 'G', 'B'] as UnoColor[]) {
              moves.push({ kind: 'PLAY', card: idx, chooseColor: c });
            }
          } else {
            moves.push({ kind: 'PLAY', card: idx });
          }
        }
        moves.push({ kind: 'PASS' });
        return moves;
      }

      hand.forEach((card, idx) => {
        const face = faceOf(card, pub.side);
        if (canPlayFace(pub, face)) {
          if (isWildFace(face)) {
            for (const c of ['R', 'Y', 'G', 'B'] as UnoColor[]) {
              moves.push({ kind: 'PLAY', card: idx, chooseColor: c });
            }
          } else {
            moves.push({ kind: 'PLAY', card: idx });
          }
        }
      });
      moves.push({ kind: 'DRAW' });
      return moves;
    },

    endIf(state) {
      // The win lives in PRIVATE state (empty hand) — endIf gets full state (plan §4.1).
      if (state.public.winner !== null) return { winners: [state.public.winner] };
      return null;
    },

    view(state, viewer) {
      const s = state as State;
      const pub = s.public;
      // UNO Flip: everyone physically sees the INACTIVE side of every hand —
      // that's core strategy, so the projection carries it for all viewers.
      let backsides: Record<Seat, Face[]> | null = null;
      if (variant === 'uno-flip') {
        const off = pub.side === 'light' ? 'dark' : 'light';
        backsides = {};
        for (const seat of pub.order) {
          backsides[seat] = handOf(s, seat).map((card) => faceOf(card, off));
        }
      }
      if (viewer === 'SPECTATOR' || !(viewer in s.private) || viewer === HIDDEN_ZONE) {
        return { ...pub, hand: null, backsides };
      }
      // your own hand, with each card's current face + playability precomputed
      const hand = handOf(s, viewer as Seat).map((card) => faceOf(card, pub.side));
      return { ...pub, hand, backsides };
    },

    disconnectOptions() {
      return ['skip', 'pause', 'kick'];
    },

    onPlayerSkipped(state, seat) {
      const s = state as State;
      if (currentSeat(s.public) === seat) {
        s.public.phase = 'PLAY';
        stepTurn(s.public, 1);
      }
    },

    onPlayerRemoved(state, seat) {
      const s = state as State;
      const pub = s.public;
      const idx = pub.order.indexOf(seat);
      if (idx === -1) return;
      // their hand shuffles back under the draw pile (plan §4.1's UNO example)
      const hand = handOf(s, seat);
      hiddenOf(s).drawPile.unshift(...hand);
      hand.length = 0;
      delete s.private[seat];

      const wasCurrent = currentSeat(pub) === seat;
      const cur = wasCurrent ? nextSeat(pub, 1) : currentSeat(pub);
      pub.order.splice(idx, 1);
      delete pub.handCounts[seat];
      pub.unoDeclared = pub.unoDeclared.filter((s2) => s2 !== seat);
      if (pub.order.length > 0) {
        const ni = pub.order.indexOf(cur);
        pub.turnIndex = ni === -1 ? 0 : ni;
        if (wasCurrent) pub.phase = 'PLAY';
      }
      refreshCounts(s);
      if (pub.order.length === 1) {
        pub.winner = pub.order[0] as Seat;
      }
    },
  };
}

function describeFace(face: Face): string {
  const colors: Record<string, string> = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue', W: 'Wild' };
  const values: Record<string, string> = {
    skip: 'Skip', reverse: 'Reverse', draw1: 'Draw 1', draw2: 'Draw 2', draw5: 'Draw 5',
    skipall: 'Skip Everyone', flip: 'Flip', wild: 'Wild', wild4: 'Wild Draw 4',
    wilddraw2: 'Wild Draw 2', wilddrawcolor: 'Wild Draw Color',
  };
  const v = values[face.value] ?? face.value;
  return face.color === 'W' ? v : `${colors[face.color]} ${v}`;
}

export const uno = makeModule('uno');
export const unoFlip = makeModule('uno-flip');
