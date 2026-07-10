import React from 'react';
import type { SnlPublic } from '@gamebox/game-snakes-and-ladders';
import { SNAKES, LADDERS } from '@gamebox/game-snakes-and-ladders';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatTokens, WinnerBanner } from './common.js';

const CELL = 60;
const PAD = 8;

/** Square 1..100 → svg center coords (serpentine, 1 at bottom-left). */
function squareXY(square: number): { x: number; y: number } {
  const idx = square - 1;
  const row = Math.floor(idx / 10); // 0 = bottom row
  const col = row % 2 === 0 ? idx % 10 : 9 - (idx % 10);
  return {
    x: PAD + col * CELL + CELL / 2,
    y: PAD + (9 - row) * CELL + CELL / 2,
  };
}

const SEAT_COLORS = ['#e94560', '#2ec4b6', '#f5a623', '#7c5cff', '#3fa7ff', '#9ad14b'];

function Board({ view, size = '100%' }: { view: SnlPublic; size?: string }) {
  const W = PAD * 2 + CELL * 10;
  const cells = [];
  for (let sq = 1; sq <= 100; sq++) {
    const { x, y } = squareXY(sq);
    const isSnakeHead = SNAKES[sq] !== undefined;
    const isLadderFoot = LADDERS[sq] !== undefined;
    cells.push(
      <g key={sq}>
        <rect
          x={x - CELL / 2}
          y={y - CELL / 2}
          width={CELL}
          height={CELL}
          fill={((Math.floor((sq - 1) / 10) + (sq - 1)) % 2 === 0) ? '#1b2038' : '#232847'}
          stroke="#2c3255"
          strokeWidth={1}
        />
        <text x={x - CELL / 2 + 5} y={y - CELL / 2 + 15} fontSize={12} fill={isSnakeHead ? '#ff8098' : isLadderFoot ? '#69e0b0' : '#69709c'}>
          {sq}
        </text>
      </g>,
    );
  }

  const links = [];
  for (const [fromStr, to] of Object.entries(LADDERS)) {
    const a = squareXY(Number(fromStr));
    const b = squareXY(to);
    links.push(
      <line key={`l${fromStr}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2ec46f" strokeWidth={6} strokeLinecap="round" opacity={0.65} />,
    );
  }
  for (const [fromStr, to] of Object.entries(SNAKES)) {
    const a = squareXY(Number(fromStr));
    const b = squareXY(to);
    const midX = (a.x + b.x) / 2 + 25;
    const midY = (a.y + b.y) / 2;
    links.push(
      <path
        key={`s${fromStr}`}
        d={`M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`}
        stroke="#e94560"
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
        opacity={0.65}
        strokeDasharray="1 10"
      />,
    );
  }

  // Tokens, fanned out when sharing a square
  const bySquare = new Map<number, number[]>();
  for (const [seatStr, pos] of Object.entries(view.positions)) {
    if (pos === 0) continue;
    const arr = bySquare.get(pos) ?? [];
    arr.push(Number(seatStr));
    bySquare.set(pos, arr);
  }
  const tokens: React.ReactElement[] = [];
  for (const [sq, seats] of bySquare) {
    const { x, y } = squareXY(sq);
    seats.forEach((seat, i) => {
      const offset = (i - (seats.length - 1) / 2) * 16;
      tokens.push(
        <circle
          key={`t${seat}`}
          cx={x + offset}
          cy={y + 8}
          r={11}
          fill={SEAT_COLORS[seat % SEAT_COLORS.length]}
          stroke="#0f1220"
          strokeWidth={2.5}
        />,
      );
    });
  }

  // Start area tokens (position 0)
  const waiting = Object.entries(view.positions).filter(([, p]) => p === 0);

  return (
    <svg viewBox={`0 0 ${W} ${W + (waiting.length ? 34 : 0)}`} style={{ maxWidth: size, maxHeight: '100%', width: '100%' }}>
      {cells}
      {links}
      {tokens}
      {waiting.map(([seatStr], i) => (
        <circle
          key={`w${seatStr}`}
          cx={PAD + 14 + i * 30}
          cy={W + 14}
          r={11}
          fill={SEAT_COLORS[Number(seatStr) % SEAT_COLORS.length]}
          stroke="#0f1220"
          strokeWidth={2.5}
        />
      ))}
    </svg>
  );
}

function TvView({ state }: TvViewProps<SnlPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} />
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        {view.lastRoll && (
          <div className="tv-player-chip">
            🎲 {seatName(state.summary, view.lastRoll.seat)} rolled a {view.lastRoll.die}
            {view.lastRoll.slide !== null && (view.lastRoll.slide < view.lastRoll.to ? ' — snake!' : ' — ladder!')}
          </div>
        )}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<SnlPublic, { kind: 'ROLL' }>) {
  const view = state.view;
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  return (
    <div className="page">
      <div className="card center">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <>
            <h2>Your turn!</h2>
            <button className="big" onClick={() => submitMove('ROLL', {})}>
              🎲 Roll the die
            </button>
          </>
        ) : (
          <h3 className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</h3>
        )}
        {view.lastRoll && (
          <p className="dim">
            {seatName(state.summary, view.lastRoll.seat)} rolled a {view.lastRoll.die}
            {view.lastRoll.slide !== null && (view.lastRoll.slide < view.lastRoll.to ? ' 🐍' : ' 🪜')}
          </p>
        )}
        <p>
          You are on square <strong>{view.positions[yourSeat] ?? 0}</strong>
        </p>
      </div>
      <div className="card">
        <Board view={view} />
      </div>
    </div>
  );
}

export const snakesAndLaddersUi: GameUi = {
  slug: 'snakes-and-ladders',
  PlayerView,
  TvView,
};
