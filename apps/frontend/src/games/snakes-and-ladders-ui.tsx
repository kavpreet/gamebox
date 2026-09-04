import React, { useMemo } from 'react';
import type { SnlPublic, SnlMove } from '@gamebox/game-snakes-and-ladders';
import { SNAKES, LADDERS } from '@gamebox/game-snakes-and-ladders';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatTokens, WinnerBanner } from './common.js';
import { useTable } from './table.js';
import { activeBeat } from './beats.js';
import { BoardStage, ClockRing, DiceStage, countPath, povSpin, useWalk } from './anim.js';

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

/**
 * Square 0 is "off the board". Give it a coordinate just below the grid so a
 * counter entering play slides on from the edge instead of materialising.
 */
function tokenXY(square: number, laneIndex: number): { x: number; y: number } {
  if (square <= 0) return { x: PAD + 22 + laneIndex * 30, y: PAD + CELL * 10 + 22 };
  return squareXY(square);
}

function Board({
  view,
  shown,
  walking,
  highlightSquare,
  onSquareTap,
}: {
  view: SnlPublic;
  shown: Record<number, number>;
  walking: number | null;
  /** Square the current player may tap to step onto (manual mode). */
  highlightSquare?: number | null;
  onSquareTap?: (square: number) => void;
}) {
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

  // Counters are drawn at their *shown* square, which trails the authoritative
  // one while a walk plays out — that lag is the whole point.
  const bySquare = new Map<number, number[]>();
  for (const [seatStr, pos] of Object.entries(shown)) {
    const arr = bySquare.get(pos) ?? [];
    arr.push(Number(seatStr));
    bySquare.set(pos, arr);
  }

  const tokens: React.ReactElement[] = [];
  for (const [sq, seats] of bySquare) {
    seats.forEach((seat, i) => {
      const { x, y } = tokenXY(sq, i);
      const offset = sq > 0 ? (i - (seats.length - 1) / 2) * 16 : 0;
      const isWalking = walking === seat;
      tokens.push(
        <g key={`t${seat}`}>
          <ellipse
            className="token-shadow"
            cx={x + offset + 2}
            cy={y + 15}
            rx={10}
            ry={3.5}
            fill="#05060f"
          />
          <circle
            className={`walk-token ${isWalking ? 'hopping' : ''}`}
            cx={x + offset}
            cy={y + (isWalking ? 2 : 8)}
            r={11}
            fill={SEAT_COLORS[seat % SEAT_COLORS.length]}
            stroke="#0f1220"
            strokeWidth={2.5}
          />
        </g>,
      );
    });
  }

  const hl = highlightSquare && highlightSquare >= 1 && highlightSquare <= 100 ? squareXY(highlightSquare) : null;

  return (
    <svg viewBox={`0 0 ${W} ${W + 40}`} style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      {cells}
      {links}
      {hl && (
        <rect
          className="manual-target"
          x={hl.x - CELL / 2}
          y={hl.y - CELL / 2}
          width={CELL}
          height={CELL}
          fill="#9ad14b"
          stroke="#d6ffa8"
          strokeWidth={3}
          onClick={() => onSquareTap?.(highlightSquare!)}
        />
      )}
      {tokens}
    </svg>
  );
}

/** Shared board + walk animation, so TV and phone stay in step. */
function useSnlBoard(view: SnlPublic) {
  const { options, beats } = useTable();
  const targets = useMemo(() => {
    const out: Record<number, number> = {};
    for (const [seatStr, pos] of Object.entries(view.positions)) out[Number(seatStr)] = pos;
    return out;
  }, [view.positions]);

  const walk = useWalk(targets, countPath, {
    stepMs: 200,
    enabled: options.animate,
    sound: options.sound,
  });

  const dice = activeBeat(beats, 'dice');
  const rollingDice = (dice?.data?.dice as number[] | undefined) ?? null;
  return { walk, rollingDice, options };
}

function TvView({ state }: TvViewProps<SnlPublic>) {
  const view = state.view;
  const { povSeat, clock } = useTable();
  const board = useSnlBoard(view ?? ({ positions: {} } as SnlPublic));
  if (!view) return null;

  // The board leans back a little more while the dice are in the air, which
  // reads as the camera lifting to take in the whole table.
  const rolling = board.rollingDice !== null;
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ position: 'relative' }}>
        <BoardStage
          enabled={board.options.perspective}
          tilt={rolling ? 34 : 48}
          spin={povSpin(povSeat, 2)}
          zoom={rolling ? 0.9 : 1}
        >
          <Board view={view} shown={board.walk.shown} walking={board.walk.walking} />
        </BoardStage>
        {board.rollingDice && <DiceStage dice={board.rollingDice} />}
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        {clock && (
          <div className="tv-player-chip">
            <ClockRing reading={clock} />
            <span className="grow">
              {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')} to play
            </span>
          </div>
        )}
        {view.manual && view.phase !== 'ROLL' && (
          <div className="tv-player-chip">
            {view.phase === 'WALK'
              ? `walking ${(view.pending?.to ?? 0) - (view.positions[state.activeSeats[0] ?? 0] ?? 0)} more…`
              : 'take the snake / ladder'}
          </div>
        )}
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

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<SnlPublic, SnlMove>) {
  const view = state.view;
  const { clock, options } = useTable();
  const board = useSnlBoard(view ?? ({ positions: {} } as SnlPublic));
  if (!view) return null;

  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const here = view.positions[yourSeat] ?? 0;
  const stepsLeft = view.pending ? view.pending.to - here : 0;
  // In manual mode the next square is the only legal target, so the board can
  // highlight it and accept the tap directly.
  const nextSquare = myTurn && view.phase === 'WALK' ? here + 1 : null;
  const slideSquare = myTurn && view.phase === 'SLIDE' ? view.pending?.slide ?? null : null;

  return (
    <div className="page">
      <div className="card center">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <>
            <div className="manual-bar">
              {clock && <ClockRing reading={clock} />}
              <h2 style={{ margin: 0 }}>Your turn</h2>
            </div>
            {view.phase === 'ROLL' && (
              <button className="big" onClick={() => submitMove('ROLL', {})}>
                🎲 Throw the die
              </button>
            )}
            {view.phase === 'WALK' && (
              <>
                <button className="big" onClick={() => submitMove('STEP', {})}>
                  👣 Step to {here + 1}
                </button>
                <p className="manual-hint">
                  {stepsLeft} {stepsLeft === 1 ? 'square' : 'squares'} left of your {view.pending?.die}
                </p>
              </>
            )}
            {view.phase === 'SLIDE' && (
              <>
                <button className="big" onClick={() => submitMove('TAKE_SLIDE', {})}>
                  {(view.pending?.slide ?? 0) < (view.pending?.to ?? 0)
                    ? `🐍 Slide down to ${view.pending?.slide}`
                    : `🪜 Climb up to ${view.pending?.slide}`}
                </button>
                <p className="manual-hint">You landed on {view.pending?.to}.</p>
              </>
            )}
          </>
        ) : (
          <h3 className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</h3>
        )}
        <p>
          You are on square <strong>{here}</strong>
        </p>
      </div>
      <div className="card" style={{ position: 'relative' }}>
        <BoardStage
          enabled={options.perspective}
          tilt={38}
          spin={0}
          zoom={1}
        >
          <Board
            view={view}
            shown={board.walk.shown}
            walking={board.walk.walking}
            highlightSquare={nextSquare ?? slideSquare}
            onSquareTap={() => submitMove(view.phase === 'WALK' ? 'STEP' : 'TAKE_SLIDE', {})}
          />
        </BoardStage>
        {board.rollingDice && <DiceStage dice={board.rollingDice} />}
      </div>
    </div>
  );
}

export const snakesAndLaddersUi: GameUi = {
  slug: 'snakes-and-ladders',
  PlayerView,
  TvView,
};
