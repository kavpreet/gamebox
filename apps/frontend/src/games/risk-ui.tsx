import React, { useState } from 'react';
import type { RiskPublic, RiskMove } from '@gamebox/game-risk';
import { ADJACENCY } from '@gamebox/game-risk';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatTokens, WinnerBanner } from './common.js';

const SEAT_COLORS = ['#e94560', '#2ec4b6', '#f5a623', '#7c5cff', '#3fa7ff', '#9ad14b'];

/** Abstract world layout: territory → (x, y) in a 100×72 space. */
const POS: Record<string, [number, number]> = {
  alaska: [5, 12], 'northwest-territory': [14, 10], greenland: [28, 6],
  alberta: [12, 18], ontario: [19, 18], quebec: [26, 17],
  'western-us': [11, 26], 'eastern-us': [19, 27], 'central-america': [13, 35],
  venezuela: [18, 44], brazil: [25, 52], peru: [18, 55], argentina: [21, 65],
  iceland: [38, 12], 'great-britain': [37, 20], scandinavia: [46, 10],
  ukraine: [54, 15], 'northern-europe': [45, 22], 'southern-europe': [47, 28],
  'western-europe': [39, 29],
  'north-africa': [42, 43], egypt: [50, 39], 'east-africa': [54, 49],
  congo: [47, 55], 'south-africa': [50, 65], madagascar: [58, 63],
  ural: [62, 13], siberia: [68, 8], yakutsk: [76, 6], kamchatka: [86, 7],
  irkutsk: [72, 14], mongolia: [74, 21], japan: [87, 21],
  afghanistan: [60, 23], china: [70, 28], 'middle-east': [55, 33],
  india: [64, 35], siam: [71, 38],
  indonesia: [73, 48], 'new-guinea': [83, 46], 'western-australia': [76, 60],
  'eastern-australia': [85, 58],
};

const NICE: Record<string, string> = {};
for (const t of Object.keys(POS)) {
  NICE[t] = t.split('-').map((w) => (w === 'us' ? 'US' : w[0]!.toUpperCase() + w.slice(1))).join(' ');
}

function Map({
  view,
  selected,
  highlights,
  onTerritory,
}: {
  view: RiskPublic;
  selected?: string | null;
  highlights?: Set<string>;
  onTerritory?: (t: string) => void;
}) {
  const SCALE = 10;
  const edges: React.ReactElement[] = [];
  const done = new Set<string>();
  for (const [t, neighbors] of Object.entries(ADJACENCY)) {
    for (const n of neighbors) {
      const key = [t, n].sort().join('|');
      if (done.has(key)) continue;
      done.add(key);
      const [x1, y1] = POS[t]!;
      const [x2, y2] = POS[n]!;
      const wrap = t === 'alaska' && n === 'kamchatka' || n === 'alaska' && t === 'kamchatka';
      if (wrap) {
        edges.push(
          <g key={key}>
            <line x1={POS['alaska']![0] * SCALE} y1={POS['alaska']![1] * SCALE} x2={0} y2={POS['alaska']![1] * SCALE} stroke="#2c3255" strokeWidth={3} strokeDasharray="8 6" />
            <line x1={POS['kamchatka']![0] * SCALE} y1={POS['kamchatka']![1] * SCALE} x2={1000} y2={POS['kamchatka']![1] * SCALE} stroke="#2c3255" strokeWidth={3} strokeDasharray="8 6" />
          </g>,
        );
      } else {
        edges.push(
          <line key={key} x1={x1 * SCALE} y1={y1 * SCALE} x2={x2 * SCALE} y2={y2 * SCALE} stroke="#2c3255" strokeWidth={3} />,
        );
      }
    }
  }

  return (
    <svg viewBox="0 0 1000 720" style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      {edges}
      {Object.entries(POS).map(([t, [x, y]]) => {
        const terr = view.territories[t]!;
        const isSel = selected === t;
        const isHi = highlights?.has(t);
        return (
          <g key={t} onClick={onTerritory ? () => onTerritory(t) : undefined}
            style={onTerritory ? { cursor: 'pointer' } : undefined}>
            <circle cx={x * SCALE} cy={y * SCALE} r={22}
              fill={SEAT_COLORS[terr.owner % 6]}
              stroke={isSel ? '#ffffff' : isHi ? '#2ec4b6' : '#0f1220'}
              strokeWidth={isSel || isHi ? 5 : 2}
              opacity={view.eliminated.includes(terr.owner) ? 0.35 : 1}
            />
            <text x={x * SCALE} y={y * SCALE + 7} textAnchor="middle" fontSize={20} fontWeight={800} fill="#0f1220">
              {terr.armies}
            </text>
            <text x={x * SCALE} y={y * SCALE + 42} textAnchor="middle" fontSize={13} fill="#9aa0c3">
              {NICE[t]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function TvView({ state }: TvViewProps<RiskPublic>) {
  const view = state.view;
  if (!view) return null;
  const current = view.order[view.turnIndex]!;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Map view={view} />
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        <div className="tv-player-chip">
          {seatName(state.summary, current)}: {view.phase.toLowerCase()}
          {view.phase === 'REINFORCE' && ` (${view.reinforcementsLeft} left)`}
        </div>
        {view.lastBattle && (
          <div className="tv-player-chip dim small">
            ⚔ {NICE[view.lastBattle.from]} → {NICE[view.lastBattle.to]}:
            [{view.lastBattle.attackerDice.join(',')}] vs [{view.lastBattle.defenderDice.join(',')}]
            {view.lastBattle.conquered ? ' — conquered!' : ''}
          </div>
        )}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<RiskPublic, RiskMove>) {
  const view = state.view;
  const [selected, setSelected] = useState<string | null>(null);
  const [dice, setDice] = useState(3);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const phase = view.phase;
  const pc = view.pendingConquest;

  const myTerritories = new Set(
    Object.entries(view.territories).filter(([, t]) => t.owner === yourSeat).map(([n]) => n),
  );

  let highlights = new Set<string>();
  if (myTurn && selected && !pc) {
    if (phase === 'ATTACK') {
      highlights = new Set([...(ADJACENCY[selected] ?? [])].filter((n) => !myTerritories.has(n)));
    } else if (phase === 'FORTIFY') {
      highlights = new Set([...(ADJACENCY[selected] ?? [])].filter((n) => myTerritories.has(n)));
    }
  }

  const onTerritory = (t: string) => {
    if (!myTurn || pc) return;
    if (phase === 'REINFORCE') {
      if (myTerritories.has(t)) submitMove('PLACE', { territory: t, count: 1 });
      return;
    }
    if (selected && highlights.has(t)) {
      if (phase === 'ATTACK') {
        const maxDice = Math.min(3, (view.territories[selected]!.armies - 1));
        submitMove('ATTACK', { from: selected, to: t, dice: Math.min(dice, maxDice) });
      } else if (phase === 'FORTIFY') {
        const count = view.territories[selected]!.armies - 1;
        submitMove('FORTIFY', { from: selected, to: t, count });
        setSelected(null);
      }
      return;
    }
    if (myTerritories.has(t) && view.territories[t]!.armies >= 2) {
      setSelected(t === selected ? null : t);
    } else {
      setSelected(null);
    }
  };

  return (
    <div className="page wide">
      <div className="card center">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : !myTurn ? (
          <p className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</p>
        ) : pc ? (
          <>
            <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
              Conquered {NICE[pc.to]}! Move in how many armies? (min {pc.minMove})
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              {Array.from(
                { length: Math.max(0, view.territories[pc.from]!.armies - pc.minMove) + 0 },
                (_, i) => pc.minMove + i,
              )
                .filter((c) => c <= view.territories[pc.from]!.armies - 1)
                .slice(0, 8)
                .map((c) => (
                  <button key={c} onClick={() => submitMove('MOVE_IN', { count: c })}>{c}</button>
                ))}
              {view.territories[pc.from]!.armies - 1 >= pc.minMove && (
                <button className="secondary" onClick={() => submitMove('MOVE_IN', { count: view.territories[pc.from]!.armies - 1 })}>
                  All ({view.territories[pc.from]!.armies - 1})
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
              {phase === 'REINFORCE' && `Place armies — tap your territories (${view.reinforcementsLeft} left)`}
              {phase === 'ATTACK' && (selected ? `Attacking from ${NICE[selected]} — tap a highlighted enemy` : 'Attack — tap one of your territories (2+ armies)')}
              {phase === 'FORTIFY' && (selected ? `Fortifying from ${NICE[selected]} — tap a highlighted friendly` : 'Fortify (optional) — tap a territory, or end your turn')}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              {phase === 'ATTACK' && selected && (
                <div className="row">
                  <span className="dim small">dice:</span>
                  {[1, 2, 3].map((d) => (
                    <button key={d} className={dice === d ? '' : 'secondary'} onClick={() => setDice(d)}>{d}</button>
                  ))}
                </div>
              )}
              {phase === 'ATTACK' && (
                <button className="secondary" onClick={() => { setSelected(null); submitMove('END_ATTACK', {}); }}>
                  End attacks
                </button>
              )}
              {(phase === 'ATTACK' || phase === 'FORTIFY') && (
                <button className="secondary" onClick={() => { setSelected(null); submitMove('END_TURN', {}); }}>
                  End turn
                </button>
              )}
            </div>
          </>
        )}
        {view.lastBattle && (
          <p className="dim small">
            ⚔ [{view.lastBattle.attackerDice.join(',')}] vs [{view.lastBattle.defenderDice.join(',')}]
            {view.lastBattle.conquered ? ' — conquered!' : ` — lost ${view.lastBattle.attackerLosses}, killed ${view.lastBattle.defenderLosses}`}
          </p>
        )}
      </div>
      <div className="card">
        <Map view={view} selected={selected} highlights={highlights} onTerritory={onTerritory} />
      </div>
    </div>
  );
}

export const riskUi: GameUi = { slug: 'risk', PlayerView, TvView };
