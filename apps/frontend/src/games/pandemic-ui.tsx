import React, { useState } from 'react';
import type { PandemicPublic, PandemicMove } from '@gamebox/game-pandemic';
import { CITIES, type Disease } from '@gamebox/game-pandemic';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner } from './common.js';

const DISEASE_HEX: Record<Disease, string> = {
  blue: '#3fa7ff',
  yellow: '#f5a623',
  black: '#9aa0c3',
  red: '#e94560',
};
const SEAT_COLORS = ['#ffffff', '#2ec4b6', '#7c5cff', '#9ad14b'];

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
            <line x1={w[0]! * S} y1={w[1]! * S} x2={0} y2={w[1]! * S} stroke="#2c3255" strokeWidth={2.5} strokeDasharray="6 5" />
            <line x1={e[0]! * S} y1={e[1]! * S} x2={1000} y2={e[1]! * S} stroke="#2c3255" strokeWidth={2.5} strokeDasharray="6 5" />
          </g>,
        );
      } else {
        edges.push(<line key={key} x1={x1 * S} y1={y1 * S} x2={x2 * S} y2={y2 * S} stroke="#2c3255" strokeWidth={2.5} />);
      }
    }
  }

  return (
    <svg viewBox="0 0 1000 660" style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      {edges}
      {Object.entries(POS).map(([c, [x, y]]) => {
        const info = CITIES[c]!;
        const cubes = view.cubes[c] ?? {};
        const hasStation = view.stations.includes(c);
        const playersHere = view.order.filter((s) => view.players[s]?.city === c);
        const isHi = highlights?.has(c);
        return (
          <g key={c} onClick={onCity ? () => onCity(c) : undefined} style={onCity ? { cursor: 'pointer' } : undefined}>
            {isHi && <circle cx={x * S} cy={y * S} r={22} fill="none" stroke="#2ec4b6" strokeWidth={4} />}
            <circle cx={x * S} cy={y * S} r={14} fill={DISEASE_HEX[info.color]} stroke="#0f1220" strokeWidth={2} />
            {hasStation && (
              <rect x={x * S - 20} y={y * S - 20} width={12} height={12} fill="#eef0ff" stroke="#0f1220" rx={2} />
            )}
            {/* cubes */}
            {Object.entries(cubes).map(([d, n], i) =>
              n ? (
                <g key={d}>
                  <circle cx={x * S + 18} cy={y * S - 12 + i * 14} r={7} fill={DISEASE_HEX[d as Disease]} stroke="#0f1220" />
                  <text x={x * S + 18} y={y * S - 8 + i * 14} textAnchor="middle" fontSize={10} fontWeight={800} fill="#0f1220">{n}</text>
                </g>
              ) : null,
            )}
            {/* pawns */}
            {playersHere.map((s, i) => (
              <circle key={s} cx={x * S - 12 + i * 9} cy={y * S + 16} r={5.5}
                fill={SEAT_COLORS[view.order.indexOf(s) % 4]} stroke="#0f1220" strokeWidth={1.5} />
            ))}
            <text x={x * S} y={y * S + 34} textAnchor="middle" fontSize={11.5} fill="#9aa0c3">{NICE(c)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function StatusBar({ view }: { view: PandemicPublic }) {
  return (
    <div className="row" style={{ justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <span className="badge">outbreaks: {view.outbreaks}/8</span>
      <span className="badge">infection rate: {[2, 2, 2, 3, 3, 4, 4][view.infectionRateIndex]}</span>
      <span className="badge">deck: {view.playerDeckSize}</span>
      {(['blue', 'yellow', 'black', 'red'] as Disease[]).map((d) => (
        <span key={d} className="badge" style={{ color: DISEASE_HEX[d] }}>
          {d}: {view.eradicated[d] ? 'eradicated' : view.cured[d] ? 'CURED' : `${view.cubesLeft[d]} cubes`}
        </span>
      ))}
    </div>
  );
}

function TvView({ state }: TvViewProps<PandemicPublic>) {
  const view = state.view;
  if (!view) return null;
  const current = view.order[view.turnIndex]!;
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
              <span className="token" style={{ background: SEAT_COLORS[view.order.indexOf(s) % 4] }} />
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
            <p className="error">💀 The diseases won — {view.lossReason}</p>
          ) : (
            <WinnerBanner state={state} />
          )
        ) : discarding ? (
          <p className="error">Hand over 7 — tap a card below to discard</p>
        ) : myTurn ? (
          <>
            <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
              {me.role} · {NICE(me.city)} · {view.actionsLeft} action{view.actionsLeft === 1 ? '' : 's'} left
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              {(['DRIVE', 'DIRECT_FLIGHT', 'CHARTER_FLIGHT', 'SHUTTLE'] as const).map((mk) => (
                <button key={mk}
                  className={moveMode === mk ? '' : 'secondary'}
                  disabled={!legal.some((m) => m.kind === mk)}
                  onClick={() => setMoveMode(mk)}>
                  {mk === 'DRIVE' ? 'Drive' : mk === 'DIRECT_FLIGHT' ? 'Direct ✈' : mk === 'CHARTER_FLIGHT' ? 'Charter ✈' : 'Shuttle'}
                </button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              {kinds.has('BUILD') && <button onClick={() => submitMove('BUILD', {})}>Build station</button>}
              {legal.filter((m) => m.kind === 'TREAT').map((m) => (
                <button key={(m as { disease: string }).disease}
                  style={{ background: DISEASE_HEX[(m as { disease: Disease }).disease] }}
                  onClick={() => submitMove('TREAT', m)}>
                  Treat {(m as { disease: string }).disease}
                </button>
              ))}
              {legal.filter((m) => m.kind === 'CURE').map((m, i) => (
                <button key={i} onClick={() => submitMove('CURE', m)}>
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
          <p className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</p>
        )}
        {view.lastEvent && <p className="dim small">{view.lastEvent}</p>}
      </div>

      <div className="card">
        <Map view={view} highlights={myTurn && !discarding ? cityTargets : undefined} onCity={onCity} />
      </div>

      <div className="card">
        <h3>Your hand ({me.hand.length}/7)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {me.hand.map((card, i) => (
            <div key={i}
              onClick={discarding ? () => submitMove('DISCARD', { card: i }) : undefined}
              style={{
                padding: '0.5em 0.8em',
                borderRadius: 8,
                background: card.kind === 'epidemic' ? '#3c1b28' : '#232847',
                border: `2px solid ${card.kind === 'city' ? DISEASE_HEX[CITIES[card.city]!.color] : '#e94560'}`,
                cursor: discarding ? 'pointer' : 'default',
                fontWeight: 600,
              }}>
              {card.kind === 'city' ? NICE(card.city) : 'Epidemic'}
            </div>
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
