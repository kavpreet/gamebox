import React, { useState } from 'react';
import type { CCPublic, CCMove } from '@gamebox/game-chinese-checkers';
import { allCells, destinations } from '@gamebox/game-chinese-checkers';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SEAT_HEX, SeatTokens, WinnerBanner, Prompt, Waiting } from './common.js';

const SEAT_COLORS = SEAT_HEX;
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
      <defs>
        <radialGradient id="cc-bg" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#22284a" />
          <stop offset="100%" stopColor="#121631" />
        </radialGradient>
      </defs>
      <circle cx={0} cy={0} r={EXTENT * 0.98} fill="url(#cc-bg)" stroke="#333c68" strokeWidth={3} />
      {CELLS.map((cell) => {
        const { px, py } = xy(cell);
        const owner = view.pegs[cell];
        const isSel = selected === cell;
        const isTarget = targets?.has(cell);
        const wasLast = view.lastMove && (view.lastMove.from === cell || view.lastMove.to === cell);
        return (
          <g key={cell} onClick={onCell ? () => onCell(cell) : undefined} style={onCell ? { cursor: 'pointer' } : undefined}>
            {/* hole */}
            <circle cx={px} cy={py + 1.5} r={R} fill="rgba(0,0,0,0.5)" />
            <circle cx={px} cy={py} r={R}
              fill={owner !== undefined ? SEAT_COLORS[owner % 6] : '#0d1024'}
              stroke={isSel ? '#ffffff' : isTarget ? '#2ee6c9' : wasLast ? '#ffb930' : '#333c68'}
              strokeWidth={isSel || isTarget ? 3.5 : 1.5}
            />
            {owner !== undefined && <circle cx={px - R * 0.3} cy={py - R * 0.3} r={R * 0.28} fill="rgba(255,255,255,0.4)" />}
            {isTarget && owner === undefined && (
              <circle cx={px} cy={py} r={R * 0.35} fill="rgba(46,230,201,0.8)">
                <animate attributeName="r" values={`${R * 0.28};${R * 0.42};${R * 0.28}`} dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}
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
          <Prompt>{selected ? 'Tap a highlighted hole' : 'Your turn — tap one of your pegs'}</Prompt>
        ) : (
          <Waiting state={state} />
        )}
      </div>
      <div className="board-frame">
        <Board view={view} yourSeat={yourSeat} selected={selected} targets={targets} onCell={onCell} />
      </div>
    </div>
  );
}

export const chineseCheckersUi: GameUi = { slug: 'chinese-checkers', PlayerView, TvView };
