import React, { useState } from 'react';
import type { CCPublic, CCMove } from '@gamebox/game-chinese-checkers';
import { allCells, destinations } from '@gamebox/game-chinese-checkers';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatTokens, WinnerBanner } from './common.js';

const SEAT_COLORS = ['#e94560', '#2ec4b6', '#f5a623', '#7c5cff', '#3fa7ff', '#9ad14b'];
const R = 16; // hole radius in svg units
const SP = 38; // spacing

/** axial (x, z) → pixel */
function xy(cell: string): { px: number; py: number } {
  const [x, z] = cell.split(',').map(Number) as [number, number];
  return {
    px: SP * (x + z / 2),
    py: SP * z * 0.866,
  };
}

const CELLS = allCells();
const EXTENT = 8.7 * SP;

function Board({
  view,
  yourSeat,
  selected,
  targets,
  onCell,
}: {
  view: CCPublic;
  yourSeat?: number;
  selected?: string | null;
  targets?: Set<string>;
  onCell?: (cell: string) => void;
}) {
  return (
    <svg
      viewBox={`${-EXTENT} ${-EXTENT} ${2 * EXTENT} ${2 * EXTENT}`}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}
    >
      {CELLS.map((cell) => {
        const { px, py } = xy(cell);
        const owner = view.pegs[cell];
        const isSel = selected === cell;
        const isTarget = targets?.has(cell);
        const wasLast = view.lastMove && (view.lastMove.from === cell || view.lastMove.to === cell);
        return (
          <g key={cell} onClick={onCell ? () => onCell(cell) : undefined} style={onCell ? { cursor: 'pointer' } : undefined}>
            <circle cx={px} cy={py} r={R}
              fill={owner !== undefined ? SEAT_COLORS[owner % 6] : '#1b2038'}
              stroke={isSel ? '#ffffff' : isTarget ? '#2ec4b6' : wasLast ? '#f5a623' : '#2c3255'}
              strokeWidth={isSel || isTarget ? 3.5 : 1.5}
            />
            {isTarget && owner === undefined && <circle cx={px} cy={py} r={R * 0.35} fill="rgba(46,196,182,0.7)" />}
          </g>
        );
      })}
    </svg>
  );
}

function TvView({ state }: TvViewProps<CCPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} />
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        {view.lastMove && (
          <div className="tv-player-chip dim">
            {seatName(state.summary, view.lastMove.seat)} moved
          </div>
        )}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<CCPublic, CCMove>) {
  const view = state.view;
  const [selected, setSelected] = useState<string | null>(null);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const targets = selected && myTurn ? new Set(destinations(view.pegs, selected)) : new Set<string>();

  const onCell = (cell: string) => {
    if (!myTurn) return;
    if (selected && targets.has(cell)) {
      submitMove('MOVE', { from: selected, to: cell });
      setSelected(null);
    } else if (view.pegs[cell] === yourSeat) {
      setSelected(cell === selected ? null : cell);
    } else {
      setSelected(null);
    }
  };

  return (
    <div className="page">
      <div className="card center">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {selected ? 'Tap a highlighted hole' : 'Your turn — tap one of your pegs'}
          </p>
        ) : (
          <p className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</p>
        )}
      </div>
      <div className="card">
        <Board view={view} yourSeat={yourSeat} selected={selected} targets={targets} onCell={onCell} />
      </div>
    </div>
  );
}

export const chineseCheckersUi: GameUi = { slug: 'chinese-checkers', PlayerView, TvView };
