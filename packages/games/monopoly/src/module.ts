import type { GameModule, GameState, Seat, SeededRandom } from '@gamebox/core-engine';
import { IllegalMove } from '@gamebox/core-engine';
import {
  BOARD, JAIL_POSITION, GO_SALARY, JAIL_FINE,
  CHANCE_CARDS, CHEST_CARDS, type Space,
} from './board.js';

/**
 * Monopoly — full ledger: buying, rent with houses/hotels, sealed-bid auctions
 * (multi-active seats), mortgages, jail, chance/chest, bankruptcy, and the
 * simplified propose-exact-swap trade (plan §4.1: target temporarily joins
 * activePlayers until they accept/reject).
 *
 * Simplifications: sealed one-round auction instead of open outcry, small
 * chance/chest decks, no get-out-of-jail-free cards, unlimited house supply.
 */

export interface MonopolyPlayer {
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  bankrupt: boolean;
}

export interface OwnedProperty {
  owner: Seat;
  houses: number; // 0..5 (5 = hotel)
  mortgaged: boolean;
}

export interface Trade {
  from: Seat;
  to: Seat;
  giveProps: number[];
  giveCash: number;
  getProps: number[];
  getCash: number;
}

export interface MonopolyPublic {
  players: Record<Seat, MonopolyPlayer>;
  properties: Record<number, OwnedProperty>;
  order: Seat[];
  turnIndex: number;
  phase: 'ROLL' | 'ACT' | 'AUCTION' | 'DEBT';
  lastRoll: { d1: number; d2: number } | null;
  doubles: boolean;
  pendingBuy: number | null;
  auction: { position: number; bids: Partial<Record<Seat, number>> } | null;
  debt: { seat: Seat; amount: number; creditor: Seat | null } | null;
  pendingTrade: Trade | null;
  lastCard: string | null;
  lastEvent: string | null;
  winner: Seat | null;
}

export type MonopolyPrivate = Record<string, never>;

export type MonopolyMove =
  | { kind: 'ROLL' }
  | { kind: 'BUY' }
  | { kind: 'DECLINE_BUY' }
  | { kind: 'BID'; amount: number }
  | { kind: 'BUILD'; position: number }
  | { kind: 'SELL_HOUSE'; position: number }
  | { kind: 'MORTGAGE'; position: number }
  | { kind: 'UNMORTGAGE'; position: number }
  | { kind: 'PAY_JAIL' }
  | { kind: 'PROPOSE_TRADE'; to: Seat; giveProps: number[]; giveCash: number; getProps: number[]; getCash: number }
  | { kind: 'RESPOND_TRADE'; accept: boolean }
  | { kind: 'CANCEL_TRADE' }
  | { kind: 'RESOLVE_DEBT' }
  | { kind: 'DECLARE_BANKRUPTCY' }
  | { kind: 'END_TURN' };

type State = GameState<MonopolyPublic, MonopolyPrivate>;

function currentSeat(pub: MonopolyPublic): Seat {
  return pub.order[pub.turnIndex % pub.order.length] as Seat;
}

function aliveSeats(pub: MonopolyPublic): Seat[] {
  return pub.order.filter((s) => !pub.players[s]!.bankrupt);
}

function space(pos: number): Space {
  return BOARD[pos]!;
}

function groupPositions(group: string): number[] {
  return BOARD.map((s, i) => ({ s, i })).filter(({ s }) => s.group === group).map(({ i }) => i);
}

function ownsFullGroup(pub: MonopolyPublic, seat: Seat, group: string): boolean {
  return groupPositions(group).every((p) => pub.properties[p]?.owner === seat);
}

function countOwned(pub: MonopolyPublic, seat: Seat, type: 'railroad' | 'utility'): number {
  return BOARD.filter((s, i) => s.type === type && pub.properties[i]?.owner === seat).length;
}

export function rentFor(pub: MonopolyPublic, pos: number, diceTotal: number): number {
  const sp = space(pos);
  const prop = pub.properties[pos];
  if (!prop || prop.mortgaged) return 0;
  if (sp.type === 'street') {
    if (prop.houses > 0) return sp.rent![prop.houses] ?? 0;
    const base = sp.rent![0]!;
    return ownsFullGroup(pub, prop.owner, sp.group!) ? base * 2 : base;
  }
  if (sp.type === 'railroad') {
    const n = countOwned(pub, prop.owner, 'railroad');
    return 25 * Math.pow(2, n - 1);
  }
  if (sp.type === 'utility') {
    const n = countOwned(pub, prop.owner, 'utility');
    return (n === 2 ? 10 : 4) * diceTotal;
  }
  return 0;
}

/** Transfer `amount` from seat; enter DEBT phase when cash is short. */
function charge(pub: MonopolyPublic, seat: Seat, amount: number, creditor: Seat | null): void {
  const p = pub.players[seat]!;
  if (p.cash >= amount) {
    p.cash -= amount;
    if (creditor !== null) pub.players[creditor]!.cash += amount;
  } else {
    pub.debt = { seat, amount, creditor };
    pub.phase = 'DEBT';
  }
}

function credit(pub: MonopolyPublic, seat: Seat, amount: number): void {
  pub.players[seat]!.cash += amount;
}

function sendToJail(pub: MonopolyPublic, seat: Seat): void {
  const p = pub.players[seat]!;
  p.position = JAIL_POSITION;
  p.inJail = true;
  p.jailTurns = 0;
  pub.doubles = false; // no extra roll
  pub.lastEvent = 'went to jail';
}

function drawCard(pub: MonopolyPublic, seat: Seat, deck: 'chance' | 'chest', rng: SeededRandom, diceTotal: number): void {
  const cards = deck === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
  const card = cards[rng.int(0, cards.length - 1)]!;
  pub.lastCard = card.text;
  const p = pub.players[seat]!;
  const e = card.effect;
  if (e.kind === 'money') {
    if (e.amount >= 0) credit(pub, seat, e.amount);
    else charge(pub, seat, -e.amount, null);
  } else if (e.kind === 'move-to') {
    if (e.position < p.position) credit(pub, seat, GO_SALARY); // passed GO
    p.position = e.position;
    resolveLanding(pub, seat, rng, diceTotal);
  } else if (e.kind === 'go-to-jail') {
    sendToJail(pub, seat);
  } else if (e.kind === 'repairs') {
    let cost = 0;
    for (const [posStr, prop] of Object.entries(pub.properties)) {
      if (prop.owner !== seat) continue;
      if (prop.houses === 5) cost += e.perHotel;
      else cost += prop.houses * e.perHouse;
      void posStr;
    }
    if (cost > 0) charge(pub, seat, cost, null);
  } else if (e.kind === 'collect-from-each') {
    for (const other of aliveSeats(pub)) {
      if (other === seat) continue;
      const pay = Math.min(e.amount, pub.players[other]!.cash);
      pub.players[other]!.cash -= pay;
      credit(pub, seat, pay);
    }
  }
}

function resolveLanding(pub: MonopolyPublic, seat: Seat, rng: SeededRandom, diceTotal: number): void {
  const p = pub.players[seat]!;
  const sp = space(p.position);
  switch (sp.type) {
    case 'street':
    case 'railroad':
    case 'utility': {
      const prop = pub.properties[p.position];
      if (!prop) {
        pub.pendingBuy = p.position;
      } else if (prop.owner !== seat && !prop.mortgaged) {
        const rent = rentFor(pub, p.position, diceTotal);
        pub.lastEvent = `owes $${rent} rent on ${sp.name}`;
        charge(pub, seat, rent, prop.owner);
      }
      break;
    }
    case 'tax':
      pub.lastEvent = `pays ${sp.name} $${sp.taxAmount}`;
      charge(pub, seat, sp.taxAmount!, null);
      break;
    case 'chance':
      drawCard(pub, seat, 'chance', rng, diceTotal);
      break;
    case 'chest':
      drawCard(pub, seat, 'chest', rng, diceTotal);
      break;
    case 'go-to-jail':
      sendToJail(pub, seat);
      break;
    default:
      break;
  }
}

function advanceTurn(pub: MonopolyPublic): void {
  pub.pendingBuy = null;
  pub.lastCard = null;
  if (pub.doubles && !pub.players[currentSeat(pub)]!.inJail && !pub.players[currentSeat(pub)]!.bankrupt) {
    pub.phase = 'ROLL'; // extra roll, same player
    pub.doubles = false;
    return;
  }
  pub.doubles = false;
  do {
    pub.turnIndex = (pub.turnIndex + 1) % pub.order.length;
  } while (pub.players[currentSeat(pub)]!.bankrupt);
  pub.phase = 'ROLL';
}

function checkWinner(pub: MonopolyPublic): void {
  const alive = aliveSeats(pub);
  if (alive.length === 1) pub.winner = alive[0] as Seat;
}

function doBankruptcy(pub: MonopolyPublic, seat: Seat, creditor: Seat | null): void {
  const p = pub.players[seat]!;
  p.bankrupt = true;
  if (creditor !== null) credit(pub, creditor, p.cash);
  p.cash = 0;
  for (const [posStr, prop] of Object.entries(pub.properties)) {
    if (prop.owner !== seat) continue;
    const pos = Number(posStr);
    if (creditor !== null) {
      prop.owner = creditor;
      prop.houses = 0; // houses return to the bank
    } else {
      delete pub.properties[pos]; // back to unowned, unmortgaged
    }
  }
  pub.debt = null;
  pub.lastEvent = 'went bankrupt';
  checkWinner(pub);
  if (pub.winner === null && currentSeat(pub) === seat) {
    advanceTurn(pub);
  } else if (pub.winner === null && (pub.pendingBuy !== null || pub.phase === 'DEBT')) {
    pub.phase = 'ACT';
  }
}

function requireSeatTurn(pub: MonopolyPublic, seat: Seat): void {
  if (pub.winner !== null) throw new IllegalMove('Game is over');
  if (pub.players[seat]!.bankrupt) throw new IllegalMove('You are bankrupt');
}

/** Management moves (build/mortgage/trade) are allowed in ROLL or ACT on your turn. */
function requireManagement(pub: MonopolyPublic, seat: Seat): void {
  requireSeatTurn(pub, seat);
  if (pub.phase !== 'ROLL' && pub.phase !== 'ACT') throw new IllegalMove('Not now');
  if (seat !== currentSeat(pub)) throw new IllegalMove('Not your turn');
  if (pub.pendingTrade) throw new IllegalMove('Waiting for a trade response');
}

export const monopoly: GameModule<MonopolyPublic, MonopolyPrivate, MonopolyMove> = {
  slug: 'monopoly',
  displayName: 'Monopoly',
  rulesVersion: '1.0.0',
  minPlayers: 2,
  maxPlayers: 6,
  teams: 'none',

  setup(seats) {
    const players: Record<Seat, MonopolyPlayer> = {};
    const priv: Record<Seat, MonopolyPrivate> = {};
    for (const { seat } of seats) {
      players[seat] = { cash: 1500, position: 0, inJail: false, jailTurns: 0, bankrupt: false };
      priv[seat] = {};
    }
    return {
      public: {
        players,
        properties: {},
        order: seats.map((s) => s.seat),
        turnIndex: 0,
        phase: 'ROLL',
        lastRoll: null,
        doubles: false,
        pendingBuy: null,
        auction: null,
        debt: null,
        pendingTrade: null,
        lastCard: null,
        lastEvent: null,
        winner: null,
      },
      private: priv,
    };
  },

  activePlayers(state: State) {
    const pub = state.public;
    if (pub.winner !== null) return [];
    if (pub.debt) return [pub.debt.seat];
    if (pub.auction) {
      return aliveSeats(pub).filter((s) => pub.auction!.bids[s] === undefined);
    }
    if (pub.pendingTrade) return [pub.pendingTrade.to];
    return [currentSeat(pub)];
  },

  moves: {
    ROLL({ state, seat, rng }) {
      const pub = state.public;
      requireSeatTurn(pub, seat);
      if (pub.phase !== 'ROLL' || seat !== currentSeat(pub)) throw new IllegalMove('Not your roll');
      if (pub.pendingTrade) throw new IllegalMove('Waiting for a trade response');

      const d1 = rng.int(1, 6);
      const d2 = rng.int(1, 6);
      pub.lastRoll = { d1, d2 };
      const p = pub.players[seat]!;

      if (p.inJail) {
        if (d1 === d2) {
          p.inJail = false;
          p.jailTurns = 0;
          pub.lastEvent = 'rolled doubles — out of jail!';
        } else {
          p.jailTurns += 1;
          if (p.jailTurns >= 3) {
            charge(pub, seat, JAIL_FINE, null);
            if ((pub.phase as string) === 'DEBT') return; // couldn't pay the fine
            p.inJail = false;
            p.jailTurns = 0;
            pub.lastEvent = 'paid the fine after 3 tries';
          } else {
            pub.lastEvent = 'stuck in jail';
            pub.phase = 'ACT';
            return;
          }
        }
        // leaving jail never grants an extra roll
        pub.doubles = false;
        movePlayer();
        return;
      }

      if (d1 === d2) {
        pub.doubles = true;
        // three doubles in a row → jail. Track via jailTurns reuse? use lastEvent-free counter:
        p.jailTurns += 1; // reused as consecutive-doubles counter while NOT in jail
        if (p.jailTurns >= 3) {
          p.jailTurns = 0;
          sendToJail(pub, seat);
          pub.phase = 'ACT';
          return;
        }
      } else {
        pub.doubles = false;
        p.jailTurns = 0;
      }
      movePlayer();

      function movePlayer(): void {
        const total = d1 + d2;
        const before = p.position;
        p.position = (p.position + total) % BOARD.length;
        if (p.position < before) credit(pub, seat, GO_SALARY);
        resolveLanding(pub, seat, rng, total);
        if (pub.phase === 'ROLL') pub.phase = 'ACT';
      }
    },

    BUY({ state, seat }) {
      const pub = state.public;
      requireManagement(pub, seat);
      if (pub.pendingBuy === null) throw new IllegalMove('Nothing to buy');
      const pos = pub.pendingBuy;
      const price = space(pos).price!;
      const p = pub.players[seat]!;
      if (p.cash < price) throw new IllegalMove('Not enough cash — decline to auction it');
      p.cash -= price;
      pub.properties[pos] = { owner: seat, houses: 0, mortgaged: false };
      pub.pendingBuy = null;
      pub.lastEvent = `bought ${space(pos).name}`;
    },

    DECLINE_BUY({ state, seat }) {
      const pub = state.public;
      requireManagement(pub, seat);
      if (pub.pendingBuy === null) throw new IllegalMove('Nothing to decline');
      pub.auction = { position: pub.pendingBuy, bids: {} };
      pub.pendingBuy = null;
      pub.phase = 'AUCTION';
      pub.lastEvent = `${space(pub.auction.position).name} goes to auction — sealed bids!`;
    },

    BID({ state, seat, payload }) {
      const pub = state.public;
      requireSeatTurn(pub, seat);
      if (pub.phase !== 'AUCTION' || !pub.auction) throw new IllegalMove('No auction running');
      if (pub.auction.bids[seat] !== undefined) throw new IllegalMove('You already bid');
      const { amount } = payload as { amount: number };
      const cash = pub.players[seat]!.cash;
      if (!Number.isInteger(amount) || amount < 0 || amount > cash) {
        throw new IllegalMove(`Bid between 0 and ${cash}`);
      }
      pub.auction.bids[seat] = amount;

      // resolve when every alive seat has bid
      const waiting = aliveSeats(pub).filter((s) => pub.auction!.bids[s] === undefined);
      if (waiting.length > 0) return;

      const entries = Object.entries(pub.auction.bids).map(([s, a]) => [Number(s), a!] as [Seat, number]);
      entries.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const [winner, top] = entries[0]!;
      if (top > 0) {
        pub.players[winner]!.cash -= top;
        pub.properties[pub.auction.position] = { owner: winner, houses: 0, mortgaged: false };
        pub.lastEvent = `auction won for $${top}`;
      } else {
        pub.lastEvent = 'auction ended with no bids';
      }
      pub.auction = null;
      pub.phase = 'ACT';
    },

    BUILD({ state, seat, payload }) {
      const pub = state.public;
      requireManagement(pub, seat);
      const { position } = payload as { position: number };
      const sp = space(position);
      const prop = pub.properties[position];
      if (sp.type !== 'street' || !prop || prop.owner !== seat) throw new IllegalMove('Not your street');
      if (!ownsFullGroup(pub, seat, sp.group!)) throw new IllegalMove('Need the full color group');
      const group = groupPositions(sp.group!);
      if (group.some((g) => pub.properties[g]!.mortgaged)) throw new IllegalMove('Unmortgage the group first');
      if (prop.houses >= 5) throw new IllegalMove('Already has a hotel');
      // even building
      const minHouses = Math.min(...group.map((g) => pub.properties[g]!.houses));
      if (prop.houses > minHouses) throw new IllegalMove('Build evenly across the group');
      const cost = sp.houseCost!;
      if (pub.players[seat]!.cash < cost) throw new IllegalMove('Not enough cash');
      pub.players[seat]!.cash -= cost;
      prop.houses += 1;
      pub.lastEvent = `built on ${sp.name}`;
    },

    SELL_HOUSE({ state, seat, payload }) {
      const pub = state.public;
      requireSeatTurn(pub, seat);
      // selling is allowed during DEBT too (that's the point) but only your own debt
      if (pub.phase === 'DEBT' && pub.debt?.seat !== seat) throw new IllegalMove('Not your debt');
      if (pub.phase !== 'DEBT') requireManagement(pub, seat);
      const { position } = payload as { position: number };
      const sp = space(position);
      const prop = pub.properties[position];
      if (sp.type !== 'street' || !prop || prop.owner !== seat) throw new IllegalMove('Not your street');
      if (prop.houses === 0) throw new IllegalMove('No houses to sell');
      const group = groupPositions(sp.group!);
      const maxHouses = Math.max(...group.map((g) => pub.properties[g]!.houses));
      if (prop.houses < maxHouses) throw new IllegalMove('Sell evenly across the group');
      prop.houses -= 1;
      credit(pub, seat, Math.floor(sp.houseCost! / 2));
      pub.lastEvent = `sold a house on ${sp.name}`;
    },

    MORTGAGE({ state, seat, payload }) {
      const pub = state.public;
      requireSeatTurn(pub, seat);
      if (pub.phase === 'DEBT' && pub.debt?.seat !== seat) throw new IllegalMove('Not your debt');
      if (pub.phase !== 'DEBT') requireManagement(pub, seat);
      const { position } = payload as { position: number };
      const sp = space(position);
      const prop = pub.properties[position];
      if (!prop || prop.owner !== seat) throw new IllegalMove('Not your property');
      if (prop.mortgaged) throw new IllegalMove('Already mortgaged');
      if (sp.type === 'street' && groupPositions(sp.group!).some((g) => (pub.properties[g]?.houses ?? 0) > 0)) {
        throw new IllegalMove('Sell the houses in this group first');
      }
      prop.mortgaged = true;
      credit(pub, seat, Math.floor(sp.price! / 2));
      pub.lastEvent = `mortgaged ${sp.name}`;
    },

    UNMORTGAGE({ state, seat, payload }) {
      const pub = state.public;
      requireManagement(pub, seat);
      const { position } = payload as { position: number };
      const sp = space(position);
      const prop = pub.properties[position];
      if (!prop || prop.owner !== seat || !prop.mortgaged) throw new IllegalMove('Not your mortgaged property');
      const cost = Math.ceil(sp.price! * 0.55); // half price + 10%
      if (pub.players[seat]!.cash < cost) throw new IllegalMove('Not enough cash');
      pub.players[seat]!.cash -= cost;
      prop.mortgaged = false;
      pub.lastEvent = `unmortgaged ${sp.name}`;
    },

    PAY_JAIL({ state, seat }) {
      const pub = state.public;
      requireSeatTurn(pub, seat);
      if (pub.phase !== 'ROLL' || seat !== currentSeat(pub)) throw new IllegalMove('Not now');
      const p = pub.players[seat]!;
      if (!p.inJail) throw new IllegalMove('You are not in jail');
      if (p.cash < JAIL_FINE) throw new IllegalMove('Not enough cash');
      p.cash -= JAIL_FINE;
      p.inJail = false;
      p.jailTurns = 0;
      pub.lastEvent = 'paid the jail fine';
      // still phase ROLL — they roll and move normally now
    },

    PROPOSE_TRADE({ state, seat, payload }) {
      const pub = state.public;
      requireManagement(pub, seat);
      const t = payload as unknown as Trade;
      const trade: Trade = {
        from: seat,
        to: t.to,
        giveProps: t.giveProps ?? [],
        giveCash: t.giveCash ?? 0,
        getProps: t.getProps ?? [],
        getCash: t.getCash ?? 0,
      };
      const other = pub.players[trade.to];
      if (!other || other.bankrupt || trade.to === seat) throw new IllegalMove('Bad trade target');
      if (trade.giveCash < 0 || trade.getCash < 0) throw new IllegalMove('Bad cash amounts');
      if (pub.players[seat]!.cash < trade.giveCash) throw new IllegalMove('Not enough cash to offer');
      if (other.cash < trade.getCash) throw new IllegalMove("They don't have that much cash");
      for (const pos of trade.giveProps) {
        const prop = pub.properties[pos];
        if (!prop || prop.owner !== seat) throw new IllegalMove('You can only offer your own properties');
        if (prop.houses > 0) throw new IllegalMove('Sell buildings before trading a street');
      }
      for (const pos of trade.getProps) {
        const prop = pub.properties[pos];
        if (!prop || prop.owner !== trade.to) throw new IllegalMove('They do not own that property');
        if (prop.houses > 0) throw new IllegalMove('Streets with buildings cannot be traded');
      }
      pub.pendingTrade = trade;
      pub.lastEvent = 'proposed a trade';
    },

    RESPOND_TRADE({ state, seat, payload }) {
      const pub = state.public;
      requireSeatTurn(pub, seat);
      const trade = pub.pendingTrade;
      if (!trade || trade.to !== seat) throw new IllegalMove('No trade waiting on you');
      const { accept } = payload as { accept: boolean };
      pub.pendingTrade = null;
      if (!accept) {
        pub.lastEvent = 'rejected the trade';
        return;
      }
      // re-validate cash (state may have changed) then execute
      if (pub.players[trade.from]!.cash < trade.giveCash || pub.players[trade.to]!.cash < trade.getCash) {
        pub.lastEvent = 'trade fell through (not enough cash)';
        return;
      }
      pub.players[trade.from]!.cash += trade.getCash - trade.giveCash;
      pub.players[trade.to]!.cash += trade.giveCash - trade.getCash;
      for (const pos of trade.giveProps) pub.properties[pos]!.owner = trade.to;
      for (const pos of trade.getProps) pub.properties[pos]!.owner = trade.from;
      pub.lastEvent = 'trade accepted!';
    },

    CANCEL_TRADE({ state, seat }) {
      const pub = state.public;
      const trade = pub.pendingTrade;
      if (!trade || trade.from !== seat) throw new IllegalMove('No trade of yours to cancel');
      pub.pendingTrade = null;
      pub.lastEvent = 'withdrew the trade';
    },

    RESOLVE_DEBT({ state, seat }) {
      const pub = state.public;
      const debt = pub.debt;
      if (!debt || debt.seat !== seat) throw new IllegalMove('No debt to resolve');
      const p = pub.players[seat]!;
      if (p.cash < debt.amount) throw new IllegalMove('Still not enough — mortgage or sell, or declare bankruptcy');
      p.cash -= debt.amount;
      if (debt.creditor !== null) credit(pub, debt.creditor, debt.amount);
      pub.debt = null;
      pub.phase = 'ACT';
      pub.lastEvent = 'settled the debt';
    },

    DECLARE_BANKRUPTCY({ state, seat }) {
      const pub = state.public;
      const debt = pub.debt;
      if (!debt || debt.seat !== seat) throw new IllegalMove('You are not in debt');
      doBankruptcy(pub, seat, debt.creditor);
    },

    END_TURN({ state, seat }) {
      const pub = state.public;
      requireManagement(pub, seat);
      if (pub.phase !== 'ACT') throw new IllegalMove('Roll first');
      if (pub.pendingBuy !== null) throw new IllegalMove('Buy or decline first');
      advanceTurn(pub);
    },
  },

  legalMoves(state, seat) {
    const pub = state.public;
    if (pub.winner !== null || pub.players[seat]?.bankrupt) return [];
    const moves: MonopolyMove[] = [];

    if (pub.debt) {
      if (pub.debt.seat !== seat) return [];
      const p = pub.players[seat]!;
      if (p.cash >= pub.debt.amount) moves.push({ kind: 'RESOLVE_DEBT' });
      for (const [posStr, prop] of Object.entries(pub.properties)) {
        const pos = Number(posStr);
        if (prop.owner !== seat) continue;
        const spd = space(pos);
        if (prop.houses > 0) {
          if (prop.houses >= Math.max(...groupPositions(spd.group!).map((g) => pub.properties[g]?.houses ?? 0))) {
            moves.push({ kind: 'SELL_HOUSE', position: pos });
          }
        } else if (!prop.mortgaged &&
          (spd.type !== 'street' || !groupPositions(spd.group!).some((g) => (pub.properties[g]?.houses ?? 0) > 0))) {
          moves.push({ kind: 'MORTGAGE', position: pos });
        }
      }
      moves.push({ kind: 'DECLARE_BANKRUPTCY' });
      return moves;
    }

    if (pub.auction) {
      if (pub.auction.bids[seat] === undefined) moves.push({ kind: 'BID', amount: 0 });
      return moves;
    }

    if (pub.pendingTrade) {
      if (pub.pendingTrade.to === seat) {
        moves.push({ kind: 'RESPOND_TRADE', accept: true });
        moves.push({ kind: 'RESPOND_TRADE', accept: false });
      }
      if (pub.pendingTrade.from === seat) moves.push({ kind: 'CANCEL_TRADE' });
      return moves;
    }

    if (seat !== currentSeat(pub)) return [];
    const p = pub.players[seat]!;

    if (pub.phase === 'ROLL') {
      moves.push({ kind: 'ROLL' });
      if (p.inJail && p.cash >= JAIL_FINE) moves.push({ kind: 'PAY_JAIL' });
    }
    if (pub.phase === 'ACT') {
      if (pub.pendingBuy !== null) {
        if (p.cash >= (space(pub.pendingBuy).price ?? Infinity)) moves.push({ kind: 'BUY' });
        moves.push({ kind: 'DECLINE_BUY' });
      } else {
        moves.push({ kind: 'END_TURN' });
      }
    }
    if (pub.phase === 'ROLL' || pub.phase === 'ACT') {
      for (const [posStr, prop] of Object.entries(pub.properties)) {
        const pos = Number(posStr);
        if (prop.owner !== seat) continue;
        const sp = space(pos);
        if (sp.type === 'street' && ownsFullGroup(pub, seat, sp.group!) && prop.houses < 5 &&
          !groupPositions(sp.group!).some((g) => pub.properties[g]!.mortgaged) &&
          prop.houses <= Math.min(...groupPositions(sp.group!).map((g) => pub.properties[g]!.houses)) &&
          p.cash >= (sp.houseCost ?? Infinity)) {
          moves.push({ kind: 'BUILD', position: pos });
        }
        if (prop.houses > 0 &&
          prop.houses >= Math.max(...groupPositions(sp.group!).map((g) => pub.properties[g]?.houses ?? 0))) {
          moves.push({ kind: 'SELL_HOUSE', position: pos });
        }
        if (!prop.mortgaged && prop.houses === 0 &&
          (sp.type !== 'street' || !groupPositions(sp.group!).some((g) => (pub.properties[g]?.houses ?? 0) > 0))) {
          moves.push({ kind: 'MORTGAGE', position: pos });
        }
        if (prop.mortgaged && p.cash >= Math.ceil((sp.price ?? 0) * 0.55)) {
          moves.push({ kind: 'UNMORTGAGE', position: pos });
        }
      }
    }
    return moves;
  },

  endIf(state) {
    if (state.public.winner !== null) return { winners: [state.public.winner] };
    return null;
  },

  view(state) {
    return state.public; // monopoly has no hidden state in this model
  },

  disconnectOptions() {
    return ['skip', 'pause', 'kick'];
  },

  onPlayerSkipped(state, seat) {
    const pub = state.public;
    // resolve whatever is blocking on this seat with the safest default
    if (pub.debt?.seat === seat) {
      doBankruptcy(pub, seat, pub.debt.creditor);
      return;
    }
    if (pub.auction && pub.auction.bids[seat] === undefined) {
      pub.auction.bids[seat] = 0;
      const waiting = aliveSeats(pub).filter((s) => pub.auction!.bids[s] === undefined);
      if (waiting.length === 0) {
        const entries = Object.entries(pub.auction.bids).map(([s, a]) => [Number(s), a!] as [Seat, number]);
        entries.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const [winner, top] = entries[0]!;
        if (top > 0) {
          pub.players[winner]!.cash -= top;
          pub.properties[pub.auction.position] = { owner: winner, houses: 0, mortgaged: false };
        }
        pub.auction = null;
        pub.phase = 'ACT';
      }
      return;
    }
    if (pub.pendingTrade?.to === seat) {
      pub.pendingTrade = null;
      return;
    }
    if (currentSeat(pub) === seat) {
      if (pub.pendingBuy !== null) pub.pendingBuy = null; // implicit decline, no auction
      pub.doubles = false;
      advanceTurn(pub);
    }
  },

  onPlayerRemoved(state, seat) {
    const pub = state.public;
    // Kick = bankruptcy to the bank (plan §4.1)
    if (pub.debt?.seat === seat) {
      doBankruptcy(pub, seat, pub.debt.creditor);
      return;
    }
    if (pub.pendingTrade && (pub.pendingTrade.from === seat || pub.pendingTrade.to === seat)) {
      pub.pendingTrade = null;
    }
    if (pub.auction) {
      delete pub.auction.bids[seat];
    }
    doBankruptcy(pub, seat, null);
  },
};
