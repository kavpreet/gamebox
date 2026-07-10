import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import { CITIES, CITY_NAMES, DISEASES, type Disease } from './map.js';

/**
 * Pandemic — cooperative, 2–4 players, introductory difficulty (4 epidemics).
 * Loss triggers (any → cooperative loss): 8th outbreak, a disease's 24 cubes
 * exhausted, player deck exhausted. Win: all four diseases cured.
 *
 * Roles: Medic (treat removes all cubes; auto-clears cured diseases in city),
 * Scientist (cure with 4 cards), Operations Expert (build without discarding),
 * Generalist (5 actions). Player hands are open information (as in the real
 * game) — only the deck orders are hidden, so the whole state is public and
 * the decks live server-side in a hidden zone.
 *
 * Simplifications: no event cards, no Researcher-style special share.
 */

export type Role = 'medic' | 'scientist' | 'operations-expert' | 'generalist';
const ROLES: Role[] = ['medic', 'scientist', 'operations-expert', 'generalist'];

export type PlayerCard = { kind: 'city'; city: string } | { kind: 'epidemic' };

export interface PandemicPlayer {
  role: Role;
  city: string;
  hand: PlayerCard[]; // open info
}

export interface PandemicPublic {
  players: Record<Seat, PandemicPlayer>;
  order: Seat[];
  turnIndex: number;
  actionsLeft: number;
  phase: 'ACTIONS' | 'DISCARD';
  /** who must discard down to 7 (may be a non-current player after SHARE) */
  discardSeat: Seat | null;
  cubes: Record<string, Partial<Record<Disease, number>>>;
  stations: string[];
  cured: Record<Disease, boolean>;
  eradicated: Record<Disease, boolean>;
  cubesLeft: Record<Disease, number>;
  outbreaks: number;
  infectionRateIndex: number;
  playerDeckSize: number;
  infectionDiscard: string[];
  lastEvent: string | null;
  result: 'won' | 'lost' | null;
  lossReason: string | null;
}

interface Hidden {
  playerDeck: PlayerCard[];
  infectionDeck: string[];
}

export type PandemicPrivate = Record<string, never>;

export type PandemicMove =
  | { kind: 'DRIVE'; city: string }
  | { kind: 'DIRECT_FLIGHT'; city: string }
  | { kind: 'CHARTER_FLIGHT'; city: string }
  | { kind: 'SHUTTLE'; city: string }
  | { kind: 'BUILD' }
  | { kind: 'TREAT'; disease: Disease }
  | { kind: 'SHARE'; withSeat: Seat; direction: 'give' | 'take' }
  | { kind: 'CURE'; disease: Disease; cards: number[] }
  | { kind: 'PASS' }
  | { kind: 'DISCARD'; card: number };

const HIDDEN_ZONE = -1 as Seat;
const INFECTION_RATES = [2, 2, 2, 3, 3, 4, 4];
const HAND_LIMIT = 7;
const EPIDEMICS = 4;

type State = GameState<PandemicPublic, PandemicPrivate | Hidden>;

function hiddenOf(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}

function currentSeat(pub: PandemicPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function cubesAt(pub: PandemicPublic, city: string, d: Disease): number {
  return pub.cubes[city]?.[d] ?? 0;
}

function addCube(pub: PandemicPublic, city: string, d: Disease, outbreakChain: Set<string>): void {
  if (pub.result) return;
  if (pub.eradicated[d]) return;
  const current = cubesAt(pub, city, d);
  if (current >= 3) {
    // outbreak!
    if (outbreakChain.has(city)) return;
    outbreakChain.add(city);
    pub.outbreaks += 1;
    pub.lastEvent = `OUTBREAK in ${city}!`;
    if (pub.outbreaks >= 8) {
      pub.result = 'lost';
      pub.lossReason = '8th outbreak';
      return;
    }
    for (const n of CITIES[city]!.neighbors) {
      addCube(pub, n, d, outbreakChain);
      if (pub.result) return;
    }
    return;
  }
  if (pub.cubesLeft[d] <= 0) {
    pub.result = 'lost';
    pub.lossReason = `${d} cubes exhausted`;
    return;
  }
  pub.cubesLeft[d] -= 1;
  (pub.cubes[city] ?? (pub.cubes[city] = {}))[d] = current + 1;
}

function removeCubes(pub: PandemicPublic, city: string, d: Disease, count: number | 'all'): void {
  const current = cubesAt(pub, city, d);
  const removed = count === 'all' ? current : Math.min(count, current);
  if (removed <= 0) return;
  pub.cubes[city]![d] = current - removed;
  pub.cubesLeft[d] += removed;
  if (pub.cubes[city]![d] === 0) delete pub.cubes[city]![d];
  checkEradication(pub, d);
}

function checkEradication(pub: PandemicPublic, d: Disease): void {
  if (pub.cured[d] && pub.cubesLeft[d] === 24) {
    pub.eradicated[d] = true;
  }
}

/** Medic passive: cured diseases auto-clear where the medic is/arrives. */
function medicSweep(pub: PandemicPublic, seat: Seat): void {
  const p = pub.players[seat]!;
  if (p.role !== 'medic') return;
  for (const d of DISEASES) {
    if (pub.cured[d]) removeCubes(pub, p.city, d, 'all');
  }
}

function drawPlayerCards(s: State, seat: Seat, rng: SeededRandom): void {
  const pub = s.public;
  const hidden = hiddenOf(s);
  for (let i = 0; i < 2; i++) {
    if (pub.result) return;
    const card = hidden.playerDeck.pop();
    if (!card) {
      pub.result = 'lost';
      pub.lossReason = 'player deck exhausted';
      return;
    }
    if (card.kind === 'epidemic') {
      resolveEpidemic(s, rng);
    } else {
      pub.players[seat]!.hand.push(card);
    }
  }
  pub.playerDeckSize = hidden.playerDeck.length;
}

function resolveEpidemic(s: State, rng: SeededRandom): void {
  const pub = s.public;
  const hidden = hiddenOf(s);
  pub.infectionRateIndex = Math.min(pub.infectionRateIndex + 1, INFECTION_RATES.length - 1);
  // infect: bottom card, 3 cubes
  const bottom = hidden.infectionDeck.shift();
  if (bottom) {
    const d = CITIES[bottom]!.color;
    const chain = new Set<string>();
    for (let i = 0; i < 3 && !pub.result; i++) addCube(pub, bottom, d, chain);
    pub.infectionDiscard.push(bottom);
    pub.lastEvent = `EPIDEMIC in ${bottom}!`;
  }
  // intensify: shuffle infection discard back on top
  const shuffled = rng.shuffle(pub.infectionDiscard);
  hidden.infectionDeck.push(...shuffled);
  pub.infectionDiscard = [];
}

function infectStep(s: State): void {
  const pub = s.public;
  const hidden = hiddenOf(s);
  const rate = INFECTION_RATES[pub.infectionRateIndex]!;
  for (let i = 0; i < rate && !pub.result; i++) {
    const city = hidden.infectionDeck.pop();
    if (!city) break;
    pub.infectionDiscard.push(city);
    addCube(pub, city, CITIES[city]!.color, new Set());
  }
}

function endTurn(s: State, seat: Seat, rng: SeededRandom): void {
  const pub = s.public;
  drawPlayerCards(s, seat, rng);
  if (pub.result) return;
  if (pub.players[seat]!.hand.length > HAND_LIMIT) {
    pub.phase = 'DISCARD';
    pub.discardSeat = seat;
    return; // infect step happens after the discard completes
  }
  finishTurn(s);
}

function finishTurn(s: State): void {
  const pub = s.public;
  infectStep(s);
  if (pub.result) return;
  pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  const next = currentSeat(pub);
  pub.actionsLeft = pub.players[next]!.role === 'generalist' ? 5 : 4;
  pub.phase = 'ACTIONS';
  pub.discardSeat = null;
}

function spendAction(s: State, seat: Seat, rng: SeededRandom): void {
  const pub = s.public;
  if (checkWin(pub)) return;
  pub.actionsLeft -= 1;
  if (pub.actionsLeft <= 0) endTurn(s, seat, rng);
}

function checkWin(pub: PandemicPublic): boolean {
  if (DISEASES.every((d) => pub.cured[d])) {
    pub.result = 'won';
    return true;
  }
  return false;
}

function requireActions(pub: PandemicPublic, seat: Seat): PandemicPlayer {
  if (pub.result) throw new IllegalMove('Game is over');
  if (pub.phase !== 'ACTIONS') throw new IllegalMove('Resolve the discard first');
  if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
  return pub.players[seat]!;
}

function discardFromHand(s: State, seat: Seat, predicate: (c: PlayerCard) => boolean): PlayerCard {
  const hand = s.public.players[seat]!.hand;
  const idx = hand.findIndex(predicate);
  if (idx === -1) throw new IllegalMove('Required card not in hand');
  return hand.splice(idx, 1)[0]!;
}

export const pandemic: GameModule<PandemicPublic, PandemicPrivate | Hidden, PandemicMove> = {
  slug: 'pandemic',
  displayName: 'Pandemic',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 4,
  teams: 'none',

  setup(seats, rng) {
    const roles = rng.shuffle(ROLES).slice(0, seats.length);
    const players: Record<Seat, PandemicPlayer> = {};
    const priv: Record<Seat, PandemicPrivate | Hidden> = {};

    // player deck: 48 city cards, deal, then shuffle epidemics into piles
    let cityCards: PlayerCard[] = rng.shuffle(CITY_NAMES.map((c) => ({ kind: 'city' as const, city: c })));
    const handSize = seats.length === 2 ? 4 : seats.length === 3 ? 3 : 2;
    seats.forEach(({ seat }, i) => {
      players[seat] = { role: roles[i]!, city: 'atlanta', hand: cityCards.splice(0, handSize) };
      priv[seat] = {};
    });

    // split remaining deck into EPIDEMICS piles, one epidemic shuffled into each
    const piles: PlayerCard[][] = [];
    const pileSize = Math.ceil(cityCards.length / EPIDEMICS);
    for (let i = 0; i < EPIDEMICS; i++) {
      const pile = cityCards.slice(i * pileSize, (i + 1) * pileSize);
      pile.push({ kind: 'epidemic' });
      piles.push(rng.shuffle(pile));
    }
    const playerDeck = piles.flat().reverse(); // pop() draws from the "top"

    // infection deck + initial infections: 3×3, 3×2, 3×1 cubes
    const infectionDeck = rng.shuffle([...CITY_NAMES]);
    const pub: PandemicPublic = {
      players,
      order: seats.map((x) => x.seat),
      turnIndex: 0,
      actionsLeft: 0,
      phase: 'ACTIONS',
      discardSeat: null,
      cubes: {},
      stations: ['atlanta'],
      cured: { blue: false, yellow: false, black: false, red: false },
      eradicated: { blue: false, yellow: false, black: false, red: false },
      cubesLeft: { blue: 24, yellow: 24, black: 24, red: 24 },
      outbreaks: 0,
      infectionRateIndex: 0,
      playerDeckSize: playerDeck.length,
      infectionDiscard: [],
      lastEvent: null,
      result: null,
      lossReason: null,
    };
    for (let group = 3; group >= 1; group--) {
      for (let i = 0; i < 3; i++) {
        const city = infectionDeck.pop()!;
        pub.infectionDiscard.push(city);
        const chain = new Set<string>();
        for (let c = 0; c < group; c++) addCube(pub, city, CITIES[city]!.color, chain);
      }
    }
    pub.actionsLeft = players[pub.order[0]!]!.role === 'generalist' ? 5 : 4;

    priv[HIDDEN_ZONE] = { playerDeck, infectionDeck };
    return { public: pub, private: priv };
  },

  activePlayers(state) {
    const pub = state.public;
    if (pub.result !== null) return [];
    if (pub.phase === 'DISCARD' && pub.discardSeat !== null) return [pub.discardSeat];
    return [currentSeat(pub)];
  },

  moves: {
    DRIVE({ state, seat, payload, rng }) {
      const s = state as State;
      const p = requireActions(s.public, seat);
      const { city } = payload as { city: string };
      if (!CITIES[p.city]!.neighbors.includes(city)) throw new IllegalMove('Not adjacent');
      p.city = city;
      medicSweep(s.public, seat);
      spendAction(s, seat, rng);
    },

    DIRECT_FLIGHT({ state, seat, payload, rng }) {
      const s = state as State;
      const p = requireActions(s.public, seat);
      const { city } = payload as { city: string };
      if (city === p.city) throw new IllegalMove('Already there');
      discardFromHand(s, seat, (c) => c.kind === 'city' && c.city === city);
      p.city = city;
      medicSweep(s.public, seat);
      spendAction(s, seat, rng);
    },

    CHARTER_FLIGHT({ state, seat, payload, rng }) {
      const s = state as State;
      const p = requireActions(s.public, seat);
      const { city } = payload as { city: string };
      if (city === p.city) throw new IllegalMove('Already there');
      discardFromHand(s, seat, (c) => c.kind === 'city' && c.city === p.city);
      p.city = city;
      medicSweep(s.public, seat);
      spendAction(s, seat, rng);
    },

    SHUTTLE({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      const p = requireActions(pub, seat);
      const { city } = payload as { city: string };
      if (!pub.stations.includes(p.city) || !pub.stations.includes(city)) {
        throw new IllegalMove('Shuttle needs research stations at both ends');
      }
      if (city === p.city) throw new IllegalMove('Already there');
      p.city = city;
      medicSweep(pub, seat);
      spendAction(s, seat, rng);
    },

    BUILD({ state, seat, rng }) {
      const s = state as State;
      const pub = s.public;
      const p = requireActions(pub, seat);
      if (pub.stations.includes(p.city)) throw new IllegalMove('Station already here');
      if (p.role !== 'operations-expert') {
        discardFromHand(s, seat, (c) => c.kind === 'city' && c.city === p.city);
      }
      pub.stations.push(p.city);
      spendAction(s, seat, rng);
    },

    TREAT({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      const p = requireActions(pub, seat);
      const { disease } = payload as { disease: Disease };
      if (cubesAt(pub, p.city, disease) === 0) throw new IllegalMove('No cubes of that disease here');
      const all = p.role === 'medic' || pub.cured[disease];
      removeCubes(pub, p.city, disease, all ? 'all' : 1);
      pub.lastEvent = `treated ${disease} in ${p.city}`;
      spendAction(s, seat, rng);
    },

    SHARE({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      const p = requireActions(pub, seat);
      const { withSeat, direction } = payload as { withSeat: Seat; direction: 'give' | 'take' };
      const other = pub.players[withSeat];
      if (!other || withSeat === seat) throw new IllegalMove('Bad share target');
      if (other.city !== p.city) throw new IllegalMove('Must be in the same city');
      const giver = direction === 'give' ? seat : withSeat;
      const receiver = direction === 'give' ? withSeat : seat;
      const card = discardFromHand(s, giver, (c) => c.kind === 'city' && c.city === p.city);
      pub.players[receiver]!.hand.push(card);
      pub.lastEvent = 'shared knowledge';
      if (pub.players[receiver]!.hand.length > HAND_LIMIT) {
        pub.phase = 'DISCARD';
        pub.discardSeat = receiver;
        // action is spent, but turn resolution waits for the discard
        pub.actionsLeft -= 1;
        return;
      }
      spendAction(s, seat, rng);
    },

    CURE({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      const p = requireActions(pub, seat);
      const { disease, cards } = payload as { disease: Disease; cards: number[] };
      if (pub.cured[disease]) throw new IllegalMove('Already cured');
      if (!pub.stations.includes(p.city)) throw new IllegalMove('Need a research station');
      const needed = p.role === 'scientist' ? 4 : 5;
      if (new Set(cards).size !== needed) throw new IllegalMove(`Need exactly ${needed} ${disease} cards`);
      for (const i of cards) {
        const c = p.hand[i];
        if (!c || c.kind !== 'city' || CITIES[c.city]!.color !== disease) {
          throw new IllegalMove(`All ${needed} cards must be ${disease} city cards`);
        }
      }
      [...cards].sort((a, b) => b - a).forEach((i) => p.hand.splice(i, 1));
      pub.cured[disease] = true;
      checkEradication(pub, disease);
      // medics anywhere auto-clear newly cured cubes in their city
      for (const st of pub.order) medicSweep(pub, st);
      pub.lastEvent = `CURED ${disease}!`;
      spendAction(s, seat, rng);
    },

    PASS({ state, seat, rng }) {
      const s = state as State;
      requireActions(s.public, seat);
      s.public.actionsLeft = 1;
      spendAction(s, seat, rng);
    },

    DISCARD({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      if (pub.result) throw new IllegalMove('Game is over');
      if (pub.phase !== 'DISCARD' || pub.discardSeat !== seat) throw new IllegalMove('No discard required');
      const { card } = payload as { card: number };
      const hand = pub.players[seat]!.hand;
      if (!hand[card]) throw new IllegalMove('No such card');
      hand.splice(card, 1);
      if (hand.length <= HAND_LIMIT) {
        if (seat === currentSeat(pub) && pub.actionsLeft <= 0) {
          // discard happened after end-of-turn draw → continue into infect step
          finishTurn(s);
        } else {
          pub.phase = 'ACTIONS';
          pub.discardSeat = null;
          if (pub.actionsLeft <= 0) endTurn(s, currentSeat(pub), rng);
        }
      }
    },
  },

  legalMoves(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.result !== null) return [];
    const moves: PandemicMove[] = [];

    if (pub.phase === 'DISCARD') {
      if (pub.discardSeat === seat) {
        pub.players[seat]!.hand.forEach((_, i) => moves.push({ kind: 'DISCARD', card: i }));
      }
      return moves;
    }
    if (seat !== currentSeat(pub)) return [];
    const p = pub.players[seat]!;

    for (const n of CITIES[p.city]!.neighbors) moves.push({ kind: 'DRIVE', city: n });
    p.hand.forEach((c) => {
      if (c.kind === 'city' && c.city !== p.city) moves.push({ kind: 'DIRECT_FLIGHT', city: c.city });
    });
    if (p.hand.some((c) => c.kind === 'city' && c.city === p.city)) {
      for (const city of CITY_NAMES) {
        if (city !== p.city) moves.push({ kind: 'CHARTER_FLIGHT', city });
      }
    }
    if (pub.stations.includes(p.city)) {
      for (const st of pub.stations) {
        if (st !== p.city) moves.push({ kind: 'SHUTTLE', city: st });
      }
    }
    if (!pub.stations.includes(p.city) &&
      (p.role === 'operations-expert' || p.hand.some((c) => c.kind === 'city' && c.city === p.city))) {
      moves.push({ kind: 'BUILD' });
    }
    for (const d of DISEASES) {
      if (cubesAt(pub, p.city, d) > 0) moves.push({ kind: 'TREAT', disease: d });
    }
    for (const other of pub.order) {
      if (other === seat) continue;
      const o = pub.players[other]!;
      if (o.city !== p.city) continue;
      if (p.hand.some((c) => c.kind === 'city' && c.city === p.city)) {
        moves.push({ kind: 'SHARE', withSeat: other, direction: 'give' });
      }
      if (o.hand.some((c) => c.kind === 'city' && c.city === p.city)) {
        moves.push({ kind: 'SHARE', withSeat: other, direction: 'take' });
      }
    }
    if (pub.stations.includes(p.city)) {
      const needed = p.role === 'scientist' ? 4 : 5;
      for (const d of DISEASES) {
        if (pub.cured[d]) continue;
        const idxs = p.hand
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => c.kind === 'city' && CITIES[(c as { city: string }).city]!.color === d)
          .map(({ i }) => i);
        if (idxs.length >= needed) {
          moves.push({ kind: 'CURE', disease: d, cards: idxs.slice(0, needed) });
        }
      }
    }
    moves.push({ kind: 'PASS' });
    return moves;
  },

  endIf(state) {
    const pub = state.public;
    if (pub.result === 'won') return { winners: [...pub.order] };
    if (pub.result === 'lost') return { cooperativeLoss: true };
    return null;
  },

  view(state) {
    // hands are open info; only deck ORDERS are secret, and they live in the
    // hidden zone which is simply never included here
    return state.public;
  },

  disconnectOptions() {
    // Kick redistributes the leaver's cards (plan §4.1) — skip passes their turn.
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.phase === 'DISCARD' && pub.discardSeat === seat) {
      // force-discard down to the limit (highest indexes first)
      const hand = pub.players[seat]!.hand;
      while (hand.length > HAND_LIMIT) hand.pop();
      pub.phase = 'ACTIONS';
      pub.discardSeat = null;
    }
    if (currentSeat(pub) === seat) {
      // pass their remaining turn without drawing (safest neutral option)
      pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
      const next = currentSeat(pub);
      pub.actionsLeft = pub.players[next]!.role === 'generalist' ? 5 : 4;
    }
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    // redistribute their cards round-robin to remaining players (plan §4.1)
    const leaving = pub.players[seat]!;
    const remaining = pub.order.filter((x) => x !== seat);
    leaving.hand.forEach((card, i) => {
      const target = remaining[i % remaining.length];
      if (target !== undefined) pub.players[target]!.hand.push(card);
    });
    delete pub.players[seat];
    const wasCurrent = currentSeat(pub) === seat;
    const next = wasCurrent ? pub.order[(pub.turnIndex + 1) % pub.order.length] : currentSeat(pub);
    pub.order.splice(idx, 1);
    if (pub.order.length > 0) {
      const ni = pub.order.indexOf(next as Seat);
      pub.turnIndex = ni === -1 ? 0 : ni;
      if (wasCurrent) {
        const cur = currentSeat(pub);
        pub.actionsLeft = pub.players[cur]!.role === 'generalist' ? 5 : 4;
        pub.phase = 'ACTIONS';
        pub.discardSeat = null;
      }
    } else {
      pub.result = 'lost';
      pub.lossReason = 'everyone left';
    }
  },
};
