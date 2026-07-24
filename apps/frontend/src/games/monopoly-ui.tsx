import React, { useEffect, useRef, useState } from 'react';
import type { MonopolyPublic, MonopolyMove } from '@gamebox/game-monopoly';
import { BOARD, rentFor } from '@gamebox/game-monopoly';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import type { GameSummary } from '@gamebox/shared-types';
import {
  seatName, seatColor, SeatDot, SeatToken, WinnerBanner, Prompt, Waiting, Die, EventLine, useBoardFit,
  FxDefs, HandGlyph, CaptureBlast, type HandPhase,
} from './common.js';

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

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** first token slot inside a cell — where the hand sets the mover down */
function tokenXY(pos: number, C: number): { x: number; y: number } {
  const [cx, cy] = cellOf(pos);
  return { x: cx * C + 13, y: cy * C + 42 };
}

interface MonoAnim {
  seat: number;
  x: number;
  y: number;
  phase: HandPhase;
  t: number;
}

/**
 * Diffs player positions between renders: normal rolls hop the token cell
 * by cell around the ring under a hand; teleports (cards, go-to-jail) are a
 * single glide, with a blast when you're slammed into jail.
 */
function useMonopolyAnim(view: MonopolyPublic, C: number): { anim: MonoAnim | null; jailFx: number | null } {
  const [anim, setAnim] = useState<MonoAnim | null>(null);
  const [jailFx, setJailFx] = useState<number | null>(null);
  const prevRef = useRef<Record<number, number> | null>(null);

  useEffect(() => {
    const cur: Record<number, number> = {};
    for (const s of view.order) cur[s] = view.players[s]!.position;
    const prev = prevRef.current;
    prevRef.current = cur;
    if (!prev) return;

    let mover: { seat: number; from: number; to: number } | null = null;
    for (const s of view.order) {
      if (prev[s] !== undefined && prev[s] !== cur[s] && !view.players[s]!.bankrupt) {
        mover = { seat: s, from: prev[s]!, to: cur[s]! };
        break;
      }
    }
    if (!mover) return;

    const { seat, from, to } = mover;
    const steps = (to - from + 40) % 40;
    const pts: { x: number; y: number }[] = [];
    let segMs: number;
    if (steps >= 1 && steps <= 12) {
      for (let i = 0; i <= steps; i++) pts.push(tokenXY((from + i) % 40, C));
      segMs = 120;
    } else {
      pts.push(tokenXY(from, C), tokenXY(to, C));
      segMs = 520;
    }
    const slammedToJail = to === 10 && view.players[seat]!.inJail;

    const GRAB = 200, DROP = 240;
    const moveMs = (pts.length - 1) * segMs;
    const total = GRAB + moveMs + DROP;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const start = performance.now();
    const frame = (now: number) => {
      if (cancelled) return;
      const el = now - start;
      if (el >= total) {
        setAnim(null);
        if (slammedToJail) {
          setJailFx(seat);
          timers.push(setTimeout(() => !cancelled && setJailFx(null), 900));
        }
        return;
      }
      if (el < GRAB) {
        setAnim({ seat, ...pts[0]!, phase: 'grab', t: el / GRAB });
      } else if (el < GRAB + moveMs) {
        const k = (el - GRAB) / segMs;
        const i = Math.min(Math.floor(k), pts.length - 2);
        const e = easeInOutQuad(k - i);
        const a = pts[i]!, b = pts[i + 1]!;
        const lift = Math.sin((k - i) * Math.PI) * (pts.length > 2 ? 5 : 10);
        setAnim({ seat, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - lift, phase: 'drag', t: (el - GRAB) / moveMs });
      } else {
        setAnim({ seat, ...pts[pts.length - 1]!, phase: 'drop', t: (el - GRAB - moveMs) / DROP });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.order.map((s) => view.players[s]!.position).join(',')]);

  return { anim, jailFx };
}

/** Break a space name into at most two short lines that fit a cell. */
function splitName(name: string): string[] {
  if (name.length <= 10) return [name];
  const words = name.split(' ');
  if (words.length === 1) return [name.length > 11 ? name.slice(0, 10) + '…' : name];
  let l1 = words[0]!;
  let i = 1;
  while (i < words.length && (l1 + ' ' + words[i]!).length <= 10) {
    l1 += ' ' + words[i]!;
    i++;
  }
  let l2 = words.slice(i).join(' ');
  if (l2.length > 11) l2 = l2.slice(0, 10) + '…';
  return l2 ? [l1, l2] : [l1];
}

function Board({ view, summary }: { view: MonopolyPublic; summary: GameSummary }) {
  const C = 62;
  const { anim, jailFx } = useMonopolyAnim(view, C);
  const cells: React.ReactElement[] = [];
  BOARD.forEach((sp, pos) => {
    const [cx, cy] = cellOf(pos);
    const x = cx * C;
    const y = cy * C;
    const prop = view.properties[pos];
    const groupColor = sp.group ? GROUP_HEX[sp.group] : null;
    const corner = CORNER_ART[sp.type];
    // which cell edge the color band sits on (inner edge, facing the center)
    const bandEdge = !groupColor ? null : cy === 10 ? 'top' : cy === 0 ? 'bottom' : cx === 0 ? 'right' : 'left';
    const band =
      bandEdge === 'top' ? <rect x={x + 2} y={y + 2} width={C - 4} height={12} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : bandEdge === 'bottom' ? <rect x={x + 2} y={y + C - 14} width={C - 4} height={12} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : bandEdge === 'right' ? <rect x={x + C - 14} y={y + 2} width={12} height={C - 4} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : bandEdge === 'left' ? <rect x={x + 2} y={y + 2} width={12} height={C - 4} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : null;

    // content area (the part of the cell not covered by the band)
    const ctX = x + C / 2 + (bandEdge === 'left' ? 6 : bandEdge === 'right' ? -6 : 0);
    const ctY = bandEdge === 'top' ? y + 13 : y;
    const nameLines = splitName(sp.name);

    // owner marker goes in the corner farthest from the band; double ring
    // (white + dark) keeps it readable on any cell or band color
    const ownX = bandEdge === 'left' ? x + C - 9 : x + 9;
    const ownY = bandEdge === 'top' ? y + C - 9 : bandEdge === 'bottom' ? y + 9 : y + C - 9;

    // houses sit on the color band, classic-style
    const housePips: React.ReactElement[] = [];
    if (prop && prop.houses > 0 && bandEdge) {
      const horiz = bandEdge === 'top' || bandEdge === 'bottom';
      const bandCx = horiz ? 0 : bandEdge === 'left' ? x + 8 : x + C - 8;
      const bandCy = horiz ? (bandEdge === 'top' ? y + 8 : y + C - 8) : 0;
      if (prop.houses === 5) {
        housePips.push(
          horiz
            ? <rect key="h" x={x + C / 2 - 7} y={bandCy - 4.5} width={14} height={9} rx={2} fill="#e23f44" stroke="#ffffff" strokeWidth={1.2} />
            : <rect key="h" x={bandCx - 4.5} y={y + C / 2 - 7} width={9} height={14} rx={2} fill="#e23f44" stroke="#ffffff" strokeWidth={1.2} />,
        );
      } else {
        for (let i = 0; i < prop.houses; i++) {
          const off = (i - (prop.houses - 1) / 2) * 11;
          housePips.push(
            <rect key={i}
              x={(horiz ? x + C / 2 + off : bandCx) - 3.75}
              y={(horiz ? bandCy : y + C / 2 + off) - 3.75}
              width={7.5} height={7.5} rx={1.5} fill="#2f9e44" stroke="#ffffff" strokeWidth={1.2} />,
          );
        }
      }
    }

    cells.push(
      <g key={pos}>
        <rect x={x + 1} y={y + 1} width={C - 2} height={C - 2} rx={3}
          fill={corner ? '#ece4cc' : '#f4eedb'} stroke="#23283f" strokeWidth={1.4} />
        {band}
        {corner ? (
          <>
            <text x={x + C / 2} y={y + C / 2 + 4} textAnchor="middle" fontSize={22}>{corner.emoji}</text>
            <text x={x + C / 2} y={y + C - 7} textAnchor="middle" fontSize={8.5} fontWeight={900}
              fill="#3b4160" letterSpacing={0.5}>{corner.label}</text>
          </>
        ) : (
          <>
            {nameLines.map((ln, i) => (
              <text key={i} x={ctX} y={ctY + 12 + i * 9} textAnchor="middle"
                fontSize={7.6} fontWeight={800} fill="#2b2f45">
                {ln}
              </text>
            ))}
            {TYPE_EMOJI[sp.type] && (
              <text x={ctX} y={ctY + 36} textAnchor="middle" fontSize={14} opacity={0.95}>
                {TYPE_EMOJI[sp.type]}
              </text>
            )}
            {sp.price !== undefined && !prop && (
              <text x={ctX} y={ctY + 47} textAnchor="middle" fontSize={8} fill="#6b7090" fontWeight={800}>
                ${sp.price}
              </text>
            )}
          </>
        )}
        {housePips}
        {prop && (
          <g opacity={prop.mortgaged ? 0.55 : 1}>
            <circle cx={ownX} cy={ownY} r={7} fill="#ffffff" />
            <circle cx={ownX} cy={ownY} r={5.5} fill={seatColor(summary, prop.owner)} stroke="#23283f" strokeWidth={1.4} />
            {prop.mortgaged && (
              <line x1={ownX - 6} y1={ownY + 6} x2={ownX + 6} y2={ownY - 6} stroke="#c92a2a" strokeWidth={2.2} />
            )}
          </g>
        )}
      </g>,
    );
  });

  // tokens
  const bySpace = new Map<number, number[]>();
  for (const s of view.order) {
    const p = view.players[s]!;
    if (p.bankrupt || s === anim?.seat) continue;
    (bySpace.get(p.position) ?? bySpace.set(p.position, []).get(p.position)!).push(s);
  }
  const tokens: React.ReactElement[] = [];
  for (const [pos, seats] of bySpace) {
    const [cx, cy] = cellOf(pos);
    seats.forEach((s, i) => {
      const tx = cx * C + 13 + (i % 3) * 13;
      const ty = cy * C + 42 + Math.floor(i / 3) * 6;
      tokens.push(
        <g key={s} className="board-token" data-pos={pos}>
          <SeatToken summary={summary} seat={s} cx={tx} cy={ty} r={8.5} />
        </g>,
      );
    });
  }
  if (anim) {
    tokens.push(
      <g key={`anim${anim.seat}`} style={{ filter: 'drop-shadow(0 4px 5px rgba(0,0,0,0.55))', pointerEvents: 'none' }}>
        <SeatToken summary={summary} seat={anim.seat} cx={anim.x} cy={anim.y} r={10} />
        <HandGlyph x={anim.x} y={anim.y} phase={anim.phase} t={anim.t} size={C * 0.62} />
      </g>,
    );
  }
  if (jailFx !== null) {
    const jail = tokenXY(10, C);
    tokens.push(<CaptureBlast key="jailfx" x={jail.x} y={jail.y} color="#45a6ff" r={C * 0.38} />);
  }

  const W = 11 * C;
  const fit = useBoardFit();
  return (
    <svg viewBox={`0 0 ${W} ${W}`} preserveAspectRatio={fit}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
      <FxDefs />
      <defs>
        <radialGradient id="mono-center" cx="50%" cy="42%" r="80%">
          <stop offset="0%" stopColor="#d8ecd4" />
          <stop offset="100%" stopColor="#bcd9b8" />
        </radialGradient>
      </defs>
      <rect width={W} height={W} rx={14} fill="#23283f" />
      <rect x={C} y={C} width={9 * C} height={9 * C} rx={6} fill="url(#mono-center)" stroke="#23283f" strokeWidth={2} />
      {cells}
      <g transform={`rotate(-45 ${W / 2} ${W / 2})`}>
        <rect x={W / 2 - 3.6 * C} y={W / 2 - 0.55 * C} width={7.2 * C} height={1.1 * C} rx={8}
          fill="#e23f44" stroke="#ffffff" strokeWidth={3} />
        <text x={W / 2} y={W / 2 + 13} textAnchor="middle" fontSize={40} fontWeight={900}
          fill="#ffffff" letterSpacing={6} style={{ fontFamily: 'Nunito, sans-serif' }}>
          MONOPOLY
        </text>
      </g>
      {view.lastRoll && (
        <g>
          {[view.lastRoll.d1, view.lastRoll.d2].map((d, i) => {
            const dx = W / 2 - 42 + i * 48;
            const dy = 6.55 * C;
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
        <text x={W / 2} y={7.9 * C} textAnchor="middle" fontSize={15} fill="#8a5200" fontWeight={800}>
          {view.lastCard}
        </text>
      )}
      {view.lastEvent && (
        <text x={W / 2} y={8.35 * C} textAnchor="middle" fontSize={13.5} fill="#3b4160" fontWeight={600}>{view.lastEvent}</text>
      )}
      <rect width={W} height={W} rx={14} fill="url(#gb-boardlight)" style={{ pointerEvents: 'none' }} />
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
        <Board view={view} summary={state.summary} />
      </div>
      <div className="tv-sidebar">
        {view.order.map((s) => {
          const p = view.players[s]!;
          const owned = Object.values(view.properties).filter((pr) => pr.owner === s).length;
          return (
            <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}
              style={p.bankrupt ? { opacity: 0.4 } : undefined}>
              <SeatDot summary={state.summary} seat={s} />
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
                <SeatDot summary={state.summary} seat={s} size={13} />
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
