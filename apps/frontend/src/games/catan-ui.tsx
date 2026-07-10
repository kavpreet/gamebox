import React, { useMemo, useState } from 'react';
import type { CatanPublic, CatanMove, Resource, DevCard } from '@gamebox/game-catan';
import {
  cornersOf, hexCenter, vertexXY, edgeVertices, hexKey, RESOURCES,
} from '@gamebox/game-catan';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner } from './common.js';

type CatanView = CatanPublic & {
  yourResources: Record<Resource, number> | null;
  yourDevCards: DevCard[] | null;
  yourNewDevCards: DevCard[] | null;
};

const SEAT_COLORS = ['#e94560', '#2ec4b6', '#f5a623', '#7c5cff'];
const TILE_HEX: Record<string, string> = {
  wood: '#2e7d46', brick: '#b3552e', sheep: '#8fce5a', wheat: '#e5c355', ore: '#8b90a8', desert: '#d8c48f',
};
const TILE_EMOJI: Record<string, string> = {
  wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰', desert: '🏜',
};
const S = 56; // hex render size

function px(v: { x: number; y: number }): { x: number; y: number } {
  return { x: v.x * S + 340, y: v.y * S + 300 };
}

function hexCornerPoints(q: number, r: number): string {
  return cornersOf(q, r)
    .map((v) => {
      const p = px(vertexXY(v));
      return `${p.x},${p.y}`;
    })
    // corners come in an order that isn't a polygon ring — sort by angle
    .join(' ');
}

function orderedHexPolygon(q: number, r: number): string {
  const c = px(hexCenter(q, r));
  return cornersOf(q, r)
    .map((v) => px(vertexXY(v)))
    .sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
}

function Board({
  view,
  clickVertices,
  clickEdges,
  clickHexes,
  onVertex,
  onEdge,
  onHex,
}: {
  view: CatanView;
  clickVertices?: Set<string>;
  clickEdges?: Set<string>;
  clickHexes?: Set<string>;
  onVertex?: (v: string) => void;
  onEdge?: (e: string) => void;
  onHex?: (h: string) => void;
}) {
  const allEdges = useMemo(() => {
    const set = new Set<string>();
    for (const e of Object.keys(view.roads)) set.add(e);
    if (clickEdges) for (const e of clickEdges) set.add(e);
    return [...set];
  }, [view.roads, clickEdges]);

  return (
    <svg viewBox="0 0 680 600" style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      {view.hexes.map((h) => {
        const key = hexKey(h.q, h.r);
        const c = px(hexCenter(h.q, h.r));
        const clickable = clickHexes?.has(key);
        return (
          <g key={key} onClick={clickable && onHex ? () => onHex(key) : undefined}
            style={clickable ? { cursor: 'pointer' } : undefined}>
            <polygon points={orderedHexPolygon(h.q, h.r)} fill={TILE_HEX[h.tile]}
              stroke={clickable ? '#2ec4b6' : '#0f1220'} strokeWidth={clickable ? 4 : 2.5}
              opacity={0.9} />
            <text x={c.x} y={c.y - 8} textAnchor="middle" fontSize={18}>{TILE_EMOJI[h.tile]}</text>
            {h.token !== null && (
              <>
                <circle cx={c.x} cy={c.y + 12} r={13} fill="#f4ecd7" stroke="#0f1220" />
                <text x={c.x} y={c.y + 17} textAnchor="middle" fontSize={13} fontWeight={800}
                  fill={h.token === 6 || h.token === 8 ? '#c62828' : '#333'}>
                  {h.token}
                </text>
              </>
            )}
            {view.robber === key && (
              <text x={c.x} y={c.y + 40} textAnchor="middle" fontSize={22}>🦹</text>
            )}
          </g>
        );
      })}
      {/* roads + buildable edges */}
      {allEdges.map((e) => {
        const [a, b] = edgeVertices(e);
        const pa = px(vertexXY(a));
        const pb = px(vertexXY(b));
        const owner = view.roads[e];
        const clickable = clickEdges?.has(e) && owner === undefined;
        if (owner === undefined && !clickable) return null;
        return (
          <line key={e} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke={owner !== undefined ? SEAT_COLORS[owner % 4] : 'rgba(46,196,182,0.55)'}
            strokeWidth={owner !== undefined ? 7 : 9}
            strokeLinecap="round"
            strokeDasharray={clickable ? '4 6' : undefined}
            onClick={clickable && onEdge ? () => onEdge(e) : undefined}
            style={clickable ? { cursor: 'pointer' } : undefined} />
        );
      })}
      {/* buildings + buildable vertices */}
      {Object.entries(view.buildings).map(([v, b]) => {
        const p = px(vertexXY(v));
        return b.city ? (
          <rect key={v} x={p.x - 10} y={p.y - 10} width={20} height={20} rx={4}
            fill={SEAT_COLORS[b.owner % 4]} stroke="#0f1220" strokeWidth={2.5} />
        ) : (
          <circle key={v} cx={p.x} cy={p.y} r={9}
            fill={SEAT_COLORS[b.owner % 4]} stroke="#0f1220" strokeWidth={2.5} />
        );
      })}
      {clickVertices && [...clickVertices].map((v) => {
        if (view.buildings[v]) return null;
        const p = px(vertexXY(v));
        return (
          <circle key={v} cx={p.x} cy={p.y} r={10} fill="rgba(46,196,182,0.5)"
            stroke="#2ec4b6" strokeWidth={2.5}
            onClick={onVertex ? () => onVertex(v) : undefined} style={{ cursor: 'pointer' }} />
        );
      })}
    </svg>
  );
}

function Sidebar({ state, view }: { state: { summary: any; activeSeats: number[] }; view: CatanView }) {
  return (
    <>
      {view.order.map((s) => (
        <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}>
          <span className="token" style={{ background: SEAT_COLORS[s % 4] }} />
          <span className="grow">
            {seatName(state.summary, s)}
            <div className="dim small">
              🃏{view.resourceCounts[s] ?? 0} · 🂠{view.devCardCounts[s] ?? 0} · ⚔{view.knightsPlayed[s] ?? 0}
              {view.longestRoadOwner === s && ' · 🛣'}
              {view.largestArmyOwner === s && ' · 🎖'}
            </div>
          </span>
          <strong>{view.publicScores[s] ?? 0}★</strong>
        </div>
      ))}
    </>
  );
}

function TvView({ state }: TvViewProps<CatanView>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} />
      </div>
      <div className="tv-sidebar">
        <Sidebar state={state} view={view} />
        {view.lastRoll && <div className="tv-player-chip">🎲 {view.lastRoll.d1} + {view.lastRoll.d2}</div>}
        {view.phase === 'SETUP' && <div className="tv-player-chip dim">initial placement…</div>}
        {view.lastEvent && <div className="tv-player-chip dim small">{view.lastEvent}</div>}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

const RES_EMOJI: Record<Resource, string> = { wood: '🌲', brick: '🧱', sheep: '🐑', wheat: '🌾', ore: '⛰' };

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<CatanView, CatanMove>) {
  const view = state.view;
  const [mode, setMode] = useState<'none' | 'road' | 'settlement' | 'city' | 'setup' | 'robber' | 'knight'>('none');
  const [setupVertex, setSetupVertex] = useState<string | null>(null);
  const [discard, setDiscard] = useState<Partial<Record<Resource, number>>>({});
  const [showTrade, setShowTrade] = useState(false);
  const [tradeTo, setTradeTo] = useState<number | null>(null);
  const [give, setGive] = useState<Partial<Record<Resource, number>>>({});
  const [get, setGet] = useState<Partial<Record<Resource, number>>>({});
  if (!view) return null;
  const legal = (state.legalMoves ?? []) as CatanMove[];
  const kinds = new Set(legal.map((m) => m.kind));
  const myTurnish = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const res = view.yourResources;

  // click sets by mode
  let clickVertices: Set<string> | undefined;
  let clickEdges: Set<string> | undefined;
  let clickHexes: Set<string> | undefined;
  if (view.phase === 'SETUP' && myTurnish) {
    if (!setupVertex) {
      clickVertices = new Set(legal.filter((m) => m.kind === 'PLACE_SETUP').map((m) => (m as any).vertex));
    } else {
      clickEdges = new Set(
        legal.filter((m) => m.kind === 'PLACE_SETUP' && (m as any).vertex === setupVertex).map((m) => (m as any).edge),
      );
    }
  } else if ((view.phase === 'ROBBER' && myTurnish) || mode === 'robber' || mode === 'knight') {
    const kind = view.phase === 'ROBBER' ? 'MOVE_ROBBER' : 'PLAY_KNIGHT';
    clickHexes = new Set(legal.filter((m) => m.kind === kind).map((m) => (m as any).hex));
  } else if (mode === 'road') {
    clickEdges = new Set(legal.filter((m) => m.kind === 'BUILD_ROAD').map((m) => (m as any).edge));
  } else if (mode === 'settlement') {
    clickVertices = new Set(legal.filter((m) => m.kind === 'BUILD_SETTLEMENT').map((m) => (m as any).vertex));
  } else if (mode === 'city') {
    clickVertices = new Set(legal.filter((m) => m.kind === 'BUILD_CITY').map((m) => (m as any).vertex));
  }

  const robberSteal = (hex: string) => {
    const kind = view.phase === 'ROBBER' ? 'MOVE_ROBBER' : 'PLAY_KNIGHT';
    const options = legal.filter((m) => m.kind === kind && (m as any).hex === hex) as any[];
    // if multiple victims, take the first (UI simplification); none → plain move
    submitMove(kind, options[0] ?? { hex });
    setMode('none');
  };

  const discardOwed = view.discardsPending[yourSeat] ?? 0;
  const discardTotal = RESOURCES.reduce((x, k) => x + (discard[k] ?? 0), 0);

  const bump = (obj: Partial<Record<Resource, number>>, set: (v: any) => void, k: Resource, d: number, max?: number) => {
    const next = Math.max(0, Math.min(max ?? 99, (obj[k] ?? 0) + d));
    set({ ...obj, [k]: next });
  };

  return (
    <div className="page wide">
      <div className="card center">
        {res && (
          <div className="row" style={{ justifyContent: 'center' }}>
            {RESOURCES.map((k) => (
              <span key={k} className="badge">{RES_EMOJI[k]} {res[k]}</span>
            ))}
            <span className="badge on">{view.publicScores[yourSeat] ?? 0}★</span>
          </div>
        )}
        {view.yourDevCards && view.yourDevCards.length + (view.yourNewDevCards?.length ?? 0) > 0 && (
          <p className="dim small">
            dev: {view.yourDevCards.join(', ')}
            {view.yourNewDevCards!.length > 0 && ` (new: ${view.yourNewDevCards!.join(', ')})`}
          </p>
        )}

        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : !myTurnish ? (
          <p className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</p>
        ) : view.phase === 'SETUP' ? (
          <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {setupVertex ? 'Now tap an edge for your road' : 'Tap a highlighted corner for your settlement'}
          </p>
        ) : discardOwed > 0 ? (
          <>
            <p className="error">Discard {discardOwed} cards ({discardTotal} picked)</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              {RESOURCES.map((k) => (
                <button key={k} className="secondary"
                  onClick={() => bump(discard, setDiscard, k, 1, res?.[k] ?? 0)}>
                  {RES_EMOJI[k]} {discard[k] ?? 0}
                </button>
              ))}
              <button disabled={discardTotal !== discardOwed}
                onClick={() => { submitMove('DISCARD', { resources: discard }); setDiscard({}); }}>
                Discard
              </button>
            </div>
          </>
        ) : view.phase === 'ROBBER' ? (
          <p style={{ color: 'var(--gold)', fontWeight: 700 }}>Move the robber — tap a highlighted hex</p>
        ) : view.pendingTrade && view.pendingTrade.to === yourSeat ? (
          <>
            <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
              🤝 {seatName(state.summary, view.pendingTrade.from)} offers{' '}
              {RESOURCES.filter((k) => (view.pendingTrade!.give[k] ?? 0) > 0).map((k) => `${view.pendingTrade!.give[k]}${RES_EMOJI[k]}`).join(' ') || 'nothing'}
              {' for '}
              {RESOURCES.filter((k) => (view.pendingTrade!.get[k] ?? 0) > 0).map((k) => `${view.pendingTrade!.get[k]}${RES_EMOJI[k]}`).join(' ') || 'nothing'}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button onClick={() => submitMove('RESPOND_TRADE', { accept: true })}>Accept</button>
              <button className="secondary" onClick={() => submitMove('RESPOND_TRADE', { accept: false })}>Reject</button>
            </div>
          </>
        ) : view.phase === 'ROLL' ? (
          <button className="big" style={{ width: 'auto' }} onClick={() => submitMove('ROLL', {})}>🎲 Roll</button>
        ) : (
          <>
            {mode !== 'none' && <p className="dim small">Tap the board — or <a onClick={() => setMode('none')}>cancel</a></p>}
            <div className="row" style={{ justifyContent: 'center' }}>
              {kinds.has('BUILD_ROAD') && <button className={mode === 'road' ? '' : 'secondary'} onClick={() => setMode(mode === 'road' ? 'none' : 'road')}>🛣 Road</button>}
              {kinds.has('BUILD_SETTLEMENT') && <button className={mode === 'settlement' ? '' : 'secondary'} onClick={() => setMode(mode === 'settlement' ? 'none' : 'settlement')}>🏠 Settlement</button>}
              {kinds.has('BUILD_CITY') && <button className={mode === 'city' ? '' : 'secondary'} onClick={() => setMode(mode === 'city' ? 'none' : 'city')}>🏛 City</button>}
              {kinds.has('BUY_DEV') && <button className="secondary" onClick={() => submitMove('BUY_DEV', {})}>🂠 Buy dev</button>}
              {kinds.has('PLAY_KNIGHT') && <button className={mode === 'knight' ? '' : 'secondary'} onClick={() => setMode(mode === 'knight' ? 'none' : 'knight')}>⚔ Knight</button>}
              {kinds.has('PLAY_ROAD_BUILDING') && (
                <button className="secondary" onClick={() => submitMove('PLAY_ROAD_BUILDING', legal.find((m) => m.kind === 'PLAY_ROAD_BUILDING'))}>
                  🛤 Road building
                </button>
              )}
              {kinds.has('PLAY_MONOPOLY') && (
                <select style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && submitMove('PLAY_MONOPOLY', { resource: e.target.value })}>
                  <option value="">🎩 Monopoly…</option>
                  {RESOURCES.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
              {kinds.has('PLAY_YEAR_OF_PLENTY') && (
                <button className="secondary" onClick={() => {
                  submitMove('PLAY_YEAR_OF_PLENTY', { r1: 'wheat', r2: 'ore' });
                }}>🎁 Year of plenty</button>
              )}
              <button className="ghost" onClick={() => setShowTrade(!showTrade)}>🤝 Trade…</button>
              <button className="secondary" onClick={() => { setMode('none'); submitMove('END_TURN', {}); }}>End turn</button>
            </div>
            {legal.some((m) => m.kind === 'BANK_TRADE') && (
              <div className="row small" style={{ justifyContent: 'center' }}>
                <span className="dim">Bank 4:1:</span>
                {legal.filter((m) => m.kind === 'BANK_TRADE').slice(0, 8).map((m, i) => (
                  <button key={i} className="ghost" onClick={() => submitMove('BANK_TRADE', m)}>
                    4{RES_EMOJI[(m as any).give as Resource]}→1{RES_EMOJI[(m as any).get as Resource]}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {view.lastEvent && <p className="dim small">{view.lastEvent}</p>}
      </div>

      <div className="card">
        <Board
          view={view}
          clickVertices={clickVertices}
          clickEdges={clickEdges}
          clickHexes={clickHexes}
          onVertex={(v) => {
            if (view.phase === 'SETUP') { setSetupVertex(v); return; }
            if (mode === 'settlement') { submitMove('BUILD_SETTLEMENT', { vertex: v }); setMode('none'); }
            if (mode === 'city') { submitMove('BUILD_CITY', { vertex: v }); setMode('none'); }
          }}
          onEdge={(e) => {
            if (view.phase === 'SETUP' && setupVertex) {
              submitMove('PLACE_SETUP', { vertex: setupVertex, edge: e });
              setSetupVertex(null);
              return;
            }
            if (mode === 'road') { submitMove('BUILD_ROAD', { edge: e }); setMode('none'); }
          }}
          onHex={robberSteal}
        />
      </div>

      <div className="card">
        <Sidebar state={state} view={view} />
      </div>

      {showTrade && res && (
        <div className="card">
          <h3>Propose a trade</h3>
          <select value={tradeTo ?? ''} onChange={(e) => setTradeTo(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">Pick a player…</option>
            {view.order.filter((s) => s !== yourSeat).map((s) => (
              <option key={s} value={s}>{seatName(state.summary, s)}</option>
            ))}
          </select>
          {tradeTo !== null && (
            <>
              <p className="small dim">You give:</p>
              <div className="row">
                {RESOURCES.map((k) => (
                  <button key={k} className="secondary" onClick={() => bump(give, setGive, k, 1, res[k])}>
                    {RES_EMOJI[k]} {give[k] ?? 0}
                  </button>
                ))}
              </div>
              <p className="small dim">You get:</p>
              <div className="row">
                {RESOURCES.map((k) => (
                  <button key={k} className="secondary" onClick={() => bump(get, setGet, k, 1)}>
                    {RES_EMOJI[k]} {get[k] ?? 0}
                  </button>
                ))}
              </div>
              <button onClick={async () => {
                const err = await submitMove('PROPOSE_TRADE', { to: tradeTo, give, get });
                if (!err) { setShowTrade(false); setGive({}); setGet({}); }
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

export const catanUi: GameUi = { slug: 'catan', PlayerView, TvView };
