import React, { useState } from 'react';
import type { GameSummary } from '@gamebox/shared-types';
import type { TtrPublic, TtrMove, Card, TicketView, TrainColor, TtrMapDef } from '@gamebox/game-ticket-to-ride';
import { MAPS } from '@gamebox/game-ticket-to-ride';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, seatColor, SeatDot, WinnerBanner, Prompt, Waiting, useBoardFit } from './common.js';

type TtrView = TtrPublic & {
  hand?: Card[];
  tickets?: TicketView[];
  offer?: { a: string; b: string; points: number }[] | null;
};

const CARD_HEX: Record<string, string> = {
  red: '#e8355c', orange: '#f19b4c', yellow: '#f2e14c', green: '#2ec46f',
  blue: '#3f8dff', purple: '#8b6cff', black: '#2a2f4a', white: '#eef0f8',
};
const ROUTE_HEX: Record<string, string> = { ...CARD_HEX, gray: '#8a90b0' };
const DARK_TEXT = new Set(['yellow', 'white']);

const NICE = (c: string) => c.split('-').map((w) => (w === 'st' ? 'St' : w[0]!.toUpperCase() + w.slice(1))).join(' ');

const S = 10;

function mapDefOf(view: TtrView): TtrMapDef {
  return MAPS[view.map] ?? MAPS['north-america']!;
}

/** Route drawn as `length` little train-car segments along the city-to-city line. */
function RouteSegments({ mapDef, summary, id, owner, highlight, onClick }: {
  mapDef: TtrMapDef;
  summary: GameSummary;
  id: string;
  owner: number | undefined;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const def = mapDef.routeById[id]!;
  const [ax, ay] = mapDef.cityPos[def.a]!;
  const [bx, by] = mapDef.cityPos[def.b]!;
  const x1 = ax * S, y1 = ay * S, x2 = bx * S, y2 = by * S;
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const margin = 16; // keep segments off the city dots
  const usable = dist - margin * 2;
  const gap = 3;
  const segLen = (usable - gap * (def.length - 1)) / def.length;
  const color = owner !== undefined ? seatColor(summary, owner) : ROUTE_HEX[def.color];
  const segs = Array.from({ length: def.length }, (_, i) => {
    const t = (margin + i * (segLen + gap) + segLen / 2) / dist;
    return [x1 + dx * t, y1 + dy * t] as const;
  });
  return (
    <g onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {/* fat invisible hit line for easy tapping */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
      {highlight && (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(46,230,201,0.35)" strokeWidth={13} strokeLinecap="round">
          <animate attributeName="stroke-opacity" values="0.25;0.7;0.25" dur="1.4s" repeatCount="indefinite" />
        </line>
      )}
      {segs.map(([cx, cy], i) => (
        <rect key={i}
          x={cx - segLen / 2} y={cy - 4} width={segLen} height={8} rx={2.5}
          fill={color}
          stroke={owner !== undefined ? '#ffffff' : '#0a0e24'}
          strokeWidth={owner !== undefined ? 1.6 : 1}
          transform={`rotate(${angle} ${cx} ${cy})`}
          opacity={owner !== undefined ? 1 : 0.85}
        />
      ))}
    </g>
  );
}

function TtrMap({ view, summary, claimable, onRoute }: {
  view: TtrView;
  summary: GameSummary;
  claimable?: Set<string>;
  onRoute?: (id: string) => void;
}) {
  const mapDef = mapDefOf(view);
  const fit = useBoardFit();
  return (
    <svg viewBox="0 0 1000 620" preserveAspectRatio={fit}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
      <defs>
        <radialGradient id="ttr-bg" cx="50%" cy="42%" r="80%">
          <stop offset="0%" stopColor="#14203e" />
          <stop offset="100%" stopColor="#0a0f26" />
        </radialGradient>
      </defs>
      <rect width={1000} height={620} rx={16} fill="url(#ttr-bg)" />
      {mapDef.routes.map((r) => (
        <RouteSegments
          key={r.id}
          mapDef={mapDef}
          summary={summary}
          id={r.id}
          owner={view.claimed[r.id]}
          highlight={claimable?.has(r.id)}
          onClick={onRoute && claimable?.has(r.id) ? () => onRoute(r.id) : undefined}
        />
      ))}
      {Object.entries(mapDef.cityPos).map(([c, [x, y]]) => (
        <g key={c}>
          <circle cx={x * S} cy={y * S} r={7.5} fill="#f2e6c8" stroke="#0a0e24" strokeWidth={2.5} />
          <circle cx={x * S - 2} cy={y * S - 2} r={2.2} fill="rgba(255,255,255,0.7)" />
          <text x={x * S} y={y * S - 12} textAnchor="middle" fontSize={14.5} fontWeight={800}
            fill="#e7ebff" stroke="#0a0e24" strokeWidth={3.5} style={{ paintOrder: 'stroke' }}>
            {NICE(c)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function TrainCard({ card, big, onClick }: { card: Card; big?: boolean; onClick?: () => void }) {
  const isLoco = card === 'loco';
  return (
    <div
      onClick={onClick}
      className={`hand-card${onClick ? ' clickable' : ''}`}
      style={{
        width: big ? 64 : 46,
        height: big ? 42 : 32,
        borderRadius: 8,
        background: isLoco
          ? 'linear-gradient(120deg, #e8355c, #f2e14c 35%, #2ec46f 65%, #3f8dff)'
          : `linear-gradient(150deg, ${CARD_HEX[card]}, ${CARD_HEX[card]}bb)`,
        border: '2px solid rgba(255,255,255,0.75)',
        color: isLoco || !DARK_TEXT.has(card) ? '#fff' : '#22263e',
        fontSize: big ? 20 : 15,
        textShadow: isLoco ? '0 1px 2px rgba(0,0,0,0.5)' : undefined,
      }}
    >
      🚃
    </div>
  );
}

function Market({ view, onFaceUp, onBlind, canAct }: {
  view: TtrView;
  onFaceUp?: (i: number) => void;
  onBlind?: () => void;
  canAct: boolean;
}) {
  return (
    <div className="action-bar">
      {view.faceUp.map((c, i) => (
        <TrainCard key={`${i}-${c}`} card={c} big onClick={canAct && onFaceUp ? () => onFaceUp(i) : undefined} />
      ))}
      <div
        onClick={canAct && onBlind ? onBlind : undefined}
        className={`hand-card${canAct && onBlind ? ' clickable' : ''}`}
        style={{
          width: 64, height: 42, borderRadius: 8,
          background: 'repeating-linear-gradient(135deg, #262c52, #262c52 6px, #1c213e 6px, #1c213e 12px)',
          border: '2px dashed rgba(140,150,220,0.5)', color: 'var(--text-dim)', fontSize: 13, fontWeight: 800,
        }}
      >
        {view.deckSize + view.discardSize}
      </div>
    </div>
  );
}

function LogPanel({ view, summary, limit, fontSize }: {
  view: TtrView;
  summary: TvViewProps<TtrView>['state']['summary'];
  limit: number;
  fontSize?: string | number;
}) {
  const entries = view.log.slice(-limit);
  if (entries.length === 0) return null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.35em', justifyContent: 'flex-end',
      overflow: 'hidden', minHeight: 0, fontSize,
    }}>
      {entries.map((e, i) => (
        <div key={`${view.log.length - entries.length + i}`}
          style={{ opacity: 0.45 + (0.55 * (i + 1)) / entries.length }}
          className={i === entries.length - 1 ? 'pop-in' : undefined}>
          {e.seat !== null && (
            <strong style={{ color: seatColor(summary, e.seat) }}>
              <SeatDot summary={summary} seat={e.seat} size={14} />{' '}
              {seatName(summary, e.seat)}{' '}
            </strong>
          )}
          <span className={e.seat === null ? '' : 'dim'}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

function Sidebar({ state, view }: { state: TvViewProps<TtrView>['state']; view: TtrView }) {
  return (
    <>
      {view.order.map((s) => (
        <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}
          style={view.removed.includes(s) ? { opacity: 0.4 } : undefined}>
          <SeatDot summary={state.summary} seat={s} />
          <span className="grow">
            {seatName(state.summary, s)}
            <div style={{ fontSize: '1.8vmin', fontWeight: 700, whiteSpace: 'nowrap' }}>
              🚂 <span key={view.trainsLeft[s]} className="count-bump">{view.trainsLeft[s]}</span>
              {' '}· 🂠 <span key={`h${view.handCounts[s]}`} className="count-bump">{view.handCounts[s]}</span>
              {' '}· 🎫 <span key={`t${view.ticketCounts[s]}`} className="count-bump">{view.ticketCounts[s]}</span>
            </div>
          </span>
          <strong style={{ fontSize: '2.6vmin' }}>{view.finalScores ? view.finalScores[s]!.total : view.routeScores[s] ?? 0}</strong>
        </div>
      ))}
      {view.endTriggeredBy !== null && view.phase !== 'DONE' && (
        <div className="tv-player-chip active">🏁 Final round!</div>
      )}
      {view.finalScores && (
        <div className="tv-player-chip" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          {view.order.map((s) => {
            const f = view.finalScores![s]!;
            return (
              <div key={s} className="small dim">
                {seatName(state.summary, s)}: {f.route} route {f.tickets >= 0 ? '+' : ''}{f.tickets} tickets
                {f.longestPath > 0 && ' +10 path'} = <strong style={{ color: 'var(--text)' }}>{f.total}</strong>
              </div>
            );
          })}
        </div>
      )}
      <WinnerBanner state={state} />
    </>
  );
}

function TvView({ state }: TvViewProps<TtrView>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main" style={{ flexDirection: 'column' }}>
      <Market view={view} canAct={false} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '2vmin' }}>
        <div className="tv-board">
          <TtrMap view={view} summary={state.summary} />
        </div>
        <div className="tv-sidebar">
          <Sidebar state={state} view={view} />
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <LogPanel view={view} summary={state.summary} limit={10} fontSize="1.8vmin" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketRow({ t, done }: { t: { a: string; b: string; points: number }; done?: boolean }) {
  return (
    <div className="row between" style={{ opacity: done === undefined ? 1 : done ? 1 : 0.75 }}>
      <span>
        {done !== undefined && <span style={{ color: done ? 'var(--accent-2)' : 'var(--text-dim)' }}>{done ? '✓ ' : '○ '}</span>}
        {NICE(t.a)} → {NICE(t.b)}
      </span>
      <span className={`badge ${done ? 'on' : ''}`}>{t.points}</span>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<TtrView, TtrMove>) {
  const view = state.view;
  const [keep, setKeep] = useState<number[]>([]);
  const [colorPick, setColorPick] = useState<{ route: string; colors: TrainColor[] } | null>(null);
  if (!view) return null;
  const legal = (state.legalMoves ?? []) as TtrMove[];
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const offer = view.offer ?? null;
  const choosingTickets = myTurn && !!offer;
  const minKeep = view.phase === 'INITIAL_TICKETS' ? Math.min(2, offer?.length ?? 2) : 1;

  const claimMoves = legal.filter((m) => m.kind === 'CLAIM_ROUTE') as Extract<TtrMove, { kind: 'CLAIM_ROUTE' }>[];
  const claimable = new Set(claimMoves.map((m) => m.route));
  const canDrawFaceUp = new Set(
    (legal.filter((m) => m.kind === 'DRAW_FACEUP') as Extract<TtrMove, { kind: 'DRAW_FACEUP' }>[]).map((m) => m.index),
  );
  const canBlind = legal.some((m) => m.kind === 'DRAW_BLIND');
  const canTickets = legal.some((m) => m.kind === 'DRAW_TICKETS');
  const actionable = myTurn && !choosingTickets && view.phase === 'PLAY';

  const onRoute = (id: string) => {
    const options = claimMoves.filter((m) => m.route === id);
    const colors = [...new Set(options.map((m) => m.color!))];
    if (colors.length > 1) setColorPick({ route: id, colors });
    else submitMove('CLAIM_ROUTE', { route: id, color: colors[0] });
  };

  const handCounts = new Map<Card, number>();
  for (const c of view.hand ?? []) handCounts.set(c, (handCounts.get(c) ?? 0) + 1);

  return (
    <div className="page wide">
      <div className="card center">
        <div className="row center-h">
          <span className="badge">🚂 {view.trainsLeft[yourSeat]} trains</span>
          <span className="badge on">{view.routeScores[yourSeat] ?? 0} pts</span>
          {view.endTriggeredBy !== null && view.phase !== 'DONE' && <span className="badge gold-badge">🏁 final round</span>}
        </div>
        {state.status === 'completed' ? (
          <>
            {view.finalScores && (
              <p className="dim small">
                routes {view.finalScores[yourSeat]!.route}, tickets {view.finalScores[yourSeat]!.tickets},
                {view.finalScores[yourSeat]!.longestPath > 0 ? ' longest path +10,' : ''} total{' '}
                <strong>{view.finalScores[yourSeat]!.total}</strong>
              </p>
            )}
            <WinnerBanner state={state} />
          </>
        ) : choosingTickets ? (
          <>
            <Prompt>Pick your destination tickets — keep at least {minKeep}</Prompt>
            {offer!.map((t, i) => (
              <div key={i}
                onClick={() => setKeep((k) => (k.includes(i) ? k.filter((x) => x !== i) : [...k, i]))}
                className="row between"
                style={{
                  padding: '0.5em 0.8em', borderRadius: 12, cursor: 'pointer',
                  background: keep.includes(i) ? 'rgba(46,230,201,0.15)' : 'var(--bg-raised)',
                  border: keep.includes(i) ? '1.5px solid var(--accent-2)' : '1.5px solid transparent',
                }}>
                <span>{keep.includes(i) ? '☑' : '☐'} {NICE(t.a)} → {NICE(t.b)}</span>
                <span className="badge">{t.points}</span>
              </div>
            ))}
            <button disabled={keep.length < minKeep}
              onClick={async () => {
                const err = await submitMove('CHOOSE_TICKETS', { keep });
                if (!err) setKeep([]);
              }}>
              Keep {keep.length} ticket{keep.length === 1 ? '' : 's'}
            </button>
          </>
        ) : myTurn ? (
          <Prompt>
            {view.drawnThisTurn > 0
              ? 'Draw one more train card'
              : 'Claim a glowing route, draw train cards, or draw tickets'}
          </Prompt>
        ) : view.phase === 'INITIAL_TICKETS' ? (
          <p className="waiting">Others are picking their tickets</p>
        ) : (
          <Waiting state={state} />
        )}
        {!choosingTickets && state.status !== 'completed' && (
          <>
            <Market
              view={view}
              canAct={actionable}
              onFaceUp={(i) => canDrawFaceUp.has(i) && submitMove('DRAW_FACEUP', { index: i })}
              onBlind={() => canBlind && submitMove('DRAW_BLIND', {})}
            />
            {actionable && canTickets && (
              <div className="action-bar">
                <button className="secondary" onClick={() => submitMove('DRAW_TICKETS', {})}>
                  🎫 Draw tickets ({view.ticketDeckSize})
                </button>
              </div>
            )}
          </>
        )}
        <LogPanel view={view} summary={state.summary} limit={3} fontSize="0.85rem" />
      </div>

      <div className="board-frame">
        <TtrMap view={view} summary={state.summary} claimable={actionable ? claimable : undefined} onRoute={onRoute} />
      </div>

      <div className="card">
        <h3>Your hand</h3>
        <div className="row">
          {[...handCounts.entries()].map(([c, n]) => (
            <div key={c} className="row" style={{ gap: 4 }}>
              <TrainCard card={c} />
              <strong>×{n}</strong>
            </div>
          ))}
          {(view.hand?.length ?? 0) === 0 && <span className="dim small">no cards yet</span>}
        </div>
      </div>

      {view.tickets && view.tickets.length > 0 && (
        <div className="card">
          <h3>Your tickets</h3>
          {view.tickets.map((t, i) => <TicketRow key={i} t={t} done={t.completed} />)}
        </div>
      )}

      {colorPick && (
        <div className="overlay" onClick={() => setColorPick(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3>Pay with which color?</h3>
            <div className="row">
              {colorPick.colors.map((c) => (
                <button key={c}
                  style={{ background: CARD_HEX[c], color: DARK_TEXT.has(c) ? '#22263e' : '#fff', flex: 1 }}
                  onClick={() => {
                    submitMove('CLAIM_ROUTE', { route: colorPick.route, color: c });
                    setColorPick(null);
                  }}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const ticketToRideUi: GameUi = { slug: 'ticket-to-ride', PlayerView, TvView };
export const ticketToRideEuropeUi: GameUi = { slug: 'ticket-to-ride-europe', PlayerView, TvView };
