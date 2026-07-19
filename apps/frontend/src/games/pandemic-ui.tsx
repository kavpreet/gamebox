import React, { useState } from 'react';
import type { PandemicPublic, PandemicMove } from '@gamebox/game-pandemic';
import { CITIES, type Disease } from '@gamebox/game-pandemic';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner, Prompt, Waiting, EventLine } from './common.js';

const DISEASE_HEX: Record<Disease, string> = {
  blue: '#45a6ff',
  yellow: '#ffb930',
  black: '#b8bede',
  red: '#ff4d6d',
};
const PAWN_COLORS = ['#ffffff', '#2ee6c9', '#8b6cff', '#9ad14b'];

const POS: Record<string, [number, number]> = {
  'san-francisco': [6, 20], chicago: [14, 19], atlanta: [16, 26], montreal: [21, 16],
  washington: [22, 24], 'new-york': [26, 19], madrid: [38, 25], london: [39, 15],
  paris: [45, 21], essen: [47, 14], milan: [50, 20], 'st-petersburg': [54, 10],
  'los-angeles': [7, 29], 'mexico-city': [12, 34], miami: [19, 32], bogota: [18, 42],
  lima: [16, 51], santiago: [17, 61], 'buenos-aires': [25, 60], 'sao-paulo': [28, 53],
  lagos: [43, 43], kinshasa: [48, 50], johannesburg: [51, 59], khartoum: [52, 42],
  algiers: [44, 30], cairo: [50, 32], istanbul: [53, 24], moscow: [58, 14],
  baghdad: [57, 30], riyadh: [58, 37], tehran: [63, 22], karachi: [64, 31],
  mumbai: [64, 39], delhi: [69, 27], chennai: [69, 43], kolkata: [73, 31],
  beijing: [78, 17], seoul: [85, 17], tokyo: [90, 21], shanghai: [80, 25],
  'hong-kong': [78, 33], taipei: [85, 30], osaka: [90, 28], bangkok: [74, 40],
  jakarta: [75, 50], 'ho-chi-minh-city': [80, 43], manila: [86, 41], sydney: [88, 58],
};

const NICE = (c: string) => c.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

function Map({
  view,
  highlights,
  onCity,
}: {
  view: PandemicPublic;
  highlights?: Set<string>;
  onCity?: (c: string) => void;
}) {
  const S = 10;
  const edges: React.ReactElement[] = [];
  const seen = new Set<string>();
  for (const [c, info] of Object.entries(CITIES)) {
    for (const n of info.neighbors) {
      const key = [c, n].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const [x1, y1] = POS[c]!;
      const [x2, y2] = POS[n]!;
      const wrap = Math.abs(x1 - x2) > 40;
      if (wrap) {
        const [w, e] = x1 < x2 ? [[x1, y1], [x2, y2]] : [[x2, y2], [x1, y1]];
        edges.push(
          <g key={key}>
            <line x1={w[0]! * S} y1={w[1]! * S} x2={0} y2={w[1]! * S} stroke="#2a3560" strokeWidth={2.5} strokeDasharray="6 5" />
            <line x1={e[0]! * S} y1={e[1]! * S} x2={1000} y2={e[1]! * S} stroke="#2a3560" strokeWidth={2.5} strokeDasharray="6 5" />
          </g>,
        );
      } else {
        edges.push(<line key={key} x1={x1 * S} y1={y1 * S} x2={x2 * S} y2={y2 * S} stroke="#2a3560" strokeWidth={2.5} />);
      }
    }
  }

  return (
    <svg viewBox="0 0 1000 660" style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      <defs>
        <radialGradient id="pan-ocean" cx="50%" cy="40%" r="80%">
          <stop offset="0%" stopColor="#101a3c" />
          <stop offset="100%" stopColor="#0a0e24" />
        </radialGradient>
        <filter id="pan-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width={1000} height={660} rx={14} fill="url(#pan-ocean)" />
      {edges}
      {Object.entries(POS).map(([c, [x, y]]) => {
        const info = CITIES[c]!;
        const cubes = view.cubes[c] ?? {};
        const totalCubes = Object.values(cubes).reduce((a, b) => a + (b ?? 0), 0);
        const hasStation = view.stations.includes(c);
        const playersHere = view.order.filter((s) => view.players[s]?.city === c);
        const isHi = highlights?.has(c);
        return (
          <g key={c} onClick={onCity ? () => onCity(c) : undefined} style={onCity ? { cursor: 'pointer' } : undefined}>
            {isHi && (
              <circle cx={x * S} cy={y * S} r={21} fill="rgba(46,230,201,0.15)" stroke="#2ee6c9" strokeWidth={3.5}>
                <animate attributeName="r" values="19;23;19" dur="1.4s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={x * S} cy={y * S} r={13} fill={DISEASE_HEX[info.color]} stroke="#0a0e24" strokeWidth={2.5}
              filter={totalCubes >= 3 ? 'url(#pan-glow)' : undefined} />
            <circle cx={x * S - 4} cy={y * S - 4} r={4} fill="rgba(255,255,255,0.35)" />
            {hasStation && (
              <g>
                <rect x={x * S - 24} y={y * S - 22} width={15} height={13} rx={2} fill="#f2f4ff" stroke="#0a0e24" strokeWidth={1.5} />
                <path d={`M ${x * S - 25} ${y * S - 21} L ${x * S - 16.5} ${y * S - 27} L ${x * S - 8} ${y * S - 21}`}
                  fill="#f2f4ff" stroke="#0a0e24" strokeWidth={1.5} />
              </g>
            )}
            {/* cube stacks */}
            {Object.entries(cubes).map(([d, n], i) =>
              n ? (
                <g key={d}>
                  {Array.from({ length: Math.min(n, 3) }, (_, j) => (
                    <rect key={j} x={x * S + 15 + j * 4} y={y * S - 14 + i * 13 + j * -3} width={10} height={10} rx={2}
                      fill={DISEASE_HEX[d as Disease]} stroke="#0a0e24" strokeWidth={1.2} />
                  ))}
                </g>
              ) : null,
            )}
            {/* pawns */}
            {playersHere.map((s, i) => (
              <g key={s}>
                <circle cx={x * S - 12 + i * 10} cy={y * S + 16} r={5.5}
                  fill={PAWN_COLORS[view.order.indexOf(s) % 4]} stroke="#0a0e24" strokeWidth={1.5} />
              </g>
            ))}
            <text x={x * S} y={y * S + 33} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#8f97c4">{NICE(c)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Track({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <span className="badge" title={label}>
      {label}{' '}
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: 4, marginLeft: 2,
          background: i < value ? color : 'rgba(140,150,220,0.25)',
        }} />
      ))}
    </span>
  );
}

function StatusBar({ view }: { view: PandemicPublic }) {
  return (
    <div className="action-bar" style={{ gap: '0.5rem' }}>
      <Track label="outbreaks" value={view.outbreaks} max={8} color="#ff5470" />
      <span className="badge">infects {[2, 2, 2, 3, 3, 4, 4][view.infectionRateIndex]}/turn</span>
      <span className="badge">deck {view.playerDeckSize}</span>
      {(['blue', 'yellow', 'black', 'red'] as Disease[]).map((d) => (
        <span key={d} className="badge" style={{ color: DISEASE_HEX[d] }}>
          {view.eradicated[d] ? '✦ eradicated' : view.cured[d] ? '✓ CURED' : `● ${view.cubesLeft[d]}`}
        </span>
      ))}
    </div>
  );
}

function CityCard({ name, epidemic, onClick }: { name?: string; epidemic?: boolean; onClick?: () => void }) {
  const color = epidemic ? '#ff5470' : DISEASE_HEX[CITIES[name!]!.color];
  return (
    <div
      onClick={onClick}
      className={`hand-card${onClick ? ' clickable' : ''}`}
      style={{
        minWidth: 86, padding: '0.6em 0.7em', gap: 3,
        background: epidemic
          ? 'linear-gradient(150deg, #40182a, #2a0f1c)'
          : 'linear-gradient(150deg, #232b52, #181e3c)',
        border: `2px solid ${color}`,
      }}
    >
      <span style={{ fontSize: 18 }}>{epidemic ? '☣️' : '🏙️'}</span>
      <span style={{ fontSize: 12.5, color: epidemic ? '#ff93a6' : 'var(--text)' }}>
        {epidemic ? 'Epidemic' : NICE(name!)}
      </span>
    </div>
  );
}

function TvView({ state }: TvViewProps<PandemicPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main" style={{ flexDirection: 'column' }}>
      <StatusBar view={view} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '2vmin' }}>
        <div className="tv-board">
          <Map view={view} />
        </div>
        <div className="tv-sidebar">
          {view.order.map((s) => (
            <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}>
              <span className="token" style={{ background: PAWN_COLORS[view.order.indexOf(s) % 4] }} />
              <span className="grow">
                {seatName(state.summary, s)}
                <div className="dim small">{view.players[s]!.role} · {NICE(view.players[s]!.city)}</div>
              </span>
              <strong>{view.players[s]!.hand.length}</strong>
            </div>
          ))}
          {view.lastEvent && <div className="tv-player-chip dim small">{view.lastEvent}</div>}
          {view.result === 'lost' && <div className="tv-player-chip" style={{ borderColor: 'var(--danger)' }}>💀 Lost — {view.lossReason}</div>}
          <WinnerBanner state={state} />
        </div>
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<PandemicPublic, PandemicMove>) {
  const view = state.view;
  const [moveMode, setMoveMode] = useState<'DRIVE' | 'DIRECT_FLIGHT' | 'CHARTER_FLIGHT' | 'SHUTTLE'>('DRIVE');
  if (!view) return null;
  const legal = (state.legalMoves ?? []) as PandemicMove[];
  const me = view.players[yourSeat];
  if (!me) return <p className="error center">You were removed from this game.</p>;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const discarding = view.phase === 'DISCARD' && view.discardSeat === yourSeat;

  const cityTargets = new Set(
    legal.filter((m) => m.kind === moveMode).map((m) => (m as { city: string }).city),
  );

  const kinds = new Set(legal.map((m) => m.kind));

  const onCity = (c: string) => {
    if (!myTurn || discarding) return;
    if (cityTargets.has(c)) submitMove(moveMode, { city: c });
  };

  return (
    <div className="page wide">
      <div className="card center">
        <StatusBar view={view} />
        {state.status === 'completed' ? (
          view.result === 'lost' ? (
            <Prompt danger>💀 The diseases won — {view.lossReason}</Prompt>
          ) : (
            <WinnerBanner state={state} />
          )
        ) : discarding ? (
          <Prompt danger>Hand over 7 — tap a card below to discard</Prompt>
        ) : myTurn ? (
          <>
            <Prompt>
              {me.role} · {NICE(me.city)} · {view.actionsLeft} action{view.actionsLeft === 1 ? '' : 's'} left
            </Prompt>
            <div className="action-bar">
              {(['DRIVE', 'DIRECT_FLIGHT', 'CHARTER_FLIGHT', 'SHUTTLE'] as const).map((mk) => (
                <button key={mk}
                  className={moveMode === mk ? '' : 'secondary'}
                  disabled={!legal.some((m) => m.kind === mk)}
                  onClick={() => setMoveMode(mk)}>
                  {mk === 'DRIVE' ? '🚗 Drive' : mk === 'DIRECT_FLIGHT' ? '✈ Direct' : mk === 'CHARTER_FLIGHT' ? '✈ Charter' : '🚁 Shuttle'}
                </button>
              ))}
            </div>
            <div className="action-bar">
              {kinds.has('BUILD') && <button onClick={() => submitMove('BUILD', {})}>🏥 Build station</button>}
              {legal.filter((m) => m.kind === 'TREAT').map((m) => (
                <button key={(m as { disease: string }).disease}
                  style={{ background: DISEASE_HEX[(m as { disease: Disease }).disease], color: '#0a0e24' }}
                  onClick={() => submitMove('TREAT', m)}>
                  💊 Treat {(m as { disease: string }).disease}
                </button>
              ))}
              {legal.filter((m) => m.kind === 'CURE').map((m, i) => (
                <button key={i} className="gold" onClick={() => submitMove('CURE', m)}>
                  💉 Cure {(m as { disease: string }).disease}!
                </button>
              ))}
              {legal.filter((m) => m.kind === 'SHARE').map((m, i) => (
                <button key={i} className="secondary" onClick={() => submitMove('SHARE', m)}>
                  {(m as { direction: string }).direction === 'give' ? 'Give card to' : 'Take card from'}{' '}
                  {seatName(state.summary, (m as { withSeat: number }).withSeat)}
                </button>
              ))}
              <button className="ghost" onClick={() => submitMove('PASS', {})}>End turn</button>
            </div>
          </>
        ) : (
          <Waiting state={state} />
        )}
        <EventLine text={view.lastEvent} />
      </div>

      <div className="board-frame">
        <Map view={view} highlights={myTurn && !discarding ? cityTargets : undefined} onCity={onCity} />
      </div>

      <div className="card">
        <h3>Your hand ({me.hand.length}/7)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {me.hand.map((card, i) => (
            <CityCard
              key={i}
              name={card.kind === 'city' ? card.city : undefined}
              epidemic={card.kind === 'epidemic'}
              onClick={discarding ? () => submitMove('DISCARD', { card: i }) : undefined}
            />
          ))}
        </div>
        {/* teammates' open hands */}
        {view.order.filter((s) => s !== yourSeat).map((s) => (
          <p key={s} className="dim small">
            {seatName(state.summary, s)} ({view.players[s]!.role}, {NICE(view.players[s]!.city)}):{' '}
            {view.players[s]!.hand.map((c) => (c.kind === 'city' ? NICE(c.city) : 'Epidemic')).join(', ') || 'no cards'}
          </p>
        ))}
      </div>
    </div>
  );
}

export const pandemicUi: GameUi = { slug: 'pandemic', PlayerView, TvView };
