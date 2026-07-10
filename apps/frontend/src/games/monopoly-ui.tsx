import React, { useState } from 'react';
import type { MonopolyPublic, MonopolyMove } from '@gamebox/game-monopoly';
import { BOARD, rentFor } from '@gamebox/game-monopoly';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner } from './common.js';

const SEAT_COLORS = ['#e94560', '#2ec4b6', '#f5a623', '#7c5cff', '#3fa7ff', '#9ad14b'];
const GROUP_HEX: Record<string, string> = {
  brown: '#8b5a2b', 'light-blue': '#7fd4f5', pink: '#e177c1', orange: '#f19b4c',
  red: '#e23f44', yellow: '#f2e14c', green: '#3fa864', 'dark-blue': '#3558c9',
};

/** position 0..39 → cell coords on an 11×11 ring (GO bottom-right, counter-clockwise). */
function cellOf(pos: number): [number, number] {
  if (pos <= 10) return [10 - pos, 10];
  if (pos <= 20) return [0, 10 - (pos - 10)];
  if (pos <= 30) return [pos - 20, 0];
  return [10, pos - 30];
}

function Board({ view, mini }: { view: MonopolyPublic; mini?: boolean }) {
  const C = 62;
  const cells: React.ReactElement[] = [];
  BOARD.forEach((sp, pos) => {
    const [cx, cy] = cellOf(pos);
    const x = cx * C;
    const y = cy * C;
    const prop = view.properties[pos];
    const groupColor = sp.group ? GROUP_HEX[sp.group] : null;
    cells.push(
      <g key={pos}>
        <rect x={x} y={y} width={C} height={C} fill="#1b2038" stroke="#2c3255" strokeWidth={1.5} />
        {groupColor && <rect x={x} y={y} width={C} height={10} fill={groupColor} />}
        {prop && (
          <rect x={x + 2} y={y + C - 8} width={C - 4} height={6} rx={2}
            fill={SEAT_COLORS[prop.owner % 6]} opacity={prop.mortgaged ? 0.35 : 1} />
        )}
        {prop && prop.houses > 0 && (
          <text x={x + C - 6} y={y + 22} textAnchor="end" fontSize={11} fill="#9ad14b" fontWeight={800}>
            {prop.houses === 5 ? '🏨' : '🏠'.repeat(Math.min(prop.houses, 4))}
          </text>
        )}
        <text x={x + C / 2} y={y + C / 2 + 3} textAnchor="middle" fontSize={sp.name.length > 14 ? 7 : 8.5} fill="#9aa0c3">
          {sp.name.length > 20 ? sp.name.slice(0, 18) + '…' : sp.name}
        </text>
      </g>,
    );
  });

  // tokens
  const bySpace = new Map<number, number[]>();
  for (const s of view.order) {
    const p = view.players[s]!;
    if (p.bankrupt) continue;
    (bySpace.get(p.position) ?? bySpace.set(p.position, []).get(p.position)!).push(s);
  }
  const tokens: React.ReactElement[] = [];
  for (const [pos, seats] of bySpace) {
    const [cx, cy] = cellOf(pos);
    seats.forEach((s, i) => {
      tokens.push(
        <circle key={s} cx={cx * C + 14 + i * 12} cy={cy * C + 36} r={7}
          fill={SEAT_COLORS[s % 6]} stroke="#0f1220" strokeWidth={2} />,
      );
    });
  }

  return (
    <svg viewBox={`0 0 ${11 * C} ${11 * C}`} style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      <rect width={11 * C} height={11 * C} fill="#141830" />
      {cells}
      {tokens}
      {/* center info */}
      <text x={5.5 * C} y={4.6 * C} textAnchor="middle" fontSize={30} fontWeight={900} fill="#39406e">MONOPOLY</text>
      {view.lastRoll && (
        <text x={5.5 * C} y={5.5 * C} textAnchor="middle" fontSize={32} fill="#eef0ff">
          🎲 {view.lastRoll.d1} + {view.lastRoll.d2}
        </text>
      )}
      {view.lastCard && (
        <text x={5.5 * C} y={6.3 * C} textAnchor="middle" fontSize={14} fill="#f5a623">{view.lastCard}</text>
      )}
      {view.lastEvent && (
        <text x={5.5 * C} y={6.9 * C} textAnchor="middle" fontSize={13} fill="#9aa0c3">{view.lastEvent}</text>
      )}
    </svg>
  );
}

function TvView({ state }: TvViewProps<MonopolyPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} />
      </div>
      <div className="tv-sidebar">
        {view.order.map((s) => {
          const p = view.players[s]!;
          return (
            <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}
              style={p.bankrupt ? { opacity: 0.4 } : undefined}>
              <span className={`token seat-color-${s % 6}`} />
              <span className="grow">
                {seatName(state.summary, s)}
                {p.inJail && ' 🔒'}
                {p.bankrupt && ' 💀'}
              </span>
              <strong>${p.cash}</strong>
            </div>
          );
        })}
        {view.phase === 'AUCTION' && view.auction && (
          <div className="tv-player-chip active">
            🔨 Auction: {BOARD[view.auction.position]!.name}
          </div>
        )}
        {view.pendingTrade && <div className="tv-player-chip">🤝 trade pending…</div>}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<MonopolyPublic, MonopolyMove>) {
  const view = state.view;
  const [bid, setBid] = useState('');
  const [showTrade, setShowTrade] = useState(false);
  const [tradeTo, setTradeTo] = useState<number | null>(null);
  const [giveProps, setGiveProps] = useState<number[]>([]);
  const [getProps, setGetProps] = useState<number[]>([]);
  const [giveCash, setGiveCash] = useState('0');
  const [getCash, setGetCash] = useState('0');
  if (!view) return null;
  const me = view.players[yourSeat]!;
  const legal = (state.legalMoves ?? []) as MonopolyMove[];
  const kinds = new Set(legal.map((m) => m.kind));
  const myTurnish = state.activeSeats.includes(yourSeat) && state.status === 'active';

  const myProps = Object.entries(view.properties)
    .filter(([, p]) => p.owner === yourSeat)
    .map(([pos]) => Number(pos));

  const toggle = (list: number[], set: (v: number[]) => void, pos: number) =>
    set(list.includes(pos) ? list.filter((x) => x !== pos) : [...list, pos]);

  const legalFor = (kind: string, pos: number) =>
    legal.some((m) => m.kind === kind && (m as { position?: number }).position === pos);

  return (
    <div className="page wide">
      <div className="card center">
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className="badge on">${me.cash}</span>
          <span className="badge">{BOARD[me.position]!.name}</span>
          {me.inJail && <span className="badge">🔒 in jail</span>}
          {me.bankrupt && <span className="badge">💀 bankrupt</span>}
        </div>

        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : !myTurnish ? (
          <p className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</p>
        ) : view.debt?.seat === yourSeat ? (
          <>
            <p className="error">You owe ${view.debt.amount}! Sell or mortgage below, then settle.</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              {kinds.has('RESOLVE_DEBT') && <button onClick={() => submitMove('RESOLVE_DEBT', {})}>Pay ${view.debt.amount}</button>}
              <button style={{ background: 'var(--danger)' }} onClick={() => submitMove('DECLARE_BANKRUPTCY', {})}>
                Declare bankruptcy
              </button>
            </div>
          </>
        ) : view.phase === 'AUCTION' && view.auction ? (
          <>
            <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
              🔨 Sealed bid for {BOARD[view.auction.position]!.name} (list ${BOARD[view.auction.position]!.price})
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <input style={{ width: 120 }} inputMode="numeric" placeholder="0" value={bid} onChange={(e) => setBid(e.target.value)} />
              <button onClick={() => { submitMove('BID', { amount: Number(bid) || 0 }); setBid(''); }}>Bid</button>
              <button className="secondary" onClick={() => submitMove('BID', { amount: 0 })}>Pass</button>
            </div>
          </>
        ) : view.pendingTrade && view.pendingTrade.to === yourSeat ? (
          <>
            <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
              🤝 {seatName(state.summary, view.pendingTrade.from)} offers:{' '}
              {view.pendingTrade.giveProps.map((p) => BOARD[p]!.name).join(', ') || 'nothing'}
              {view.pendingTrade.giveCash > 0 && ` + $${view.pendingTrade.giveCash}`}
              {' for your '}
              {view.pendingTrade.getProps.map((p) => BOARD[p]!.name).join(', ') || 'nothing'}
              {view.pendingTrade.getCash > 0 && ` + $${view.pendingTrade.getCash}`}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button onClick={() => submitMove('RESPOND_TRADE', { accept: true })}>Accept</button>
              <button className="secondary" onClick={() => submitMove('RESPOND_TRADE', { accept: false })}>Reject</button>
            </div>
          </>
        ) : (
          <div className="row" style={{ justifyContent: 'center' }}>
            {kinds.has('ROLL') && <button className="big" style={{ width: 'auto' }} onClick={() => submitMove('ROLL', {})}>🎲 Roll</button>}
            {kinds.has('PAY_JAIL') && <button className="secondary" onClick={() => submitMove('PAY_JAIL', {})}>Pay $50 fine</button>}
            {kinds.has('BUY') && view.pendingBuy !== null && (
              <button onClick={() => submitMove('BUY', {})}>
                Buy {BOARD[view.pendingBuy]!.name} (${BOARD[view.pendingBuy]!.price})
              </button>
            )}
            {kinds.has('DECLINE_BUY') && <button className="secondary" onClick={() => submitMove('DECLINE_BUY', {})}>Auction it</button>}
            {kinds.has('END_TURN') && <button className="secondary" onClick={() => submitMove('END_TURN', {})}>End turn</button>}
            {kinds.has('CANCEL_TRADE') && <button className="ghost" onClick={() => submitMove('CANCEL_TRADE', {})}>Withdraw trade</button>}
            {(view.phase === 'ROLL' || view.phase === 'ACT') && !view.pendingTrade && (
              <button className="ghost" onClick={() => setShowTrade(!showTrade)}>🤝 Trade…</button>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <Board view={view} />
      </div>

      {myProps.length > 0 && (
        <div className="card">
          <h3>Your properties</h3>
          {myProps.map((pos) => {
            const sp = BOARD[pos]!;
            const prop = view.properties[pos]!;
            return (
              <div key={pos} className="row between">
                <span>
                  {sp.group && <span style={{ color: GROUP_HEX[sp.group] }}>■ </span>}
                  {sp.name}
                  {prop.mortgaged && <span className="dim small"> (mortgaged)</span>}
                  {prop.houses > 0 && <span className="small"> {prop.houses === 5 ? '🏨' : '🏠'.repeat(prop.houses)}</span>}
                  <span className="dim small"> rent ${rentFor(view, pos, 7)}</span>
                </span>
                <span className="row">
                  {legalFor('BUILD', pos) && <button className="secondary" onClick={() => submitMove('BUILD', { position: pos })}>+🏠 ${sp.houseCost}</button>}
                  {legalFor('SELL_HOUSE', pos) && <button className="ghost" onClick={() => submitMove('SELL_HOUSE', { position: pos })}>-🏠</button>}
                  {legalFor('MORTGAGE', pos) && <button className="ghost" onClick={() => submitMove('MORTGAGE', { position: pos })}>Mortgage +${Math.floor(sp.price! / 2)}</button>}
                  {legalFor('UNMORTGAGE', pos) && <button className="ghost" onClick={() => submitMove('UNMORTGAGE', { position: pos })}>Unmortgage ${Math.ceil(sp.price! * 0.55)}</button>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {showTrade && (
        <div className="card">
          <h3>Propose a trade</h3>
          <select value={tradeTo ?? ''} onChange={(e) => { setTradeTo(e.target.value === '' ? null : Number(e.target.value)); setGetProps([]); }}>
            <option value="">Pick a player…</option>
            {view.order.filter((s) => s !== yourSeat && !view.players[s]!.bankrupt).map((s) => (
              <option key={s} value={s}>{seatName(state.summary, s)}</option>
            ))}
          </select>
          {tradeTo !== null && (
            <>
              <p className="small dim">You give:</p>
              <div className="row">
                {myProps.filter((p) => view.properties[p]!.houses === 0).map((pos) => (
                  <button key={pos} className={giveProps.includes(pos) ? '' : 'secondary'}
                    onClick={() => toggle(giveProps, setGiveProps, pos)}>
                    {BOARD[pos]!.name}
                  </button>
                ))}
                <input style={{ width: 100 }} inputMode="numeric" value={giveCash} onChange={(e) => setGiveCash(e.target.value)} placeholder="$" />
              </div>
              <p className="small dim">You get:</p>
              <div className="row">
                {Object.entries(view.properties)
                  .filter(([, p]) => p.owner === tradeTo && p.houses === 0)
                  .map(([pos]) => Number(pos))
                  .map((pos) => (
                    <button key={pos} className={getProps.includes(pos) ? '' : 'secondary'}
                      onClick={() => toggle(getProps, setGetProps, pos)}>
                      {BOARD[pos]!.name}
                    </button>
                  ))}
                <input style={{ width: 100 }} inputMode="numeric" value={getCash} onChange={(e) => setGetCash(e.target.value)} placeholder="$" />
              </div>
              <button onClick={async () => {
                const err = await submitMove('PROPOSE_TRADE', {
                  to: tradeTo,
                  giveProps,
                  giveCash: Number(giveCash) || 0,
                  getProps,
                  getCash: Number(getCash) || 0,
                });
                if (!err) {
                  setShowTrade(false);
                  setGiveProps([]); setGetProps([]); setGiveCash('0'); setGetCash('0');
                }
              }}>
                Send offer
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const monopolyUi: GameUi = { slug: 'monopoly', PlayerView, TvView };
