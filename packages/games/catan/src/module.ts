import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import {
  generateBoard, cornersOf, hexesOfVertex, vertexNeighbors, edgeId, edgeVertices,
  hexKey, COSTS, RESOURCES,
  type Hex, type VertexId, type EdgeId, type Resource,
} from './board.js';

/**
 * Catan — settlements/cities/roads on the hex-vertex-edge graph, dice-driven
 * resource distribution, the robber with discard-half (multi-active), bank
 * trade 4:1, propose-exact player trades, dev cards (knight / VP / road
 * building / year of plenty / monopoly), longest road & largest army, 10 VP
 * to win.
 *
 * Simplifications: no harbors/ports, token placement is random (no 6/8
 * adjacency restriction), no "declined trade counter-offer" (per plan §1).
 */

export type DevCard = 'knight' | 'vp' | 'road-building' | 'year-of-plenty' | 'monopoly';

export interface Building {
  owner: Seat;
  city: boolean;
}

export interface CatanTrade {
  from: Seat;
  to: Seat;
  give: Partial<Record<Resource, number>>;
  get: Partial<Record<Resource, number>>;
}

export interface CatanPublic {
  hexes: Hex[];
  robber: string; // hexKey
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Seat>;
  order: Seat[];
  turnIndex: number;
  phase: 'SETUP' | 'ROLL' | 'DISCARD' | 'ROBBER' | 'MAIN';
  setupIndex: number;
  setupSettlement: VertexId | null;
  lastRoll: { d1: number; d2: number } | null;
  resourceCounts: Record<Seat, number>;
  devCardCounts: Record<Seat, number>;
  knightsPlayed: Record<Seat, number>;
  longestRoadOwner: Seat | null;
  longestRoadLength: number;
  largestArmyOwner: Seat | null;
  discardsPending: Record<Seat, number>;
  pendingTrade: CatanTrade | null;
  devPlayedThisTurn: boolean;
  publicScores: Record<Seat, number>; // VP visible on the table (excl. hidden VP cards)
  lastEvent: string | null;
  winner: Seat | null;
}

export interface CatanPrivate {
  resources: Record<Resource, number>;
  devCards: DevCard[];
  devBoughtThisTurn: DevCard[];
}

interface Hidden {
  devDeck: DevCard[];
}

export type CatanMove =
  | { kind: 'PLACE_SETUP'; vertex: VertexId; edge: EdgeId }
  | { kind: 'ROLL' }
  | { kind: 'DISCARD'; resources: Partial<Record<Resource, number>> }
  | { kind: 'MOVE_ROBBER'; hex: string; stealFrom?: Seat }
  | { kind: 'BUILD_ROAD'; edge: EdgeId }
  | { kind: 'BUILD_SETTLEMENT'; vertex: VertexId }
  | { kind: 'BUILD_CITY'; vertex: VertexId }
  | { kind: 'BUY_DEV' }
  | { kind: 'PLAY_KNIGHT'; hex: string; stealFrom?: Seat }
  | { kind: 'PLAY_ROAD_BUILDING'; edges: EdgeId[] }
  | { kind: 'PLAY_YEAR_OF_PLENTY'; r1: Resource; r2: Resource }
  | { kind: 'PLAY_MONOPOLY'; resource: Resource }
  | { kind: 'BANK_TRADE'; give: Resource; get: Resource }
  | { kind: 'PROPOSE_TRADE'; to: Seat; give: Partial<Record<Resource, number>>; get: Partial<Record<Resource, number>> }
  | { kind: 'RESPOND_TRADE'; accept: boolean }
  | { kind: 'END_TURN' };

const HIDDEN_ZONE = -1 as Seat;
type State = GameState<CatanPublic, CatanPrivate | Hidden>;

function hiddenOf(s: State): Hidden {
  return s.private[HIDDEN_ZONE] as Hidden;
}
function privOf(s: State, seat: Seat): CatanPrivate {
  return s.private[seat] as CatanPrivate;
}
function currentSeat(pub: CatanPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function emptyResources(): Record<Resource, number> {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

function totalResources(r: Record<Resource, number>): number {
  return RESOURCES.reduce((sum, k) => sum + r[k], 0);
}

function canAfford(r: Record<Resource, number>, cost: Partial<Record<Resource, number>>): boolean {
  return RESOURCES.every((k) => r[k] >= (cost[k] ?? 0));
}

function payCost(s: State, seat: Seat, cost: Partial<Record<Resource, number>>): void {
  const r = privOf(s, seat).resources;
  if (!canAfford(r, cost)) throw new IllegalMove('Not enough resources');
  for (const k of RESOURCES) r[k] -= cost[k] ?? 0;
  refreshCounts(s);
}

function gain(s: State, seat: Seat, resource: Resource, count = 1): void {
  privOf(s, seat).resources[resource] += count;
}

function refreshCounts(s: State): void {
  const pub = s.public;
  for (const seat of pub.order) {
    pub.resourceCounts[seat] = totalResources(privOf(s, seat).resources);
    pub.devCardCounts[seat] = privOf(s, seat).devCards.length;
  }
}

/** VP including hidden VP dev cards (for the win check only). */
function scoreOf(s: State, seat: Seat, includeHidden: boolean): number {
  const pub = s.public;
  let score = 0;
  for (const b of Object.values(pub.buildings)) {
    if (b.owner === seat) score += b.city ? 2 : 1;
  }
  if (pub.longestRoadOwner === seat) score += 2;
  if (pub.largestArmyOwner === seat) score += 2;
  if (includeHidden) {
    score += privOf(s, seat).devCards.filter((c) => c === 'vp').length;
    score += privOf(s, seat).devBoughtThisTurn.filter((c) => c === 'vp').length;
  }
  return score;
}

function refreshScores(s: State): void {
  for (const seat of s.public.order) {
    s.public.publicScores[seat] = scoreOf(s, seat, false);
  }
}

function checkWin(s: State, seat: Seat): void {
  if (scoreOf(s, seat, true) >= 10) {
    s.public.winner = seat;
  }
}

/** Longest simple path in a seat's road subgraph; opponent buildings break paths. */
export function longestRoadOf(pub: CatanPublic, seat: Seat): number {
  const myEdges = Object.entries(pub.roads).filter(([, o]) => o === seat).map(([e]) => e as EdgeId);
  if (myEdges.length === 0) return 0;
  const adj = new Map<VertexId, EdgeId[]>();
  for (const e of myEdges) {
    for (const v of edgeVertices(e)) {
      (adj.get(v) ?? adj.set(v, []).get(v)!).push(e);
    }
  }
  const blocked = (v: VertexId) => {
    const b = pub.buildings[v];
    return b !== undefined && b.owner !== seat;
  };
  let best = 0;
  const used = new Set<EdgeId>();
  const dfs = (v: VertexId, len: number): void => {
    best = Math.max(best, len);
    if (len > 0 && blocked(v)) return; // can't continue through an opponent building
    for (const e of adj.get(v) ?? []) {
      if (used.has(e)) continue;
      used.add(e);
      const [a, b] = edgeVertices(e);
      dfs(a === v ? b : a, len + 1);
      used.delete(e);
    }
  };
  for (const e of myEdges) {
    for (const v of edgeVertices(e)) dfs(v, 0);
  }
  return best;
}

function updateLongestRoad(s: State): void {
  const pub = s.public;
  for (const seat of pub.order) {
    const len = longestRoadOf(pub, seat);
    const currentBest = pub.longestRoadOwner !== null ? pub.longestRoadLength : 4;
    if (len >= 5 && len > currentBest && pub.longestRoadOwner !== seat) {
      pub.longestRoadOwner = seat;
      pub.longestRoadLength = len;
      pub.lastEvent = 'took Longest Road!';
    } else if (pub.longestRoadOwner === seat) {
      pub.longestRoadLength = len; // may shrink; simplification: keep ownership
    }
  }
}

function updateLargestArmy(pub: CatanPublic, seat: Seat): void {
  const mine = pub.knightsPlayed[seat] ?? 0;
  const best = pub.largestArmyOwner !== null ? pub.knightsPlayed[pub.largestArmyOwner] ?? 0 : 2;
  if (mine >= 3 && (pub.largestArmyOwner === null ? mine >= 3 : mine > best)) {
    if (pub.largestArmyOwner !== seat) {
      pub.largestArmyOwner = seat;
      pub.lastEvent = 'took Largest Army!';
    }
  }
}

function vertexFree(pub: CatanPublic, v: VertexId): boolean {
  if (pub.buildings[v]) return false;
  return vertexNeighbors(v).every((n) => !pub.buildings[n]);
}

function boardVertices(pub: CatanPublic): Set<VertexId> {
  const set = new Set<VertexId>();
  for (const h of pub.hexes) for (const v of cornersOf(h.q, h.r)) set.add(v);
  return set;
}

function boardEdges(pub: CatanPublic): Set<EdgeId> {
  const vs = boardVertices(pub);
  const set = new Set<EdgeId>();
  for (const v of vs) {
    for (const n of vertexNeighbors(v)) {
      if (vs.has(n)) set.add(edgeId(v, n));
    }
  }
  return set;
}

function roadConnects(pub: CatanPublic, seat: Seat, e: EdgeId): boolean {
  const [a, b] = edgeVertices(e);
  for (const v of [a, b]) {
    const building = pub.buildings[v];
    if (building?.owner === seat) return true;
    if (building && building.owner !== seat) continue; // can't build through opponents
    // any of my roads meeting at this vertex?
    for (const n of vertexNeighbors(v)) {
      const adjacent = edgeId(v, n);
      if (adjacent !== e && pub.roads[adjacent] === seat) return true;
    }
  }
  return false;
}

function settlementConnected(pub: CatanPublic, seat: Seat, v: VertexId): boolean {
  return vertexNeighbors(v).some((n) => pub.roads[edgeId(v, n)] === seat);
}

function distribute(s: State, roll: number): void {
  const pub = s.public;
  for (const hex of pub.hexes) {
    if (hex.token !== roll || hex.tile === 'desert') continue;
    if (hexKey(hex.q, hex.r) === pub.robber) continue;
    for (const v of cornersOf(hex.q, hex.r)) {
      const b = pub.buildings[v];
      if (b) gain(s, b.owner, hex.tile as Resource, b.city ? 2 : 1);
    }
  }
  refreshCounts(s);
}

function stealRandom(s: State, thief: Seat, victim: Seat, rng: SeededRandom): void {
  const vr = privOf(s, victim).resources;
  const pool: Resource[] = [];
  for (const k of RESOURCES) for (let i = 0; i < vr[k]; i++) pool.push(k);
  if (pool.length === 0) return;
  const stolen = pool[rng.int(0, pool.length - 1)]!;
  vr[stolen] -= 1;
  gain(s, thief, stolen);
  refreshCounts(s);
  s.public.lastEvent = 'stole a resource';
}

function robberVictims(pub: CatanPublic, hex: string, thief: Seat): Seat[] {
  const [q, r] = hex.split(',').map(Number) as [number, number];
  const seats = new Set<Seat>();
  for (const v of cornersOf(q, r)) {
    const b = pub.buildings[v];
    if (b && b.owner !== thief && (pub.resourceCounts[b.owner] ?? 0) > 0) seats.add(b.owner);
  }
  return [...seats];
}

function moveRobber(s: State, seat: Seat, hex: string, stealFrom: Seat | undefined, rng: SeededRandom): void {
  const pub = s.public;
  if (hex === pub.robber) throw new IllegalMove('Robber must move to a different hex');
  if (!pub.hexes.some((h) => hexKey(h.q, h.r) === hex)) throw new IllegalMove('No such hex');
  pub.robber = hex;
  const victims = robberVictims(pub, hex, seat);
  if (stealFrom !== undefined) {
    if (!victims.includes(stealFrom)) throw new IllegalMove('Cannot steal from that player');
    stealRandom(s, seat, stealFrom, rng);
  } else if (victims.length === 1) {
    stealRandom(s, seat, victims[0]!, rng);
  }
}

function requireMain(pub: CatanPublic, seat: Seat): void {
  if (pub.winner !== null) throw new IllegalMove('Game is over');
  if (pub.phase !== 'MAIN') throw new IllegalMove('Not now');
  if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
  if (pub.pendingTrade) throw new IllegalMove('Waiting for a trade response');
}

const DEV_DECK: DevCard[] = [
  ...Array<DevCard>(14).fill('knight'),
  ...Array<DevCard>(5).fill('vp'),
  ...Array<DevCard>(2).fill('road-building'),
  ...Array<DevCard>(2).fill('year-of-plenty'),
  ...Array<DevCard>(2).fill('monopoly'),
];

function playDev(s: State, seat: Seat, card: DevCard): void {
  const pub = s.public;
  if (pub.devPlayedThisTurn) throw new IllegalMove('Only one dev card per turn');
  const priv = privOf(s, seat);
  const idx = priv.devCards.indexOf(card);
  if (idx === -1) throw new IllegalMove(`You have no ${card} (cards bought this turn wait a turn)`);
  priv.devCards.splice(idx, 1);
  pub.devPlayedThisTurn = true;
  refreshCounts(s);
}

export const catan: GameModule<CatanPublic, CatanPrivate | Hidden, CatanMove> = {
  slug: 'catan',
  displayName: 'Catan',
  rulesVersion: '1.0.0',
  minPlayers: 3,
  maxPlayers: 4,
  teams: 'none',

  setup(seats, rng) {
    const geometry = generateBoard(rng);
    const desert = geometry.hexes.find((h) => h.tile === 'desert')!;
    const priv: Record<Seat, CatanPrivate | Hidden> = {};
    const resourceCounts: Record<Seat, number> = {};
    const devCardCounts: Record<Seat, number> = {};
    const knightsPlayed: Record<Seat, number> = {};
    const publicScores: Record<Seat, number> = {};
    for (const { seat } of seats) {
      priv[seat] = { resources: emptyResources(), devCards: [], devBoughtThisTurn: [] };
      resourceCounts[seat] = 0;
      devCardCounts[seat] = 0;
      knightsPlayed[seat] = 0;
      publicScores[seat] = 0;
    }
    priv[HIDDEN_ZONE] = { devDeck: rng.shuffle(DEV_DECK) };

    return {
      public: {
        hexes: geometry.hexes,
        robber: hexKey(desert.q, desert.r),
        buildings: {},
        roads: {},
        order: seats.map((s) => s.seat),
        turnIndex: 0,
        phase: 'SETUP',
        setupIndex: 0,
        setupSettlement: null,
        lastRoll: null,
        resourceCounts,
        devCardCounts,
        knightsPlayed,
        longestRoadOwner: null,
        longestRoadLength: 0,
        largestArmyOwner: null,
        discardsPending: {},
        pendingTrade: null,
        devPlayedThisTurn: false,
        publicScores,
        lastEvent: null,
        winner: null,
      },
      private: priv,
    };
  },

  activePlayers(state) {
    const pub = state.public;
    if (pub.winner !== null) return [];
    if (pub.phase === 'SETUP') {
      const n = pub.order.length;
      const i = pub.setupIndex < n ? pub.setupIndex : 2 * n - 1 - pub.setupIndex;
      return [pub.order[i]!];
    }
    if (pub.phase === 'DISCARD') {
      return pub.order.filter((s) => (pub.discardsPending[s] ?? 0) > 0);
    }
    if (pub.pendingTrade) return [pub.pendingTrade.to];
    return [currentSeat(pub)];
  },

  moves: {
    PLACE_SETUP({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'SETUP') throw new IllegalMove('Setup is over');
      const n = pub.order.length;
      const i = pub.setupIndex < n ? pub.setupIndex : 2 * n - 1 - pub.setupIndex;
      if (pub.order[i] !== seat) throw new IllegalMove('Not your placement');

      const { vertex, edge } = payload as { vertex: VertexId; edge: EdgeId };
      if (!boardVertices(pub).has(vertex)) throw new IllegalMove('No such vertex');
      if (!vertexFree(pub, vertex)) throw new IllegalMove('Too close to another settlement');
      const [a, b] = edgeVertices(edge);
      if (a !== vertex && b !== vertex) throw new IllegalMove('Road must touch the new settlement');
      if (!boardEdges(pub).has(edge)) throw new IllegalMove('No such edge');
      if (pub.roads[edge] !== undefined) throw new IllegalMove('Edge taken');

      pub.buildings[vertex] = { owner: seat, city: false };
      pub.roads[edge] = seat;

      // second settlement grants starting resources
      if (pub.setupIndex >= n) {
        for (const h of hexesOfVertex(vertex)) {
          const hex = pub.hexes.find((x) => x.q === h.q && x.r === h.r);
          if (hex && hex.tile !== 'desert') gain(s, seat, hex.tile as Resource);
        }
        refreshCounts(s);
      }

      pub.setupIndex += 1;
      if (pub.setupIndex >= 2 * n) {
        pub.phase = 'ROLL';
        pub.turnIndex = 0;
      }
      refreshScores(s);
    },

    ROLL({ state, seat, rng }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'ROLL' || seat !== currentSeat(pub)) throw new IllegalMove('Not your roll');
      const d1 = rng.int(1, 6);
      const d2 = rng.int(1, 6);
      pub.lastRoll = { d1, d2 };
      const roll = d1 + d2;
      if (roll === 7) {
        pub.discardsPending = {};
        for (const st of pub.order) {
          const total = pub.resourceCounts[st] ?? 0;
          if (total > 7) pub.discardsPending[st] = Math.floor(total / 2);
        }
        pub.phase = Object.keys(pub.discardsPending).length > 0 ? 'DISCARD' : 'ROBBER';
        pub.lastEvent = 'rolled a 7!';
      } else {
        distribute(s, roll);
        pub.phase = 'MAIN';
        pub.lastEvent = `rolled ${roll}`;
      }
    },

    DISCARD({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'DISCARD') throw new IllegalMove('No discard needed');
      const owed = pub.discardsPending[seat] ?? 0;
      if (owed === 0) throw new IllegalMove('You have nothing to discard');
      const { resources } = payload as { resources: Partial<Record<Resource, number>> };
      const mine = privOf(s, seat).resources;
      let total = 0;
      for (const k of RESOURCES) {
        const cnt = resources[k] ?? 0;
        if (cnt < 0 || cnt > mine[k]) throw new IllegalMove('Bad discard');
        total += cnt;
      }
      if (total !== owed) throw new IllegalMove(`Discard exactly ${owed} cards`);
      for (const k of RESOURCES) mine[k] -= resources[k] ?? 0;
      delete pub.discardsPending[seat];
      refreshCounts(s);
      if (Object.keys(pub.discardsPending).length === 0) pub.phase = 'ROBBER';
    },

    MOVE_ROBBER({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      if (pub.phase !== 'ROBBER' || seat !== currentSeat(pub)) throw new IllegalMove('Not now');
      const { hex, stealFrom } = payload as { hex: string; stealFrom?: Seat };
      moveRobber(s, seat, hex, stealFrom, rng);
      pub.phase = 'MAIN';
    },

    BUILD_ROAD({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      const { edge } = payload as { edge: EdgeId };
      if (!boardEdges(pub).has(edge)) throw new IllegalMove('No such edge');
      if (pub.roads[edge] !== undefined) throw new IllegalMove('Edge taken');
      if (!roadConnects(pub, seat, edge)) throw new IllegalMove('Road must connect to your network');
      payCost(s, seat, COSTS.road);
      pub.roads[edge] = seat;
      updateLongestRoad(s);
      refreshScores(s);
      checkWin(s, seat);
    },

    BUILD_SETTLEMENT({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      const { vertex } = payload as { vertex: VertexId };
      if (!boardVertices(pub).has(vertex)) throw new IllegalMove('No such vertex');
      if (!vertexFree(pub, vertex)) throw new IllegalMove('Too close to another settlement');
      if (!settlementConnected(pub, seat, vertex)) throw new IllegalMove('Needs one of your roads');
      payCost(s, seat, COSTS.settlement);
      pub.buildings[vertex] = { owner: seat, city: false };
      updateLongestRoad(s); // may cut an opponent's road
      refreshScores(s);
      checkWin(s, seat);
    },

    BUILD_CITY({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      const { vertex } = payload as { vertex: VertexId };
      const b = pub.buildings[vertex];
      if (!b || b.owner !== seat || b.city) throw new IllegalMove('Need your own settlement here');
      payCost(s, seat, COSTS.city);
      b.city = true;
      refreshScores(s);
      checkWin(s, seat);
    },

    BUY_DEV({ state, seat }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      const deck = hiddenOf(s).devDeck;
      if (deck.length === 0) throw new IllegalMove('Dev deck is empty');
      payCost(s, seat, COSTS.dev);
      const card = deck.pop()!;
      privOf(s, seat).devBoughtThisTurn.push(card);
      refreshCounts(s);
      pub.lastEvent = 'bought a development card';
      checkWin(s, seat); // a bought VP card can win immediately
    },

    PLAY_KNIGHT({ state, seat, payload, rng }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      playDev(s, seat, 'knight');
      pub.knightsPlayed[seat] = (pub.knightsPlayed[seat] ?? 0) + 1;
      const { hex, stealFrom } = payload as { hex: string; stealFrom?: Seat };
      moveRobber(s, seat, hex, stealFrom, rng);
      updateLargestArmy(pub, seat);
      refreshScores(s);
      checkWin(s, seat);
    },

    PLAY_ROAD_BUILDING({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      const { edges } = payload as { edges: EdgeId[] };
      if (!Array.isArray(edges) || edges.length === 0 || edges.length > 2) {
        throw new IllegalMove('Pick one or two edges');
      }
      playDev(s, seat, 'road-building');
      for (const e of edges) {
        if (!boardEdges(pub).has(e) || pub.roads[e] !== undefined || !roadConnects(pub, seat, e)) {
          continue; // skip an invalid second edge rather than wasting the card
        }
        pub.roads[e] = seat;
      }
      updateLongestRoad(s);
      refreshScores(s);
      checkWin(s, seat);
    },

    PLAY_YEAR_OF_PLENTY({ state, seat, payload }) {
      const s = state as State;
      requireMain(s.public, seat);
      const { r1, r2 } = payload as { r1: Resource; r2: Resource };
      if (!RESOURCES.includes(r1) || !RESOURCES.includes(r2)) throw new IllegalMove('Bad resources');
      playDev(s, seat, 'year-of-plenty');
      gain(s, seat, r1);
      gain(s, seat, r2);
      refreshCounts(s);
    },

    PLAY_MONOPOLY({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      const { resource } = payload as { resource: Resource };
      if (!RESOURCES.includes(resource)) throw new IllegalMove('Bad resource');
      playDev(s, seat, 'monopoly');
      let taken = 0;
      for (const other of pub.order) {
        if (other === seat) continue;
        const r = privOf(s, other).resources;
        taken += r[resource];
        r[resource] = 0;
      }
      gain(s, seat, resource, taken);
      refreshCounts(s);
      pub.lastEvent = `monopolized ${resource} (+${taken})`;
    },

    BANK_TRADE({ state, seat, payload }) {
      const s = state as State;
      requireMain(s.public, seat);
      const { give, get } = payload as { give: Resource; get: Resource };
      if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) {
        throw new IllegalMove('Bad trade');
      }
      const r = privOf(s, seat).resources;
      if (r[give] < 4) throw new IllegalMove('Bank trades are 4:1');
      r[give] -= 4;
      r[get] += 1;
      refreshCounts(s);
      s.public.lastEvent = `traded 4 ${give} for 1 ${get}`;
    },

    PROPOSE_TRADE({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      const { to, give, get } = payload as CatanTrade;
      if (to === seat || !pub.order.includes(to)) throw new IllegalMove('Bad trade target');
      const giveTotal = RESOURCES.reduce((x, k) => x + (give[k] ?? 0), 0);
      const getTotal = RESOURCES.reduce((x, k) => x + (get[k] ?? 0), 0);
      if (giveTotal === 0 && getTotal === 0) throw new IllegalMove('Empty trade');
      if (!canAfford(privOf(s, seat).resources, give)) throw new IllegalMove('You lack those resources');
      pub.pendingTrade = { from: seat, to, give, get };
      pub.lastEvent = 'proposed a trade';
    },

    RESPOND_TRADE({ state, seat, payload }) {
      const s = state as State;
      const pub = s.public;
      const trade = pub.pendingTrade;
      if (!trade || trade.to !== seat) throw new IllegalMove('No trade waiting on you');
      const { accept } = payload as { accept: boolean };
      pub.pendingTrade = null;
      if (!accept) {
        pub.lastEvent = 'rejected the trade';
        return;
      }
      const fromR = privOf(s, trade.from).resources;
      const toR = privOf(s, seat).resources;
      if (!canAfford(fromR, trade.give) || !canAfford(toR, trade.get)) {
        pub.lastEvent = 'trade fell through';
        return;
      }
      for (const k of RESOURCES) {
        fromR[k] += (trade.get[k] ?? 0) - (trade.give[k] ?? 0);
        toR[k] += (trade.give[k] ?? 0) - (trade.get[k] ?? 0);
      }
      refreshCounts(s);
      pub.lastEvent = 'trade accepted!';
    },

    END_TURN({ state, seat }) {
      const s = state as State;
      const pub = s.public;
      requireMain(pub, seat);
      // newly bought dev cards mature
      const priv = privOf(s, seat);
      priv.devCards.push(...priv.devBoughtThisTurn);
      priv.devBoughtThisTurn = [];
      pub.devPlayedThisTurn = false;
      pub.pendingTrade = null;
      pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
      pub.phase = 'ROLL';
      refreshCounts(s);
    },
  },

  legalMoves(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.winner !== null) return [];
    const moves: CatanMove[] = [];

    if (pub.phase === 'SETUP') {
      const n = pub.order.length;
      const i = pub.setupIndex < n ? pub.setupIndex : 2 * n - 1 - pub.setupIndex;
      if (pub.order[i] !== seat) return [];
      for (const v of boardVertices(pub)) {
        if (!vertexFree(pub, v)) continue;
        for (const nb of vertexNeighbors(v)) {
          const e = edgeId(v, nb);
          if (boardEdges(pub).has(e) && pub.roads[e] === undefined) {
            moves.push({ kind: 'PLACE_SETUP', vertex: v, edge: e });
          }
        }
      }
      return moves;
    }

    if (pub.phase === 'DISCARD') {
      // UI composes the exact discard; just signal that one is required
      if ((pub.discardsPending[seat] ?? 0) > 0) {
        moves.push({ kind: 'DISCARD', resources: {} });
      }
      return moves;
    }

    if (pub.pendingTrade) {
      if (pub.pendingTrade.to === seat) {
        moves.push({ kind: 'RESPOND_TRADE', accept: true });
        moves.push({ kind: 'RESPOND_TRADE', accept: false });
      }
      return moves;
    }

    if (seat !== currentSeat(pub)) return [];

    if (pub.phase === 'ROLL') {
      moves.push({ kind: 'ROLL' });
      return moves;
    }

    if (pub.phase === 'ROBBER') {
      for (const h of pub.hexes) {
        const key = hexKey(h.q, h.r);
        if (key === pub.robber) continue;
        const victims = robberVictims(pub, key, seat);
        if (victims.length === 0) {
          moves.push({ kind: 'MOVE_ROBBER', hex: key });
        } else {
          for (const v of victims) moves.push({ kind: 'MOVE_ROBBER', hex: key, stealFrom: v });
        }
      }
      return moves;
    }

    // MAIN
    const r = privOf(s, seat).resources;
    if (canAfford(r, COSTS.road)) {
      for (const e of boardEdges(pub)) {
        if (pub.roads[e] === undefined && roadConnects(pub, seat, e)) {
          moves.push({ kind: 'BUILD_ROAD', edge: e });
        }
      }
    }
    if (canAfford(r, COSTS.settlement)) {
      for (const v of boardVertices(pub)) {
        if (vertexFree(pub, v) && settlementConnected(pub, seat, v)) {
          moves.push({ kind: 'BUILD_SETTLEMENT', vertex: v });
        }
      }
    }
    if (canAfford(r, COSTS.city)) {
      for (const [v, b] of Object.entries(pub.buildings)) {
        if (b.owner === seat && !b.city) moves.push({ kind: 'BUILD_CITY', vertex: v });
      }
    }
    if (canAfford(r, COSTS.dev) && hiddenOf(s).devDeck.length > 0) {
      moves.push({ kind: 'BUY_DEV' });
    }
    if (!pub.devPlayedThisTurn) {
      const cards = privOf(s, seat).devCards;
      if (cards.includes('knight')) {
        for (const h of pub.hexes) {
          const key = hexKey(h.q, h.r);
          if (key === pub.robber) continue;
          const victims = robberVictims(pub, key, seat);
          if (victims.length === 0) moves.push({ kind: 'PLAY_KNIGHT', hex: key });
          else for (const v of victims) moves.push({ kind: 'PLAY_KNIGHT', hex: key, stealFrom: v });
        }
      }
      if (cards.includes('year-of-plenty')) {
        moves.push({ kind: 'PLAY_YEAR_OF_PLENTY', r1: 'wood', r2: 'brick' });
      }
      if (cards.includes('monopoly')) {
        for (const res of RESOURCES) moves.push({ kind: 'PLAY_MONOPOLY', resource: res });
      }
      if (cards.includes('road-building')) {
        const free = [...boardEdges(pub)].filter(
          (e) => pub.roads[e] === undefined && roadConnects(pub, seat, e),
        );
        if (free.length > 0) moves.push({ kind: 'PLAY_ROAD_BUILDING', edges: free.slice(0, 2) });
      }
    }
    for (const give of RESOURCES) {
      if (r[give] >= 4) {
        for (const get of RESOURCES) {
          if (get !== give) moves.push({ kind: 'BANK_TRADE', give, get });
        }
      }
    }
    moves.push({ kind: 'END_TURN' });
    return moves;
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  view(state, viewer) {
    const s = state as State;
    const pub = s.public;
    if (viewer === 'SPECTATOR' || viewer === HIDDEN_ZONE || !(viewer in s.private)) {
      return { ...pub, yourResources: null, yourDevCards: null, yourNewDevCards: null };
    }
    const priv = privOf(s, viewer as Seat);
    return {
      ...pub,
      yourResources: priv.resources,
      yourDevCards: priv.devCards,
      yourNewDevCards: priv.devBoughtThisTurn,
    };
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const s = state as State;
    const pub = s.public;
    if (pub.phase === 'DISCARD' && (pub.discardsPending[seat] ?? 0) > 0) {
      // auto-discard: drop from the largest piles first
      const mine = privOf(s, seat).resources;
      let owed = pub.discardsPending[seat]!;
      while (owed > 0) {
        const biggest = RESOURCES.reduce((a, b) => (mine[a] >= mine[b] ? a : b));
        if (mine[biggest] === 0) break;
        mine[biggest] -= 1;
        owed -= 1;
      }
      delete pub.discardsPending[seat];
      refreshCounts(s);
      if (Object.keys(pub.discardsPending).length === 0) pub.phase = 'ROBBER';
      return;
    }
    if (pub.pendingTrade?.to === seat) {
      pub.pendingTrade = null;
      return;
    }
    if (currentSeat(pub) === seat) {
      if (pub.phase === 'ROBBER') {
        // park the robber on any hex without stealing
        const target = pub.hexes.find((h) => hexKey(h.q, h.r) !== pub.robber)!;
        pub.robber = hexKey(target.q, target.r);
      }
      if (pub.phase === 'SETUP') return; // can't skip setup placement meaningfully
      const priv = privOf(s, seat);
      priv.devCards.push(...priv.devBoughtThisTurn);
      priv.devBoughtThisTurn = [];
      pub.devPlayedThisTurn = false;
      pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
      pub.phase = 'ROLL';
    }
  },

  onPlayerRemoved(state, seat) {
    const s = state as State;
    const pub = s.public;
    const idx = pub.order.indexOf(seat);
    if (idx === -1) return;
    // buildings/roads stay on the board as obstacles; resources vanish
    delete s.private[seat];
    delete pub.discardsPending[seat];
    if (pub.pendingTrade && (pub.pendingTrade.from === seat || pub.pendingTrade.to === seat)) {
      pub.pendingTrade = null;
    }
    const wasCurrent = currentSeat(pub) === seat;
    const next = wasCurrent ? pub.order[(pub.turnIndex + 1) % pub.order.length] : currentSeat(pub);
    pub.order.splice(idx, 1);
    delete pub.resourceCounts[seat];
    delete pub.devCardCounts[seat];
    if (pub.order.length > 0) {
      const ni = pub.order.indexOf(next as Seat);
      pub.turnIndex = ni === -1 ? 0 : ni;
      if (wasCurrent && pub.phase !== 'SETUP') pub.phase = 'ROLL';
    }
    if (pub.order.length === 1) pub.winner = pub.order[0] as Seat;
  },
};
