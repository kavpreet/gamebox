import type { GameModule, GameOptions, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
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
 * CATCH_UNO an undeclared one-card player for a card penalty.
 *
 * The house rules everyone insists are "the real rules" — stacking draw cards,
 * jump-ins, 7-0, drawing until you can play, no bluffing — are lobby options
 * (see `options` below), resolved into public `rules` at setup.
 */

/** House rules, resolved from the lobby options at setup. */
export interface UnoRules {
  stacking: boolean;
  jumpIn: boolean;
  sevenZero: boolean;
  drawToPlay: boolean;
  forcePlay: boolean;
  startingHand: number;
  unoPenalty: number;
}

export const UNO_STANDARD_RULES: UnoRules = {
  stacking: false,
  jumpIn: false,
  sevenZero: false,
  drawToPlay: false,
  forcePlay: false,
  startingHand: 7,
  unoPenalty: 2,
};

/** Draw cards that can be stacked onto each other, and what each is worth. */
const STACK_AMOUNT: Record<string, number> = {
  draw1: 1, draw2: 2, draw5: 5, wild4: 4, wilddraw2: 2,
};

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
  rules: UnoRules;
  /** stacking: cards the seat to act must eat unless they stack another one on */
  pendingDraw: number;
  /** the card value that can be stacked onto the pile right now */
  pendingDrawValue: string | null;
  winner: Seat | null;
}

export interface UnoPrivate {
  hand: UnoCard[];
}

export type UnoMove =
  | { kind: 'PLAY'; card: number; chooseColor?: UnoColor; swapWith?: Seat }
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

function rulesOf(pub: UnoPublic): UnoRules {
  return pub.rules ?? UNO_STANDARD_RULES;
}

function unoRules(options: GameOptions): UnoRules {
  const num = (id: keyof UnoRules, fallback: number) =>
    typeof options[id] === 'number' ? (options[id] as number) : fallback;
  return {
    stacking: options.stacking === true,
    jumpIn: options.jumpIn === true,
    sevenZero: options.sevenZero === true,
    drawToPlay: options.drawToPlay === true,
    forcePlay: options.forcePlay === true,
    startingHand: num('startingHand', 7),
    unoPenalty: num('unoPenalty', 2),
  };
}

function canPlayFace(pub: UnoPublic, face: Face): boolean {
  // Under a live draw stack the ONLY legal play is another card of the same
  // kind — everything else means eating the pile.
  if (pub.pendingDraw > 0) {
    return rulesOf(pub).stacking && face.value === pub.pendingDrawValue;
  }
  if (isWildFace(face)) return true;
  if (pub.currentColor && face.color === pub.currentColor) return true;
  if (pub.discardTop && face.value === pub.discardTop.value) return true;
  return false;
}

function sameCard(a: Face, b: Face): boolean {
  return a.color === b.color && a.value === b.value;
}

function hasPlayableCard(state: State, seat: Seat): boolean {
  const pub = state.public;
  return handOf(state, seat).some((card) => canPlayFace(pub, faceOf(card, pub.side)));
}

/** Seats that could jump in on the current discard top with an identical card. */
function jumpInSeats(state: State): Seat[] {
  const pub = state.public;
  const rules = rulesOf(pub);
  if (!rules.jumpIn || pub.phase !== 'PLAY' || pub.pendingDraw > 0) return [];
  const top = pub.discardTop;
  if (!top || isWildFace(top)) return [];
  return pub.order.filter(
    (s) =>
      s !== currentSeat(pub) &&
      handOf(state, s).some((card) => sameCard(faceOf(card, pub.side), top)),
  );
}

/**
 * A draw card resolves one of two ways: normally the next player eats it and
 * loses their turn; with stacking on it becomes a growing pile the next player
 * may pass along by playing the same kind of card.
 */
function applyDrawCard(state: State, value: string, amount: number, rng: SeededRandom): number {
  const pub = state.public;
  if (rulesOf(pub).stacking && STACK_AMOUNT[value] !== undefined) {
    pub.pendingDraw += amount;
    pub.pendingDrawValue = value;
    return 1; // the victim gets a turn — to stack, or to eat the pile
  }
  drawCards(state, nextSeat(pub, 1), amount, rng);
  return 2;
}

/** The 7-0 house rule: 7 swaps hands with a chosen player, 0 passes every hand along. */
function applySevenZero(state: State, seat: Seat, value: string, swapWith: Seat | undefined): void {
  const pub = state.public;
  if (value === '7') {
    const others = pub.order.filter((s) => s !== seat);
    const target = others.length === 1 ? others[0]! : swapWith;
    if (target === undefined) throw new IllegalMove('Pick who to swap hands with');
    if (!others.includes(target)) throw new IllegalMove('Cannot swap with that player');
    const mine = state.private[seat] as UnoPrivate;
    const theirs = state.private[target] as UnoPrivate;
    const tmp = mine.hand;
    mine.hand = theirs.hand;
    theirs.hand = tmp;
    pub.lastEventTarget = target;
    return;
  }
  // 0: everyone hands their cards to the next player in the direction of play
  const hands = pub.order.map((s) => (state.private[s] as UnoPrivate).hand);
  const n = pub.order.length;
  pub.order.forEach((s, i) => {
    const from = (((i - pub.direction) % n) + n) % n;
    (state.private[s] as UnoPrivate).hand = hands[from]!;
  });
}

/** Applies the played face's effect. Returns how many turn-steps to advance. */
function applyEffect(
  state: State,
  seat: Seat,
  face: Face,
  chooseColor: UnoColor | undefined,
  swapWith: Seat | undefined,
  rng: SeededRandom,
): number {
  const pub = state.public;

  if (isWildFace(face)) {
    if (!chooseColor) throw new IllegalMove('Pick a color for the wild');
    pub.currentColor = chooseColor;
  } else {
    pub.currentColor = face.color as UnoColor;
  }

  if (rulesOf(pub).sevenZero && (face.value === '7' || face.value === '0')) {
    applySevenZero(state, seat, face.value, swapWith);
    return 1;
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
    case 'draw1':
      return applyDrawCard(state, 'draw1', 1, rng);
    case 'draw2':
      return applyDrawCard(state, 'draw2', 2, rng);
    case 'draw5':
      return applyDrawCard(state, 'draw5', 5, rng);
    case 'wild4':
      return applyDrawCard(state, 'wild4', 4, rng);
    case 'wilddraw2':
      return applyDrawCard(state, 'wilddraw2', 2, rng);
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
  // 7-0 can hand someone else an empty hand — whoever ends up with no cards wins.
  const emptied = pub.order.find((s) => handOf(state, s).length === 0);
  if (emptied !== undefined) {
    pub.winner = emptied;
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
    rulesVersion: '1.2.0',
    minPlayers: 2,
    maxPlayers: 8,
    teams: 'none',

    options: [
      {
        id: 'stacking',
        kind: 'toggle',
        label: 'Stacking draw cards',
        description: 'Hit with a +2? Play your own +2 to pass a growing pile to the next player.',
        default: false,
      },
      {
        id: 'jumpIn',
        kind: 'toggle',
        label: 'Jump-in',
        description: 'Holding the exact same card as the discard? Slam it down out of turn — play continues from you.',
        default: false,
      },
      {
        id: 'sevenZero',
        kind: 'toggle',
        label: '7-0 swaps',
        description: 'Play a 7 to swap hands with someone; play a 0 and everyone passes their hand along.',
        default: false,
      },
      {
        id: 'drawToPlay',
        kind: 'toggle',
        label: 'Draw until playable',
        description: 'Drawing keeps going until you turn up a card you can play.',
        default: false,
      },
      {
        id: 'forcePlay',
        kind: 'toggle',
        label: 'No bluffing',
        description: 'If you hold a playable card you must play it — no sneaky drawing.',
        default: false,
      },
      {
        id: 'startingHand',
        kind: 'number',
        label: 'Cards dealt',
        description: 'How many cards everyone starts with.',
        default: 7,
        min: 3,
        max: 12,
      },
      {
        id: 'unoPenalty',
        kind: 'number',
        label: 'Caught-without-UNO penalty',
        description: 'Cards drawn when someone catches you sitting on one card.',
        default: 2,
        min: 1,
        max: 6,
      },
    ],

    setup(seats, rng, options) {
      const deck = rng.shuffle(variant === 'uno' ? buildClassicDeck() : buildFlipDeck(rng));
      const priv: Record<Seat, UnoPrivate | Hidden> = {};
      const handCounts: Record<Seat, number> = {};
      const rules = unoRules(options);

      for (const { seat } of seats) {
        priv[seat] = { hand: deck.splice(0, rules.startingHand) };
        handCounts[seat] = rules.startingHand;
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
          rules,
          pendingDraw: 0,
          pendingDrawValue: null,
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
      const jumpers = jumpInSeats(s);
      if (jumpers.length > 0) return [currentSeat(s.public), ...jumpers];
      return [currentSeat(s.public)];
    },

    moves: {
      PLAY({ state, seat, payload, rng }) {
        const s = state as State;
        const pub = s.public;
        const { card: cardIdx, chooseColor, swapWith } = payload as {
          card: number;
          chooseColor?: UnoColor;
          swapWith?: Seat;
        };
        const hand = handOf(s, seat);
        const card = hand[cardIdx];
        if (!card) throw new IllegalMove('No such card');
        const face = faceOf(card, pub.side);
        let jumpedIn = false;

        if (seat !== currentSeat(pub)) {
          // Jump-in: an identical card, slammed down out of turn. Play then
          // continues from the jumper, so they take over the turn pointer.
          if (!jumpInSeats(s).includes(seat)) throw new IllegalMove('Not your turn');
          if (!pub.discardTop || !sameCard(face, pub.discardTop)) {
            throw new IllegalMove('Jump-in needs the exact same card');
          }
          pub.turnIndex = pub.order.indexOf(seat);
          jumpedIn = true;
        } else {
          if (!canPlayFace(pub, face)) {
            throw new IllegalMove(
              pub.pendingDraw > 0
                ? `Only another ${describeValue(pub.pendingDrawValue!)} stacks — otherwise draw ${pub.pendingDraw}`
                : "That card doesn't match",
            );
          }
          if (pub.phase === 'PLAY_DRAWN_OR_PASS' && cardIdx !== hand.length - 1) {
            throw new IllegalMove('You may only play the card you just drew (or pass)');
          }
        }

        hand.splice(cardIdx, 1);
        hiddenOf(s).discard.push(card);
        const steps = applyEffect(s, seat, face, chooseColor, swapWith, rng);
        pub.discardTop = faceOf(card, pub.side);
        const stacked = pub.pendingDraw > 0 ? ` — +${pub.pendingDraw} and counting!` : '';
        pub.lastEvent = `${jumpedIn ? 'jumped in with' : 'played'} ${describeFace(face)}${
          stacked || (hand.length === 1 ? ' — one card left!' : '')
        }`;
        pub.lastEventSeat = seat;
        finishPlay(s, seat, steps);
      },

      DRAW({ state, seat, rng }) {
        const s = state as State;
        const pub = s.public;
        const rules = rulesOf(pub);
        if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
        if (pub.phase !== 'PLAY') throw new IllegalMove('You already drew');

        // Eating a stacked draw pile: take the lot, turn over.
        if (pub.pendingDraw > 0) {
          const owed = pub.pendingDraw;
          drawCards(s, seat, owed, rng);
          pub.pendingDraw = 0;
          pub.pendingDrawValue = null;
          refreshCounts(s);
          pub.lastEvent = `ate the pile — drew ${owed} cards`;
          pub.lastEventSeat = seat;
          pub.phase = 'PLAY';
          stepTurn(pub, 1);
          return;
        }

        if (rules.forcePlay && hasPlayableCard(s, seat)) {
          throw new IllegalMove('You have a playable card — no bluffing!');
        }

        // Draw-until-playable turns one draw into as many as it takes.
        const maxDraws = rules.drawToPlay ? 40 : 1;
        let last: UnoCard | undefined;
        let count = 0;
        for (let i = 0; i < maxDraws; i++) {
          const drawn = drawCards(s, seat, 1, rng);
          if (drawn.length === 0) break; // piles exhausted
          last = drawn[0];
          count += 1;
          if (canPlayFace(pub, faceOf(drawn[0]!, pub.side))) break;
        }
        refreshCounts(s);
        pub.lastEvent = count > 1 ? `drew ${count} cards` : 'drew a card';
        pub.lastEventSeat = seat;
        if (last && canPlayFace(pub, faceOf(last, pub.side))) {
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
        drawCards(s, target, rulesOf(pub).unoPenalty, rng);
        refreshCounts(s);
        pub.lastEvent = 'CAUGHT_UNO'; // UI formats "X caught Y — +2!"
        pub.lastEventSeat = seat;
        pub.lastEventTarget = target;
      },
    },

    legalMoves(state, seat) {
      const s = state as State;
      const pub = s.public;
      const rules = rulesOf(pub);
      if (pub.winner !== null) return [];

      const hand = handOf(s, seat);

      /** Every way of playing hand[idx] — wilds fan out by color, 7s by swap target. */
      const playsOf = (idx: number): UnoMove[] => {
        const face = faceOf(hand[idx]!, pub.side);
        const colors = isWildFace(face) ? (['R', 'Y', 'G', 'B'] as UnoColor[]) : [undefined];
        const swaps =
          rules.sevenZero && face.value === '7' && pub.order.length > 2
            ? pub.order.filter((t) => t !== seat)
            : [undefined];
        const out: UnoMove[] = [];
        for (const chooseColor of colors) {
          for (const swapWith of swaps) {
            out.push({ kind: 'PLAY', card: idx, ...(chooseColor ? { chooseColor } : {}), ...(swapWith !== undefined ? { swapWith } : {}) });
          }
        }
        return out;
      };

      // out-of-turn calls, available to everyone
      const calls: UnoMove[] = [];
      if (hand.length === 1 && !pub.unoDeclared.includes(seat)) {
        calls.push({ kind: 'DECLARE_UNO' });
      }
      for (const target of catchableSeats(s)) {
        if (target !== seat) calls.push({ kind: 'CATCH_UNO', target });
      }

      if (seat !== currentSeat(pub)) {
        // jump-in: only the exact same card as the discard top
        if (jumpInSeats(s).includes(seat) && pub.discardTop) {
          hand.forEach((card, idx) => {
            if (sameCard(faceOf(card, pub.side), pub.discardTop!)) calls.push(...playsOf(idx));
          });
        }
        return calls;
      }

      const moves: UnoMove[] = [...calls];

      if (pub.phase === 'PLAY_DRAWN_OR_PASS') {
        const idx = hand.length - 1;
        if (canPlayFace(pub, faceOf(hand[idx]!, pub.side))) moves.push(...playsOf(idx));
        moves.push({ kind: 'PASS' });
        return moves;
      }

      hand.forEach((card, idx) => {
        if (canPlayFace(pub, faceOf(card, pub.side))) moves.push(...playsOf(idx));
      });
      // "No bluffing" removes the option to draw past a playable card; a live
      // draw pile is always eatable.
      if (pub.pendingDraw > 0 || !rules.forcePlay || !hasPlayableCard(s, seat)) {
        moves.push({ kind: 'DRAW' });
      }
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
      const pub = s.public;
      if (currentSeat(pub) !== seat) return;
      // A stacked draw pile dies with the skipped turn rather than rolling on
      // to an innocent next player (auto-skip has no rng to deal cards with).
      if (pub.pendingDraw > 0) {
        pub.pendingDraw = 0;
        pub.pendingDrawValue = null;
        refreshCounts(s);
      }
      pub.phase = 'PLAY';
      stepTurn(pub, 1);
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
        if (wasCurrent) {
          pub.phase = 'PLAY';
          pub.pendingDraw = 0; // the pile they owed leaves with them
          pub.pendingDrawValue = null;
        }
      }
      refreshCounts(s);
      if (pub.order.length === 1) {
        pub.winner = pub.order[0] as Seat;
      }
    },
  };
}

const VALUE_NAMES: Record<string, string> = {
  skip: 'Skip', reverse: 'Reverse', draw1: 'Draw 1', draw2: 'Draw 2', draw5: 'Draw 5',
  skipall: 'Skip Everyone', flip: 'Flip', wild: 'Wild', wild4: 'Wild Draw 4',
  wilddraw2: 'Wild Draw 2', wilddrawcolor: 'Wild Draw Color',
};

function describeValue(value: string): string {
  return VALUE_NAMES[value] ?? value;
}

function describeFace(face: Face): string {
  const colors: Record<string, string> = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue', W: 'Wild' };
  const v = describeValue(face.value);
  return face.color === 'W' ? v : `${colors[face.color]} ${v}`;
}

export const uno = makeModule('uno');
export const unoFlip = makeModule('uno-flip');
