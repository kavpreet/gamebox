import type { GameModule, GameState, Seat } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import {
  ROUTES, ROUTE_BY_ID, ROUTE_POINTS, TICKETS, TRAIN_COLORS,
  type RouteColor, type TicketDef, type TrainColor,
} from './map.js';

/**
 * Ticket to Ride — claim train routes across the map, complete secret
 * destination tickets, longest continuous path earns a 10-point bonus.
 * Turn = ONE of: claim a route / draw 2 train cards (a face-up locomotive
 * costs the whole turn) / draw destination tickets (keep at least 1).
 * Endgame: when a player ends a turn with ≤2 trains, everyone (including
 * them) gets one final turn, then scoring.
 * Deliberate simplifications: no double routes, 30 trains per player
 * (fits the 61-route map), sealed ticket choices resolve instantly.
 */

export type Card = TrainColor | 'loco';

export interface TicketView extends TicketDef {
  completed: boolean;
}

export interface TtrPublic {
  faceUp: Card[];
  deckSize: number;
  discardSize: number;
  ticketDeckSize: number;
  /** routeId → seat that claimed it */
  claimed: Record<string, Seat>;
  trainsLeft: Record<Seat, number>;
  handCounts: Record<Seat, number>;
  ticketCounts: Record<Seat, number>;
  /** publicly visible points from claimed routes */
  routeScores: Record<Seat, number>;
  order: Seat[];
  turnIndex: number;
  phase: 'INITIAL_TICKETS' | 'PLAY' | 'DONE';
  /** train cards drawn so far this turn (0..2) */
  drawnThisTurn: number;
  /** seats still holding a ticket offer to resolve */
  choosing: Seat[];
  endTriggeredBy: Seat | null;
  turnsRemaining: number | null;
  removed: Seat[];
  lastEvent: string | null;
  /** rolling action log, newest last — { seat, text }, seat null for neutral events */
  log: { seat: Seat | null; text: string }[];
  finalScores: Record<Seat, {
    route: number; tickets: number; longestPath: number; total: number; completedTickets: number;
  }> | null;
  longestPathOwners: Seat[];
}

export interface TtrPrivate {
  hand: Card[];
  tickets: TicketDef[];
  offer: TicketDef[] | null;
}

interface Hidden {
  trainDeck: Card[];
  trainDiscard: Card[];
  ticketDeck: TicketDef[];
}

/** Off-board zone holding the decks; view() never projects it to anyone. */
const HIDDEN_ZONE = -1 as Seat;

type State = GameState<TtrPublic, TtrPrivate | Hidden>;

export type TtrMove =
  | { kind: 'CHOOSE_TICKETS'; keep: number[] }
  | { kind: 'DRAW_BLIND' }
  | { kind: 'DRAW_FACEUP'; index: number }
  | { kind: 'CLAIM_ROUTE'; route: string; color?: TrainColor }
  | { kind: 'DRAW_TICKETS' };

export const TRAINS_PER_PLAYER = 30;

function hiddenOf(state: State): Hidden {
  return state.private[HIDDEN_ZONE] as Hidden;
}

function privOf(state: State, seat: Seat): TtrPrivate {
  return state.private[seat] as TtrPrivate;
}

function currentSeat(pub: TtrPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function drawFromDeck(hidden: Hidden, rngShuffle: <T>(x: T[]) => T[]): Card | null {
  if (hidden.trainDeck.length === 0 && hidden.trainDiscard.length > 0) {
    hidden.trainDeck = rngShuffle(hidden.trainDiscard);
    hidden.trainDiscard = [];
  }
  return hidden.trainDeck.pop() ?? null;
}

function refillFaceUp(pub: TtrPublic, hidden: Hidden, rngShuffle: <T>(x: T[]) => T[]): void {
  while (pub.faceUp.length < 5) {
    const c = drawFromDeck(hidden, rngShuffle);
    if (c === null) break;
    pub.faceUp.push(c);
  }
  // three locomotives showing → flush the market (bounded to avoid loco-heavy loops)
  let guard = 0;
  while (pub.faceUp.filter((c) => c === 'loco').length >= 3 && guard++ < 8) {
    hidden.trainDiscard.push(...pub.faceUp);
    pub.faceUp = [];
    while (pub.faceUp.length < 5) {
      const c = drawFromDeck(hidden, rngShuffle);
      if (c === null) break;
      pub.faceUp.push(c);
    }
  }
  pub.deckSize = hidden.trainDeck.length;
  pub.discardSize = hidden.trainDiscard.length;
}

function aliveSeats(pub: TtrPublic): Seat[] {
  return pub.order.filter((s) => !pub.removed.includes(s));
}

const LOG_LIMIT = 20;

function logEvent(pub: TtrPublic, seat: Seat | null, text: string): void {
  pub.log.push({ seat, text });
  if (pub.log.length > LOG_LIMIT) pub.log.splice(0, pub.log.length - LOG_LIMIT);
}

const NICE_CITY = (c: string) =>
  c.split('-').map((w) => (w === 'st' ? 'St' : w[0]!.toUpperCase() + w.slice(1))).join(' ');

/** Cards of `color` in hand plus locomotives cover `length`? */
export function canAfford(hand: Card[], color: TrainColor, length: number): boolean {
  const natural = hand.filter((c) => c === color).length;
  const locos = hand.filter((c) => c === 'loco').length;
  return natural + locos >= length;
}

/** Colors that could pay for a route (single color + locos; gray = any color). */
export function payableColors(hand: Card[], routeColor: RouteColor, length: number): TrainColor[] {
  const candidates = routeColor === 'gray' ? TRAIN_COLORS : [routeColor];
  return candidates.filter((c) => canAfford(hand, c, length));
}

function spendCards(hand: Card[], color: TrainColor, length: number): Card[] {
  const spent: Card[] = [];
  for (let need = length; need > 0; need--) {
    const i = hand.indexOf(color);
    if (i >= 0) {
      spent.push(...hand.splice(i, 1));
    } else {
      const j = hand.indexOf('loco');
      spent.push(...hand.splice(j, 1));
    }
  }
  return spent;
}

/** Cities connected for `seat` via its claimed routes, starting from `from`. */
function reachable(pub: TtrPublic, seat: Seat, from: string): Set<string> {
  const adj = new Map<string, string[]>();
  for (const [id, owner] of Object.entries(pub.claimed)) {
    if (owner !== seat) continue;
    const rt = ROUTE_BY_ID[id]!;
    (adj.get(rt.a) ?? adj.set(rt.a, []).get(rt.a)!).push(rt.b);
    (adj.get(rt.b) ?? adj.set(rt.b, []).get(rt.b)!).push(rt.a);
  }
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    for (const n of adj.get(queue.pop()!) ?? []) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen;
}

export function ticketCompleted(pub: TtrPublic, seat: Seat, t: TicketDef): boolean {
  return reachable(pub, seat, t.a).has(t.b);
}

/** Longest continuous path (sum of route lengths, edges used once) for a seat. */
export function longestPathLength(pub: TtrPublic, seat: Seat): number {
  const edges = Object.entries(pub.claimed)
    .filter(([, o]) => o === seat)
    .map(([id]) => ROUTE_BY_ID[id]!);
  if (edges.length === 0) return 0;
  const adj = new Map<string, { to: string; len: number; idx: number }[]>();
  edges.forEach((e, idx) => {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, len: e.length, idx });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, len: e.length, idx });
  });
  let best = 0;
  const used = new Array<boolean>(edges.length).fill(false);
  const dfs = (city: string, total: number): void => {
    best = Math.max(best, total);
    for (const e of adj.get(city) ?? []) {
      if (used[e.idx]) continue;
      used[e.idx] = true;
      dfs(e.to, total + e.len);
      used[e.idx] = false;
    }
  };
  for (const city of adj.keys()) dfs(city, 0);
  return best;
}

function finalize(state: State): void {
  const pub = state.public;
  pub.phase = 'DONE';
  logEvent(pub, null, 'All aboard terminated — final scoring! 🏆');
  const paths = new Map<Seat, number>();
  for (const s of pub.order) paths.set(s, longestPathLength(pub, s));
  const maxPath = Math.max(...aliveSeats(pub).map((s) => paths.get(s) ?? 0), 0);
  pub.longestPathOwners = maxPath > 0
    ? aliveSeats(pub).filter((s) => paths.get(s) === maxPath)
    : [];
  const scores: NonNullable<TtrPublic['finalScores']> = {};
  for (const s of pub.order) {
    const priv = privOf(state, s);
    let tickets = 0;
    let completedTickets = 0;
    for (const t of priv.tickets) {
      if (ticketCompleted(pub, s, t)) { tickets += t.points; completedTickets++; }
      else tickets -= t.points;
    }
    const longestPath = pub.longestPathOwners.includes(s) ? 10 : 0;
    const route = pub.routeScores[s] ?? 0;
    scores[s] = { route, tickets, longestPath, completedTickets, total: route + tickets + longestPath };
  }
  pub.finalScores = scores;
}

function endTurn(state: State): void {
  const pub = state.public;
  const seat = currentSeat(pub);
  pub.drawnThisTurn = 0;
  if (pub.turnsRemaining !== null) {
    pub.turnsRemaining -= 1;
  } else if ((pub.trainsLeft[seat] ?? 0) <= 2) {
    pub.endTriggeredBy = seat;
    pub.turnsRemaining = aliveSeats(pub).length; // everyone gets one last turn
    pub.lastEvent = 'Final round — everyone gets one more turn!';
    logEvent(pub, seat, `is almost out of trains — final round, one turn each! 🏁`);
  }
  if (pub.turnsRemaining !== null && pub.turnsRemaining <= 0) {
    finalize(state);
    return;
  }
  do {
    pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  } while (pub.removed.includes(currentSeat(pub)));
}

function resolveOffer(state: State, seat: Seat, keep: number[]): void {
  const pub = state.public;
  const priv = privOf(state, seat);
  const hidden = hiddenOf(state);
  const offer = priv.offer!;
  const kept = keep.map((i) => offer[i]!);
  const returned = offer.filter((_, i) => !keep.includes(i));
  priv.tickets.push(...kept);
  // draws come off the FRONT of ticketDeck, so the back is the bottom of the pile
  hidden.ticketDeck.push(...returned);
  priv.offer = null;
  pub.choosing = pub.choosing.filter((s) => s !== seat);
  pub.ticketCounts[seat] = priv.tickets.length;
  pub.ticketDeckSize = hidden.ticketDeck.length;
}

export const ticketToRide: GameModule<TtrPublic, TtrPrivate | Hidden, TtrMove> = {
  slug: 'ticket-to-ride',
  displayName: 'Ticket to Ride',
  rulesVersion: '1.1.0',
  minPlayers: 2,
  maxPlayers: 5,
  teams: 'none',

  setup(seats, rng) {
    const order = seats.map((s) => s.seat);
    const deck: Card[] = [];
    for (const c of TRAIN_COLORS) for (let i = 0; i < 12; i++) deck.push(c);
    for (let i = 0; i < 14; i++) deck.push('loco');
    const hidden: Hidden = {
      trainDeck: rng.shuffle(deck),
      trainDiscard: [],
      ticketDeck: rng.shuffle(TICKETS),
    };

    const priv: Record<Seat, TtrPrivate | Hidden> = { [HIDDEN_ZONE]: hidden };
    const pub: TtrPublic = {
      faceUp: [],
      deckSize: 0,
      discardSize: 0,
      ticketDeckSize: 0,
      claimed: {},
      trainsLeft: {},
      handCounts: {},
      ticketCounts: {},
      routeScores: {},
      order,
      turnIndex: 0,
      phase: 'INITIAL_TICKETS',
      drawnThisTurn: 0,
      choosing: [...order],
      endTriggeredBy: null,
      turnsRemaining: null,
      removed: [],
      lastEvent: null,
      log: [],
      finalScores: null,
      longestPathOwners: [],
    };

    for (const seat of order) {
      const hand = Array.from({ length: 4 }, () => hidden.trainDeck.pop()!);
      const offer = hidden.ticketDeck.splice(0, 3);
      priv[seat] = { hand, tickets: [], offer };
      pub.trainsLeft[seat] = TRAINS_PER_PLAYER;
      pub.handCounts[seat] = hand.length;
      pub.ticketCounts[seat] = 0;
      pub.routeScores[seat] = 0;
    }

    const state = { public: pub, private: priv };
    refillFaceUp(pub, hidden, (x) => rng.shuffle(x));
    pub.ticketDeckSize = hidden.ticketDeck.length;
    return state;
  },

  activePlayers(state: State) {
    const pub = state.public;
    if (pub.phase === 'DONE') return [];
    if (pub.phase === 'INITIAL_TICKETS') {
      return pub.choosing.filter((s) => !pub.removed.includes(s));
    }
    return [currentSeat(pub)];
  },

  moves: {
    CHOOSE_TICKETS({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      const priv = privOf(s, seat);
      if (!priv.offer) throw new IllegalMove('No tickets to choose from');
      const { keep } = payload as { keep: number[] };
      const minKeep = pub.phase === 'INITIAL_TICKETS' ? Math.min(2, priv.offer.length) : 1;
      if (!Array.isArray(keep) || new Set(keep).size !== keep.length
        || keep.some((i) => !Number.isInteger(i) || i < 0 || i >= priv.offer!.length)) {
        throw new IllegalMove('Bad ticket selection');
      }
      if (keep.length < minKeep) throw new IllegalMove(`Keep at least ${minKeep} ticket${minKeep > 1 ? 's' : ''}`);
      resolveOffer(s, seat, keep);
      logEvent(pub, seat, `kept ${keep.length} destination ticket${keep.length === 1 ? '' : 's'} 🎫`);
      if (pub.phase === 'INITIAL_TICKETS') {
        if (pub.choosing.filter((x) => !pub.removed.includes(x)).length === 0) {
          pub.phase = 'PLAY';
          pub.lastEvent = 'All aboard!';
        }
      } else {
        endTurn(s);
      }
    },

    DRAW_BLIND({ state, seat, rng }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'PLAY' || seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (privOf(s, seat).offer) throw new IllegalMove('Choose your tickets first');
      const hidden = hiddenOf(s);
      const card = drawFromDeck(hidden, (x) => rng.shuffle(x));
      if (card === null) throw new IllegalMove('The train deck is empty');
      const priv = privOf(s, seat);
      priv.hand.push(card);
      pub.handCounts[seat] = priv.hand.length;
      pub.deckSize = hidden.trainDeck.length;
      pub.discardSize = hidden.trainDiscard.length;
      pub.drawnThisTurn += 1;
      logEvent(pub, seat, 'drew a card from the deck');
      if (pub.drawnThisTurn >= 2) endTurn(s);
    },

    DRAW_FACEUP({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'PLAY' || seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (privOf(s, seat).offer) throw new IllegalMove('Choose your tickets first');
      const { index } = payload as { index: number };
      const card = pub.faceUp[index];
      if (card === undefined) throw new IllegalMove('No card there');
      if (card === 'loco' && pub.drawnThisTurn > 0) {
        throw new IllegalMove('A face-up locomotive must be your whole turn');
      }
      pub.faceUp.splice(index, 1);
      const priv = privOf(s, seat);
      priv.hand.push(card);
      pub.handCounts[seat] = priv.hand.length;
      refillFaceUp(pub, hiddenOf(s), (x) => rng.shuffle(x));
      logEvent(pub, seat, card === 'loco' ? 'took the locomotive 🌈' : `took a ${card} card`);
      if (card === 'loco') {
        endTurn(s);
      } else {
        pub.drawnThisTurn += 1;
        if (pub.drawnThisTurn >= 2) endTurn(s);
      }
    },

    CLAIM_ROUTE({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'PLAY' || seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (privOf(s, seat).offer) throw new IllegalMove('Choose your tickets first');
      if (pub.drawnThisTurn > 0) throw new IllegalMove('You already drew cards this turn');
      const { route, color } = payload as { route: string; color?: TrainColor };
      const def = ROUTE_BY_ID[route];
      if (!def) throw new IllegalMove('Unknown route');
      if (pub.claimed[route] !== undefined) throw new IllegalMove('Route already claimed');
      if ((pub.trainsLeft[seat] ?? 0) < def.length) throw new IllegalMove('Not enough trains');
      const priv = privOf(s, seat);
      const options = payableColors(priv.hand, def.color, def.length);
      const pay = def.color === 'gray' ? color : def.color;
      if (!pay || !options.includes(pay)) throw new IllegalMove('You cannot pay for that route');
      const spent = spendCards(priv.hand, pay, def.length);
      hiddenOf(s).trainDiscard.push(...spent);
      pub.discardSize = hiddenOf(s).trainDiscard.length;
      pub.handCounts[seat] = priv.hand.length;
      pub.claimed[route] = seat;
      pub.trainsLeft[seat] = (pub.trainsLeft[seat] ?? 0) - def.length;
      pub.routeScores[seat] = (pub.routeScores[seat] ?? 0) + (ROUTE_POINTS[def.length] ?? 0);
      pub.lastEvent = `${def.a} — ${def.b} claimed (+${ROUTE_POINTS[def.length]})`;
      logEvent(pub, seat, `built ${NICE_CITY(def.a)} — ${NICE_CITY(def.b)} (+${ROUTE_POINTS[def.length]}) 🚂`);
      endTurn(s);
    },

    DRAW_TICKETS({ state, seat }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'PLAY' || seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
      if (privOf(s, seat).offer) throw new IllegalMove('Choose your tickets first');
      if (pub.drawnThisTurn > 0) throw new IllegalMove('You already drew cards this turn');
      const hidden = hiddenOf(s);
      if (hidden.ticketDeck.length === 0) throw new IllegalMove('No destination tickets left');
      const priv = privOf(s, seat);
      priv.offer = hidden.ticketDeck.splice(0, 3);
      pub.choosing.push(seat);
      pub.ticketDeckSize = hidden.ticketDeck.length;
      logEvent(pub, seat, 'is drawing destination tickets…');
      // turn ends when CHOOSE_TICKETS resolves
    },
  },

  legalMoves(state: State, seat) {
    const pub = state.public;
    if (pub.phase === 'DONE') return [];
    const priv = privOf(state, seat);
    if (priv.offer) {
      return [{ kind: 'CHOOSE_TICKETS', keep: priv.offer.map((_, i) => i) }];
    }
    if (pub.phase !== 'PLAY' || seat !== currentSeat(pub)) return [];
    const moves: TtrMove[] = [];
    if (pub.drawnThisTurn === 0) {
      for (const def of ROUTES) {
        if (pub.claimed[def.id] !== undefined) continue;
        if ((pub.trainsLeft[seat] ?? 0) < def.length) continue;
        for (const c of payableColors(priv.hand, def.color, def.length)) {
          moves.push({ kind: 'CLAIM_ROUTE', route: def.id, color: c });
        }
      }
      if (hiddenOf(state).ticketDeck.length > 0) moves.push({ kind: 'DRAW_TICKETS' });
    }
    const hidden = hiddenOf(state);
    if (hidden.trainDeck.length + hidden.trainDiscard.length > 0) {
      moves.push({ kind: 'DRAW_BLIND' });
    }
    pub.faceUp.forEach((c, index) => {
      if (c === 'loco' && pub.drawnThisTurn > 0) return;
      moves.push({ kind: 'DRAW_FACEUP', index });
    });
    return moves;
  },

  endIf(state: State) {
    const pub = state.public;
    if (pub.phase !== 'DONE' || !pub.finalScores) return null;
    const alive = aliveSeats(pub);
    const top = Math.max(...alive.map((s) => pub.finalScores![s]!.total));
    return { winners: alive.filter((s) => pub.finalScores![s]!.total === top) };
  },

  view(state: State, viewer) {
    const pub = state.public;
    if (viewer === 'SPECTATOR') return pub;
    const priv = state.private[viewer] as TtrPrivate | undefined;
    if (!priv || !('hand' in priv)) return pub;
    return {
      ...pub,
      hand: priv.hand,
      tickets: priv.tickets.map((t): TicketView => ({ ...t, completed: ticketCompleted(pub, viewer, t) })),
      offer: priv.offer,
    };
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state: State, seat) {
    const pub = state.public;
    const priv = privOf(state, seat);
    if (priv.offer) {
      const minKeep = pub.phase === 'INITIAL_TICKETS' ? Math.min(2, priv.offer.length) : 1;
      resolveOffer(state, seat, priv.offer.map((_, i) => i).slice(0, minKeep));
      if (pub.phase === 'INITIAL_TICKETS') {
        if (pub.choosing.filter((x) => !pub.removed.includes(x)).length === 0) pub.phase = 'PLAY';
        return;
      }
      endTurn(state);
      return;
    }
    if (pub.phase === 'PLAY' && currentSeat(pub) === seat) endTurn(state);
  },

  onPlayerRemoved(state: State, seat) {
    const pub = state.public;
    if (!pub.removed.includes(seat)) pub.removed.push(seat);
    const priv = privOf(state, seat);
    if (priv.offer) {
      // return their offer to the bottom of the deck; they keep nothing
      hiddenOf(state).ticketDeck.push(...priv.offer);
      priv.offer = null;
      pub.choosing = pub.choosing.filter((s) => s !== seat);
      pub.ticketDeckSize = hiddenOf(state).ticketDeck.length;
    }
    if (pub.phase === 'INITIAL_TICKETS') {
      if (pub.choosing.filter((x) => !pub.removed.includes(x)).length === 0) pub.phase = 'PLAY';
      return;
    }
    if (pub.phase === 'PLAY' && currentSeat(pub) === seat) {
      pub.drawnThisTurn = 0;
      do {
        pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
      } while (pub.removed.includes(currentSeat(pub)) && aliveSeats(pub).length > 0);
    }
  },
};
