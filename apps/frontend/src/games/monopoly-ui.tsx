import React, { useState } from 'react';
import type { MonopolyPublic, MonopolyMove } from '@gamebox/game-monopoly';
import { BOARD, rentFor } from '@gamebox/game-monopoly';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SEAT_HEX, WinnerBanner, Prompt, Waiting, Die, EventLine } from './common.js';

const GROUP_HEX: Record<string, string> = {
  brown: '#96603a', 'light-blue': '#7fd4f5', pink: '#e177c1', orange: '#f19b4c',
  red: '#e23f44', yellow: '#f2e14c', green: '#3fa864', 'dark-blue': '#4a6fe0',
};

const CORNER_ART: Record<string, { emoji: string; label: string }> = {
  go: { emoji: '➡️', label: 'GO' },
  jail: { emoji: '🔒', label: 'JAIL' },
  'free-parking': { emoji: '🅿️', label: 'FREE' },
  'go-to-jail': { emoji: '👮', label: 'GO TO JAIL' },
};
const TYPE_EMOJI: Record<string, string> = {
  chance: '❓', chest: '📦', railroad: '🚂', utility: '💡', tax: '💰',
};

/** position 0..39 → cell coords on an 11×11 ring (GO bottom-right, counter-clockwise). */
function cellOf(pos: number): [number, number] {
  if (pos <= 10) return [10 - pos, 10];
  if (pos <= 20) return [0, 10 - (pos - 10)];
  if (pos <= 30) return [pos - 20, 0];
  return [10, pos - 30];
}

function Board({ view }: { view: MonopolyPublic }) {
  const C = 62;
  const cells: React.ReactElement[] = [];
  BOARD.forEach((sp, pos) => {
    const [cx, cy] = cellOf(pos);
    const x = cx * C;
    const y = cy * C;
    const prop = view.properties[pos];
    const groupColor = sp.group ? GROUP_HEX[sp.group] : null;
    const corner = CORNER_ART[sp.type];
    // color band on the inner edge of the cell, facing the center
    const band = groupColor && (
      cy === 10 ? <rect x={x + 2} y={y} width={C - 4} height={11} rx={2} fill={groupColor} />
      : cy === 0 ? <rect x={x + 2} y={y + C - 11} width={C - 4} height={11} rx={2} fill={groupColor} />
      : cx === 0 ? <rect x={x + C - 11} y={y + 2} width={11} height={C - 4} rx={2} fill={groupColor} />
      : <rect x={x} y={y + 2} width={11} height={C - 4} rx={2} fill={groupColor} />
    );
    cells.push(
      <g key={pos}>
        <rect x={x + 1} y={y + 1} width={C - 2} height={C - 2} rx={4}
          fill={corner ? '#222948' : '#1b2140'} stroke="#333c68" strokeWidth={1.2} />
        {band}
        {corner ? (
          <>
            <text x={x + C / 2} y={y + C / 2 + 2} textAnchor="middle" fontSize={20}>{corner.emoji}</text>
            <text x={x + C / 2} y={y + C - 8} textAnchor="middle" fontSize={8.5} fontWeight={900}
              fill="#c9cdea" letterSpacing={0.5}>{corner.label}</text>
          </>
        ) : (
          <>
            {TYPE_EMOJI[sp.type] && (
              <text x={x + C / 2} y={y + C / 2 + 10} textAnchor="middle" fontSize={15} opacity={0.9}>
                {TYPE_EMOJI[sp.type]}
              </text>
            )}
            <text x={x + C / 2} y={y + (groupColor && cy === 10 ? 24 : 20)} textAnchor="middle"
              fontSize={sp.name.length > 14 ? 6.8 : 8} fontWeight={700} fill="#aab0d6">
              {sp.name.length > 20 ? sp.name.slice(0, 18) + '…' : sp.name}
            </text>
            {sp.price !== undefined && !prop && (
              <text x={x + C / 2} y={y + C - 15} textAnchor="middle" fontSize={8} fill="#69709c" fontWeight={700}>
                ${sp.price}
              </text>
            )}
          </>
        )}
        {prop && (
          <rect x={x + 4} y={y + C - 9} width={C - 8} height={5.5} rx={2.5}
            fill={SEAT_HEX[prop.owner % 6]} opacity={prop.mortgaged ? 0.3 : 1} />
        )}
        {prop && prop.houses > 0 && (
          prop.houses === 5 ? (
            <rect x={x + C - 20} y={y + 26} width={15} height={10} rx={2} fill="#e23f44" stroke="#0b0e1d" />
          ) : (
            <g>
              {Array.from({ length: prop.houses }, (_, i) => (
                <rect key={i} x={x + C - 13 - i * 11} y={y + 27} width={8.5} height={8.5} rx={1.5}
                  fill="#7ed957" stroke="#0b0e1d" />
              ))}
            </g>
          )
        )}
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
      const tx = cx * C + 13 + (i % 3) * 13;
      const ty = cy * C + 42 + Math.floor(i / 3) * 6;
      tokens.push(
        <g key={s}>
          <circle cx={tx} cy={ty} r={8.5} fill={SEAT_HEX[s % 6]} stroke="#ffffff" strokeWidth={2} />
          <circle cx={tx - 2.5} cy={ty - 2.5} r={2.5} fill="rgba(255,255,255,0.55)" />
        </g>,
      );
    });
  }

  const W = 11 * C;
  return (
    <svg viewBox={`0 0 ${W} ${W}`} style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      <defs>
        <linearGradient id="mono-center" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#173230" />
          <stop offset="100%" stopColor="#0f2422" />
        </linearGradient>
      </defs>
      <rect width={W} height={W} rx={14} fill="#131836" />
      <rect x={C} y={C} width={9 * C} height={9 * C} rx={8} fill="url(#mono-center)" stroke="#24504b" strokeWidth={2} />
      {cells}
      <text x={W / 2} y={4.35 * C} textAnchor="middle" fontSize={40} fontWeight={900}
        fill="#e8b64c" letterSpacing={6} opacity={0.92} style={{ fontFamily: 'Nunito, sans-serif' }}>
        MONOPOLY
      </text>
      {view.lastRoll && (
        <g>
          {[view.lastRoll.d1, view.lastRoll.d2].map((d, i) => {
            const dx = W / 2 - 42 + i * 48;
            const dy = 4.9 * C;
            const pips: Record<number, [number, number][]> = {
              1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
              4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
              5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
              6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
            };
            return (
              <g key={i}>
                <rect x={dx} y={dy} width={36} height={36} rx={8} fill="#f2f4ff" stroke="#0b0e1d" strokeWidth={1.5} />
                {(pips[d] ?? []).map(([px, py], j) => (
                  <circle key={j} cx={dx + px * 36} cy={dy + py * 36} r={3.4} fill="#1a1e38" />
                ))}
              </g>
            );
          })}
        </g>
      )}
      {view.lastCard && (
        <text x={W / 2} y={6.35 * C} textAnchor="middle" fontSize={15} fill="#ffb930" fontWeight={700}>
          {view.lastCard}
        </text>
      )}
      {view.lastEvent && (
        <text x={W / 2} y={6.9 * C} textAnchor="middle" fontSize={13.5} fill="#8fa0b8">{view.lastEvent}</text>
      )}
      {tokens}
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
          const owned = Object.values(view.properties).filter((pr) => pr.owner === s).length;
          return (
            <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}
              style={p.bankrupt ? { opacity: 0.4 } : undefined}>
              <span className={`token seat-color-${s % 6}`} />
              <span className="grow">
                {seatName(state.summary, s)}
                {p.inJail && ' 🔒'}
                {p.bankrupt && ' 💀'}
                <div className="dim small">{owned} deeds</div>
              </span>
              <strong style={{ color: 'var(--green)' }}>${p.cash}</strong>
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
  const here = BOARD[me.position]!;

  const myProps = Object.entries(view.properties)
    .filter(([, p]) => p.owner === yourSeat)
    .map(([pos]) => Number(pos));

  const toggle = (list: number[], set: (v: number[]) => void, pos: number) =>
    set(list.includes(pos) ? list.filter((x) => x !== pos) : [...list, pos]);

  const legalFor = (kind: string, pos: number) =>
    legal.some((m) => m.kind === kind && (m as { position?: number }).position === pos);

  return (
    <div className="page">
      {/* status header — the full board lives on the TV */}
      <div className="card">
        <div className="row between">
          <div>
            <div className="dim small">your cash</div>
            <div style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--green)' }}>${me.cash}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="dim small">you are on</div>
            <div style={{ fontWeight: 800 }}>
              {here.group && <span style={{ color: GROUP_HEX[here.group] }}>● </span>}
              {here.name}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
              {me.inJail && <span className="badge">🔒 in jail</span>}
              {me.bankrupt && <span className="badge">💀 bankrupt</span>}
            </div>
          </div>
        </div>
        {view.lastRoll && myTurnish && (
          <div className="action-bar">
            <Die value={view.lastRoll.d1} size={44} />
            <Die value={view.lastRoll.d2} size={44} />
          </div>
        )}

        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : !myTurnish ? (
          <Waiting state={state} />
        ) : view.debt?.seat === yourSeat ? (
          <>
            <Prompt danger>You owe ${view.debt.amount}! Sell or mortgage below, then settle.</Prompt>
            <div className="action-bar">
              {kinds.has('RESOLVE_DEBT') && <button onClick={() => submitMove('RESOLVE_DEBT', {})}>Pay ${view.debt.amount}</button>}
              <button style={{ background: 'var(--danger)' }} onClick={() => submitMove('DECLARE_BANKRUPTCY', {})}>
                Declare bankruptcy
              </button>
            </div>
          </>
        ) : view.phase === 'AUCTION' && view.auction ? (
          <>
            <Prompt>🔨 Sealed bid for {BOARD[view.auction.position]!.name} (list ${BOARD[view.auction.position]!.price})</Prompt>
            <div className="action-bar">
              <input style={{ width: 120 }} inputMode="numeric" placeholder="0" value={bid} onChange={(e) => setBid(e.target.value)} />
              <button onClick={() => { submitMove('BID', { amount: Number(bid) || 0 }); setBid(''); }}>Bid</button>
              <button className="secondary" onClick={() => submitMove('BID', { amount: 0 })}>Pass</button>
            </div>
          </>
        ) : view.pendingTrade && view.pendingTrade.to === yourSeat ? (
          <>
            <Prompt>
              🤝 {seatName(state.summary, view.pendingTrade.from)} offers:{' '}
              {view.pendingTrade.giveProps.map((p) => BOARD[p]!.name).join(', ') || 'nothing'}
              {view.pendingTrade.giveCash > 0 && ` + $${view.pendingTrade.giveCash}`}
              {' for your '}
              {view.pendingTrade.getProps.map((p) => BOARD[p]!.name).join(', ') || 'nothing'}
              {view.pendingTrade.getCash > 0 && ` + $${view.pendingTrade.getCash}`}
            </Prompt>
            <div className="action-bar">
              <button onClick={() => submitMove('RESPOND_TRADE', { accept: true })}>Accept</button>
              <button className="secondary" onClick={() => submitMove('RESPOND_TRADE', { accept: false })}>Reject</button>
            </div>
          </>
        ) : (
          <div className="action-bar">
            {kinds.has('ROLL') && <button className="big" style={{ width: 'auto' }} onClick={() => submitMove('ROLL', {})}>🎲 Roll</button>}
            {kinds.has('PAY_JAIL') && <button className="secondary" onClick={() => submitMove('PAY_JAIL', {})}>Pay $50 fine</button>}
            {kinds.has('BUY') && view.pendingBuy !== null && (
              <button className="gold" onClick={() => submitMove('BUY', {})}>
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
        <EventLine text={view.lastCard} />
        <EventLine text={view.lastEvent} />
      </div>

      {/* everyone's standing at a glance */}
      <div className="card">
        <h3>Standings</h3>
        {view.order.map((s) => {
          const p = view.players[s]!;
          return (
            <div key={s} className="row between" style={p.bankrupt ? { opacity: 0.4 } : undefined}>
              <span className="row" style={{ gap: 6 }}>
                <span className={`token seat-color-${s % 6}`} style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 6 }} />
                {seatName(state.summary, s)}{s === yourSeat && ' (you)'}
                {p.inJail && ' 🔒'}{p.bankrupt && ' 💀'}
                {state.activeSeats.includes(s) && <span className="badge gold-badge">turn</span>}
              </span>
              <strong style={{ color: 'var(--green)' }}>${p.cash}</strong>
            </div>
          );
        })}
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
