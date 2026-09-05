import React, { useEffect, useState } from 'react';
import type { GameSummary } from '@gamebox/shared-types';
import type { TtrPublic, TtrMove, Card, TicketView, TrainColor, TtrMapDef } from '@gamebox/game-ticket-to-ride';
import { MAPS } from '@gamebox/game-ticket-to-ride';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { TableStage, TableLog } from './chrome.js';
import { seatName, seatColor, SeatDot, WinnerBanner, Prompt, Waiting, useBoardFit, FxDefs, RebirthPulse } from './common.js';

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
/** The colour a route you have marked to build is drawn in. */
const PLAN_HEX = '#ffcc55';

const NICE = (c: string) => c.split('-').map((w) => (w === 'st' ? 'St' : w[0]!.toUpperCase() + w.slice(1))).join(' ');

const VB_W = 1000;
const VB_H = 620;
/** Board margin. Bigger at the top because city labels sit above their dot. */
const PAD = { x: 30, top: 40, bottom: 24 };
/**
 * How far the two axes may drift apart when a map is stretched to fill the
 * board. A little is invisible and buys a noticeably bigger map; a lot would
 * make a continent look squashed.
 */
const MAX_ANISO = 1.3;

type CityPos = (city: string) => readonly [number, number];

const layouts = new WeakMap<TtrMapDef, CityPos>();

/**
 * Places a map's cities on the board.
 *
 * Each map is authored in an abstract coordinate space that is larger than the
 * ground its cities actually cover, so scaling it by a fixed factor left the
 * continent adrift in the middle of the board with dead margins all round.
 * This measures the span the cities really occupy and stretches *that* to the
 * edges, so the tracks use the space they are given.
 */
function cityPosOf(mapDef: TtrMapDef): CityPos {
  const cached = layouts.get(mapDef);
  if (cached) return cached;
  const pts = Object.values(mapDef.cityPos);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  const availW = VB_W - PAD.x * 2;
  const availH = VB_H - PAD.top - PAD.bottom;
  let sx = availW / spanX;
  let sy = availH / spanY;
  const cap = Math.min(sx, sy) * MAX_ANISO;
  sx = Math.min(sx, cap);
  sy = Math.min(sy, cap);
  const ox = PAD.x + (availW - spanX * sx) / 2;
  const oy = PAD.top + (availH - spanY * sy) / 2;
  const fn: CityPos = (city) => {
    const p = mapDef.cityPos[city]!;
    return [ox + (p[0] - minX) * sx, oy + (p[1] - minY) * sy] as const;
  };
  layouts.set(mapDef, fn);
  return fn;
}

function mapDefOf(view: TtrView): TtrMapDef {
  return MAPS[view.map] ?? MAPS['north-america']!;
}

/**
 * The cheapest chain of routes from `a` to `b`: what you would still have to
 * lay to join those two cities. Routes somebody else owns are impassable and
 * routes you already own are free, which makes this a useful answer to "how
 * far off is this ticket?" rather than just a distance.
 */
function planRoute(
  mapDef: TtrMapDef,
  claimed: Record<string, number>,
  mine: number | null,
  a: string,
  b: string,
): string[] {
  if (a === b) return [];
  const dist = new Map<string, number>([[a, 0]]);
  const prev = new Map<string, { city: string; route: string }>();
  const settled = new Set<string>();
  for (;;) {
    let cur: string | null = null;
    let curD = Infinity;
    for (const [c, d] of dist) if (!settled.has(c) && d < curD) { cur = c; curD = d; }
    if (cur === null || cur === b) break;
    settled.add(cur);
    for (const rt of mapDef.routes) {
      if (rt.a !== cur && rt.b !== cur) continue;
      const owner = claimed[rt.id];
      if (owner !== undefined && owner !== mine) continue;
      const next = rt.a === cur ? rt.b : rt.a;
      const step = curD + (owner === undefined ? rt.length : 0);
      if (step < (dist.get(next) ?? Infinity)) {
        dist.set(next, step);
        prev.set(next, { city: cur, route: rt.id });
      }
    }
  }
  const out: string[] = [];
  let c = b;
  while (c !== a) {
    const p = prev.get(c);
    if (!p) return [];
    out.push(p.route);
    c = p.city;
  }
  return out.reverse();
}

/** Route drawn as `length` little train-car segments along the city-to-city line. */
function RouteSegments({ mapDef, pos, summary, id, owner, highlight, planned, faded, onClick }: {
  mapDef: TtrMapDef;
  pos: CityPos;
  summary: GameSummary;
  id: string;
  owner: number | undefined;
  highlight?: boolean;
  /** Marked by this player as a track they mean to build. */
  planned?: boolean;
  /** Pushed to the back so something else can be read over it. */
  faded?: boolean;
  onClick?: () => void;
}) {
  const def = mapDef.routeById[id]!;
  const [x1, y1] = pos(def.a);
  const [x2, y2] = pos(def.b);
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
    <g onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined} opacity={faded ? 0.16 : 1}>
      {/* fat invisible hit line for easy tapping */}
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
      {planned && owner === undefined && (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={PLAN_HEX} strokeWidth={15} strokeLinecap="round"
          strokeDasharray="10 7" opacity={0.55} />
      )}
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

function TtrMap({ view, summary, claimable, onRoute, planned, deed }: {
  view: TtrView;
  summary: GameSummary;
  claimable?: Set<string>;
  onRoute?: (id: string) => void;
  /** Routes this player has marked as ones they mean to build. */
  planned?: Set<string>;
  /**
   * Ticket-card mode: everything but the two cities and the suggested chain
   * between them recedes, so the map reads as the picture on the ticket.
   */
  deed?: { a: string; b: string; path: Set<string> };
}) {
  const mapDef = mapDefOf(view);
  const pos = cityPosOf(mapDef);
  const fit = useBoardFit();

  // pop + pulse a route the moment it gets claimed (skip initial mount)
  const seenClaimed = React.useRef<Set<string> | null>(null);
  const firstRender = seenClaimed.current === null;
  if (seenClaimed.current === null) seenClaimed.current = new Set(Object.keys(view.claimed));
  const isFresh = (id: string) => !firstRender && !seenClaimed.current!.has(id);
  const freshIds = Object.keys(view.claimed).filter(isFresh);
  React.useEffect(() => {
    for (const id of Object.keys(view.claimed)) seenClaimed.current!.add(id);
  }, [view.claimed]);

  const deedCities = deed
    ? new Set([deed.a, deed.b, ...[...deed.path].flatMap((id) => [mapDef.routeById[id]!.a, mapDef.routeById[id]!.b])])
    : null;

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio={fit}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
      <FxDefs />
      <defs>
        <radialGradient id="ttr-bg" cx="50%" cy="42%" r="80%">
          <stop offset="0%" stopColor="#1a2850" />
          <stop offset="100%" stopColor="#0b102c" />
        </radialGradient>
      </defs>
      <rect width={VB_W} height={VB_H} rx={16} fill="url(#ttr-bg)" />
      {mapDef.routes.map((r) => (
        <g key={r.id} className={isFresh(r.id) && view.claimed[r.id] !== undefined ? 'gb-pop' : undefined}>
          <RouteSegments
            mapDef={mapDef}
            pos={pos}
            summary={summary}
            id={r.id}
            owner={view.claimed[r.id]}
            highlight={deed ? deed.path.has(r.id) : claimable?.has(r.id)}
            planned={!deed && planned?.has(r.id)}
            faded={!!deed && !deed.path.has(r.id)}
            onClick={onRoute ? () => onRoute(r.id) : undefined}
          />
        </g>
      ))}
      {freshIds.map((id) => {
        const def = mapDef.routeById[id]!;
        const [ax, ay] = pos(def.a);
        const [bx, by] = pos(def.b);
        return (
          <RebirthPulse key={`fx-${id}`} x={(ax + bx) / 2} y={(ay + by) / 2}
            color={seatColor(summary, view.claimed[id]!)} r={26} />
        );
      })}
      {Object.keys(mapDef.cityPos).map((c) => {
        const [x, y] = pos(c);
        const endpoint = deed ? c === deed.a || c === deed.b : false;
        const shown = !deed || deedCities!.has(c);
        return (
          <g key={c} opacity={shown ? 1 : 0.18}>
            {endpoint && (
              <circle cx={x} cy={y} r={16} fill="none" stroke={PLAN_HEX} strokeWidth={3}>
                <animate attributeName="r" values="14;20;14" dur="1.8s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={x} cy={y} r={endpoint ? 9.5 : 7.5} fill={endpoint ? PLAN_HEX : '#f2e6c8'}
              stroke="#0a0e24" strokeWidth={2.5} />
            <circle cx={x - 2} cy={y - 2} r={2.2} fill="rgba(255,255,255,0.7)" />
            {shown && (
              <text x={x} y={y - (endpoint ? 16 : 12)} textAnchor="middle"
                fontSize={endpoint ? 19 : 14.5} fontWeight={800}
                fill={endpoint ? PLAN_HEX : '#e7ebff'} stroke="#0a0e24" strokeWidth={3.5}
                style={{ paintOrder: 'stroke' }}>
                {NICE(c)}
              </text>
            )}
          </g>
        );
      })}
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
          {/* The map never turns between players, so TableStage brings it flat
              to the front at full size rather than tilting it into the table. */}
          <TableStage sides={4} tilt={26} rotate={false}>
            <TtrMap view={view} summary={state.summary} />
          </TableStage>
        </div>
        <div className="tv-sidebar">
          <Sidebar state={state} view={view} />
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <LogPanel view={view} summary={state.summary} limit={10} fontSize="1.8vmin" />
          </div>
          <TableLog />
        </div>
      </div>
    </div>
  );
}

function TicketRow({ t, done, onClick }: {
  t: { a: string; b: string; points: number };
  done?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="row between" onClick={onClick}
      style={{ opacity: done === undefined ? 1 : done ? 1 : 0.75, cursor: onClick ? 'pointer' : undefined }}>
      <span>
        {done !== undefined && <span style={{ color: done ? 'var(--accent-2)' : 'var(--text-dim)' }}>{done ? '✓ ' : '○ '}</span>}
        {NICE(t.a)} → {NICE(t.b)}
      </span>
      <span className="row" style={{ gap: 6 }}>
        {onClick && <span className="dim small">🔍 map</span>}
        <span className={`badge ${done ? 'on' : ''}`}>{t.points}</span>
      </span>
    </div>
  );
}

/**
 * The tracks this player has marked as ones they mean to build.
 *
 * Kept on the phone rather than the server: it is a private intention, nobody
 * else's business, and it should survive a reload of your own screen.
 */
function usePlan(gameId: string, seat: number) {
  const key = `ttr-plan:${gameId}:${seat}`;
  const [plan, setPlan] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(plan)); } catch { /* storage may be off */ }
  }, [key, plan]);
  const toggle = (id: string) => setPlan((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const add = (ids: string[]) => setPlan((p) => [...p, ...ids.filter((id) => !p.includes(id))]);
  return { plan, setPlan, toggle, add };
}

/**
 * A destination ticket, opened up: the two cities on the map with a suggested
 * chain of track between them — the same thing you get by holding the physical
 * ticket up against the board.
 */
function TicketDeed({ ticket, view, summary, seat, onClose, onPlan, planned }: {
  ticket: { a: string; b: string; points: number };
  view: TtrView;
  summary: GameSummary;
  seat: number;
  onClose: () => void;
  onPlan: (ids: string[]) => void;
  planned: Set<string>;
}) {
  const mapDef = mapDefOf(view);
  const path = planRoute(mapDef, view.claimed, seat, ticket.a, ticket.b);
  const todo = path.filter((id) => view.claimed[id] === undefined);
  const trains = todo.reduce((n, id) => n + mapDef.routeById[id]!.length, 0);
  const allPlanned = todo.length > 0 && todo.every((id) => planned.has(id));
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 style={{ margin: 0 }}>{NICE(ticket.a)} → {NICE(ticket.b)}</h3>
        <div className="row between">
          <span className="dim small">
            {path.length === 0
              ? 'No way through — those cities are cut off'
              : todo.length === 0
                ? 'Connected — this ticket is done'
                : `Shortest way left: ${todo.length} route${todo.length === 1 ? '' : 's'}, ${trains} 🚃`}
          </span>
          <span className="badge on">{ticket.points}</span>
        </div>
        <div className="board-frame" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
          <TtrMap view={view} summary={summary} deed={{ a: ticket.a, b: ticket.b, path: new Set(path) }} />
        </div>
        {todo.length > 0 && (
          <button className={allPlanned ? 'ghost' : 'secondary'} disabled={allPlanned}
            onClick={() => { onPlan(todo); onClose(); }}>
            {allPlanned ? '★ Already in your plan' : '★ Add these tracks to my plan'}
          </button>
        )}
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<TtrView, TtrMove>) {
  const view = state.view;
  const [keep, setKeep] = useState<number[]>([]);
  const [colorPick, setColorPick] = useState<{ route: string; colors: TrainColor[] } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [deed, setDeed] = useState<{ a: string; b: string; points: number } | null>(null);
  const { plan, setPlan, toggle: togglePlan, add: addToPlan } = usePlan(state.summary.id, yourSeat);
  if (!view) return null;
  const mapDef = mapDefOf(view);
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
  const plannedSet = new Set(plan);

  const onRoute = (id: string) => {
    const options = claimMoves.filter((m) => m.route === id);
    const colors = [...new Set(options.map((m) => m.color!))];
    if (colors.length > 1) setColorPick({ route: id, colors });
    else submitMove('CLAIM_ROUTE', { route: id, color: colors[0] });
  };

  // A tap on the map either claims the route or marks it for later, never
  // both — so marking out a plan can never cost you trains by accident.
  const onMapRoute = (id: string) => {
    if (planMode) {
      if (view.claimed[id] === undefined) togglePlan(id);
      return;
    }
    if (actionable && claimable.has(id)) onRoute(id);
  };

  const handCounts = new Map<Card, number>();
  for (const c of view.hand ?? []) handCounts.set(c, (handCounts.get(c) ?? 0) + 1);
  const locos = handCounts.get('loco') ?? 0;

  /** How many more cards you need before a route becomes payable. */
  const shortBy = (id: string) => {
    const def = mapDef.routeById[id]!;
    const best = def.color === 'gray'
      ? Math.max(0, ...Object.keys(CARD_HEX).map((c) => handCounts.get(c as Card) ?? 0))
      : handCounts.get(def.color as Card) ?? 0;
    return Math.max(0, def.length - best - locos);
  };

  // Routes you can afford right now, with the ones you planned pushed to the
  // top — that is the whole point of having planned them.
  const claimList = [...claimable].sort((a, b) => {
    const pa = plan.indexOf(a), pb = plan.indexOf(b);
    if (pa !== pb) return (pa < 0 ? Number.MAX_SAFE_INTEGER : pa) - (pb < 0 ? Number.MAX_SAFE_INTEGER : pb);
    return mapDef.routeById[b]!.length - mapDef.routeById[a]!.length;
  });

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
                className="row between"
                style={{
                  padding: '0.5em 0.8em', borderRadius: 12,
                  background: keep.includes(i) ? 'rgba(46,230,201,0.15)' : 'var(--bg-raised)',
                  border: keep.includes(i) ? '1.5px solid var(--accent-2)' : '1.5px solid transparent',
                }}>
                <span style={{ cursor: 'pointer', flex: 1 }}
                  onClick={() => setKeep((k) => (k.includes(i) ? k.filter((x) => x !== i) : [...k, i]))}>
                  {keep.includes(i) ? '☑' : '☐'} {NICE(t.a)} → {NICE(t.b)}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <button className="ghost" style={{ padding: '0.2em 0.5em' }} onClick={() => setDeed(t)}>🔍</button>
                  <span className="badge">{t.points}</span>
                </span>
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

      {/* routes you can afford, as tappable rows — the map lives on the TV */}
      {actionable && claimList.length > 0 && (
        <div className="card">
          <h3>Routes you can claim</h3>
          {claimList.map((id) => {
            const def = mapDef.routeById[id]!;
            return (
              <button key={id} className="secondary" style={{ width: '100%', textAlign: 'left' }}
                onClick={() => onRoute(id)}>
                <span style={{
                  display: 'inline-block', width: 12, height: 12, borderRadius: 3, marginRight: 8,
                  background: ROUTE_HEX[def.color], border: '1px solid rgba(0,0,0,0.4)', verticalAlign: -1,
                }} />
                {plannedSet.has(id) && <span style={{ color: PLAN_HEX }}>★ </span>}
                {NICE(def.a)} → {NICE(def.b)} · {def.length} 🚃
              </button>
            );
          })}
        </div>
      )}

      {plan.length > 0 && state.status !== 'completed' && (
        <div className="card">
          <div className="row between">
            <h3 style={{ margin: 0 }}>★ Your plan</h3>
            <button className="ghost" style={{ padding: '0.2em 0.6em' }} onClick={() => setPlan([])}>clear</button>
          </div>
          {plan.map((id) => {
            const def = mapDef.routeById[id];
            if (!def) return null;
            const owner = view.claimed[id];
            const short = shortBy(id);
            const note = owner === yourSeat ? '✓ built'
              : owner !== undefined ? `taken by ${seatName(state.summary, owner)}`
                : claimable.has(id) ? 'ready now'
                  : short > 0 ? `need ${short} more` : `${def.length} 🚃`;
            return (
              <div key={id} className="row between"
                style={{ opacity: owner !== undefined && owner !== yourSeat ? 0.5 : 1 }}>
                <span>
                  <span style={{
                    display: 'inline-block', width: 12, height: 12, borderRadius: 3, marginRight: 8,
                    background: ROUTE_HEX[def.color], border: '1px solid rgba(0,0,0,0.4)', verticalAlign: -1,
                  }} />
                  {NICE(def.a)} → {NICE(def.b)}
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <span className={`badge ${claimable.has(id) ? 'on' : ''}`}>{note}</span>
                  <button className="ghost" style={{ padding: '0.2em 0.5em' }} onClick={() => togglePlan(id)}>✕</button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="action-bar">
        <button className="ghost" onClick={() => setShowMap((s) => !s)}>
          {showMap ? 'Hide map' : 'Show map'}
        </button>
        {showMap && (
          <button className={planMode ? 'secondary' : 'ghost'} onClick={() => setPlanMode((p) => !p)}>
            {planMode ? '★ Planning — tap tracks to mark' : '★ Plan tracks'}
          </button>
        )}
      </div>
      {showMap && (
        <div className="board-frame">
          <TtrMap view={view} summary={state.summary} planned={plannedSet}
            claimable={actionable && !planMode ? claimable : undefined} onRoute={onMapRoute} />
        </div>
      )}

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
          <p className="dim small" style={{ marginTop: 0 }}>Tap a ticket to see it on the map.</p>
          {view.tickets.map((t, i) => <TicketRow key={i} t={t} done={t.completed} onClick={() => setDeed(t)} />)}
        </div>
      )}

      {deed && (
        <TicketDeed ticket={deed} view={view} summary={state.summary} seat={yourSeat}
          planned={plannedSet} onPlan={addToPlan} onClose={() => setDeed(null)} />
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
