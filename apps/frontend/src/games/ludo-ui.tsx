import React from 'react';
import type { LudoPublic, LudoMove } from '@gamebox/game-ludo';
import { HOME, SAFE_GLOBALS, globalSquare } from '@gamebox/game-ludo';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatTokens, WinnerBanner } from './common.js';

const C = 40; // cell size
const SEAT_COLORS = ['#e94560', '#2ec4b6', '#f5a623', '#7c5cff'];

/** The 52 main-track cells of the classic 15×15 board, in travel order. */
const TRACK: [number, number][] = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
];

/** Home-column cells per entry index (order position), progress 51–55. */
const HOME_COLUMNS: [number, number][][] = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],   // entry 0 (left arm)
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],   // entry 13 (top arm)
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], // entry 26 (right arm)
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], // entry 39 (bottom arm)
];

/** Yard token spots per order position (TL, TR, BR, BL corners). */
const YARDS: [number, number][][] = [
  [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],
  [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
  [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
  [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
];
const YARD_BOXES: [number, number][] = [[0, 0], [9, 0], [9, 9], [0, 9]];

function center(cell: [number, number]): { x: number; y: number } {
  return { x: cell[0] * C + C / 2, y: cell[1] * C + C / 2 };
}

interface TokenSpot {
  seat: number;
  token: number;
  x: number;
  y: number;
}

function tokenSpots(view: LudoPublic): TokenSpot[] {
  const spots: TokenSpot[] = [];
  for (const seat of view.order) {
    const orderPos = Math.round((view.entries[seat] ?? 0) / 13) % 4;
    (view.tokens[seat] ?? []).forEach((progress, token) => {
      if (progress === -1) {
        const [gx, gy] = YARDS[orderPos]![token]!;
        spots.push({ seat, token, x: gx * C + C / 2, y: gy * C + C / 2 });
      } else if (progress === HOME) {
        // stack finished tokens near the center triangle for this player
        const homeEntry = HOME_COLUMNS[orderPos]![4]!;
        const cx = (homeEntry[0]! * 0.4 + 7 * 0.6) * C + C / 2;
        const cy = (homeEntry[1]! * 0.4 + 7 * 0.6) * C + C / 2;
        spots.push({ seat, token, x: cx + token * 5 - 8, y: cy });
      } else if (progress > 50) {
        const cell = HOME_COLUMNS[orderPos]![progress - 51]!;
        const { x, y } = center(cell);
        spots.push({ seat, token, x, y });
      } else {
        const g = globalSquare(view, seat, progress)!;
        const { x, y } = center(TRACK[g]!);
        spots.push({ seat, token, x, y });
      }
    });
  }
  // fan out shared cells
  const byXY = new Map<string, TokenSpot[]>();
  for (const s of spots) {
    const k = `${Math.round(s.x)},${Math.round(s.y)}`;
    (byXY.get(k) ?? byXY.set(k, []).get(k)!).push(s);
  }
  for (const group of byXY.values()) {
    if (group.length > 1) {
      group.forEach((s, i) => {
        s.x += (i - (group.length - 1) / 2) * 10;
      });
    }
  }
  return spots;
}

function Board({
  view,
  yourSeat,
  movable,
  onMoveToken,
}: {
  view: LudoPublic;
  yourSeat?: number;
  movable?: number[];
  onMoveToken?: (token: number) => void;
}) {
  const W = 15 * C;
  const orderPosOf = (seat: number) => Math.round((view.entries[seat] ?? 0) / 13) % 4;

  return (
    <svg viewBox={`0 0 ${W} ${W}`} style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      <rect width={W} height={W} fill="#141830" rx={12} />
      {/* yards */}
      {YARD_BOXES.map(([bx, by], i) => {
        const seat = view.order.find((s) => orderPosOf(s) === i);
        return (
          <g key={i}>
            <rect x={bx * C + 4} y={by * C + 4} width={6 * C - 8} height={6 * C - 8} rx={10}
              fill={seat !== undefined ? SEAT_COLORS[seat % 4] : '#1b2038'} opacity={seat !== undefined ? 0.25 : 1} />
            {seat !== undefined && YARDS[i]!.map(([gx, gy], j) => (
              <circle key={j} cx={gx * C + C / 2} cy={gy * C + C / 2} r={C * 0.42} fill="#0f1220" />
            ))}
          </g>
        );
      })}
      {/* main track */}
      {TRACK.map(([cx, cy], i) => {
        const entrySeat = view.order.find((s) => (view.entries[s] ?? -1) === i);
        return (
          <rect
            key={i}
            x={cx * C + 1}
            y={cy * C + 1}
            width={C - 2}
            height={C - 2}
            rx={5}
            fill={entrySeat !== undefined ? SEAT_COLORS[entrySeat % 4] : SAFE_GLOBALS.has(i) ? '#2c3255' : '#1e2340'}
            opacity={entrySeat !== undefined ? 0.6 : 1}
            stroke="#2c3255"
          />
        );
      })}
      {/* safe stars */}
      {[...SAFE_GLOBALS].map((g) => {
        const { x, y } = center(TRACK[g]!);
        return (
          <text key={g} x={x} y={y + 5} textAnchor="middle" fontSize={16} fill="#69709c">★</text>
        );
      })}
      {/* home columns */}
      {HOME_COLUMNS.map((cells, i) => {
        const seat = view.order.find((s) => orderPosOf(s) === i);
        return cells.map(([cx, cy], j) => (
          <rect key={`${i}-${j}`} x={cx * C + 1} y={cy * C + 1} width={C - 2} height={C - 2} rx={5}
            fill={seat !== undefined ? SEAT_COLORS[seat % 4] : '#1b2038'} opacity={seat !== undefined ? 0.35 : 1} />
        ));
      })}
      {/* center */}
      <rect x={6 * C} y={6 * C} width={3 * C} height={3 * C} fill="#232847" rx={8} />
      <text x={7.5 * C} y={7.5 * C + 6} textAnchor="middle" fontSize={20} fill="#69709c">🏠</text>
      {/* tokens */}
      {tokenSpots(view).map((s) => {
        const clickable = yourSeat === s.seat && movable?.includes(s.token) && onMoveToken;
        return (
          <circle
            key={`${s.seat}-${s.token}`}
            cx={s.x}
            cy={s.y}
            r={C * 0.36}
            fill={SEAT_COLORS[s.seat % 4]}
            stroke={clickable ? '#ffffff' : '#0f1220'}
            strokeWidth={clickable ? 3.5 : 2}
            style={clickable ? { cursor: 'pointer' } : undefined}
            onClick={clickable ? () => onMoveToken(s.token) : undefined}
          >
            {clickable && <animate attributeName="r" values={`${C * 0.34};${C * 0.42};${C * 0.34}`} dur="0.9s" repeatCount="indefinite" />}
          </circle>
        );
      })}
    </svg>
  );
}

function TvView({ state }: TvViewProps<LudoPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} />
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        {view.die !== null && (
          <div className="tv-player-chip">🎲 {view.die}</div>
        )}
        {view.lastEvent && <div className="tv-player-chip dim">{view.lastEvent}</div>}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<LudoPublic, LudoMove>) {
  const view = state.view;
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const legal = (state.legalMoves ?? []) as LudoMove[];
  const canRoll = myTurn && legal.some((m) => m.kind === 'ROLL');
  const movable = legal.filter((m) => m.kind === 'MOVE').map((m) => (m as { token: number }).token);

  return (
    <div className="page">
      <div className="card center">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          canRoll ? (
            <button className="big" onClick={() => submitMove('ROLL', {})}>
              🎲 Roll the die
            </button>
          ) : (
            <>
              <h3>You rolled a {view.die}</h3>
              <p className="dim">Tap a glowing token to move it</p>
            </>
          )
        ) : (
          <h3 className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</h3>
        )}
        {view.lastEvent && <p className="dim small">{view.lastEvent}</p>}
      </div>
      <div className="card">
        <Board
          view={view}
          yourSeat={yourSeat}
          movable={movable}
          onMoveToken={(token) => submitMove('MOVE', { token })}
        />
      </div>
    </div>
  );
}

export const ludoUi: GameUi = {
  slug: 'ludo',
  PlayerView,
  TvView,
};
