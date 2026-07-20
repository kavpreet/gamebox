import React, { useEffect, useRef, useState } from 'react';
import type { GameSummary } from '@gamebox/shared-types';
import type { SnlPublic } from '@gamebox/game-snakes-and-ladders';
import { SNAKES, LADDERS } from '@gamebox/game-snakes-and-ladders';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatDot, SeatToken, SeatTokens, WinnerBanner, Prompt, Waiting, Die, useBoardFit } from './common.js';

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

interface AnimState {
  seat: number;
  x: number;
  y: number;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Hops the just-moved token square by square, then — if it landed on a
 * snake or ladder — glides it smoothly to the slide's far end. Runs only
 * for the seat named in the newest `lastRoll`; every other token renders
 * at its authoritative resting square.
 */
function useTokenAnimation(lastRoll: SnlPublic['lastRoll']): AnimState | null {
  const [anim, setAnim] = useState<AnimState | null>(null);
  const rollKey = useRef<string | null>(null);

  useEffect(() => {
    if (!lastRoll) return;
    const key = `${lastRoll.seat}:${lastRoll.from}:${lastRoll.to}:${lastRoll.die}:${lastRoll.slide ?? 'x'}`;
    if (rollKey.current === key) return;
    rollKey.current = key;

    let cancelled = false;
    const seat = lastRoll.seat;
    const hopSquares: number[] = [];
    for (let sq = lastRoll.from + 1; sq <= lastRoll.to; sq++) hopSquares.push(sq);
    if (hopSquares.length === 0) hopSquares.push(lastRoll.to);
    let i = 0;

    const finish = () => {
      if (!cancelled) setTimeout(() => !cancelled && setAnim(null), 150);
    };

    const slide = (from: number, to: number) => {
      const a = squareXY(from);
      const b = squareXY(to);
      const duration = 550;
      const start = performance.now();
      const frame = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / duration);
        const e = easeInOutQuad(t);
        setAnim({ seat, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
        if (t < 1) requestAnimationFrame(frame);
        else finish();
      };
      requestAnimationFrame(frame);
    };

    const hop = () => {
      if (cancelled) return;
      const sq = hopSquares[i]!;
      const { x, y } = squareXY(sq);
      setAnim({ seat, x, y });
      i++;
      if (i < hopSquares.length) {
        setTimeout(hop, 130);
      } else if (lastRoll.slide !== null) {
        slide(lastRoll.to, lastRoll.slide);
      } else {
        finish();
      }
    };
    hop();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRoll?.seat, lastRoll?.from, lastRoll?.to, lastRoll?.die, lastRoll?.slide]);

  return anim;
}

function Board({ view, summary, size = '100%' }: { view: SnlPublic; summary: GameSummary; size?: string }) {
  const W = PAD * 2 + CELL * 10;
  const anim = useTokenAnimation(view.lastRoll);
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
          fill={((Math.floor((sq - 1) / 10) + (sq - 1)) % 2 === 0) ? '#1c2244' : '#252c58'}
          stroke="#333c68"
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
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const nx = (-dy / len) * 7, ny = (dx / len) * 7; // rail offset
    const rungs = Math.max(3, Math.floor(len / 34));
    links.push(
      <g key={`l${fromStr}`} opacity={0.85}>
        <line x1={a.x + nx} y1={a.y + ny} x2={b.x + nx} y2={b.y + ny} stroke="#c98f3d" strokeWidth={5} strokeLinecap="round" />
        <line x1={a.x - nx} y1={a.y - ny} x2={b.x - nx} y2={b.y - ny} stroke="#c98f3d" strokeWidth={5} strokeLinecap="round" />
        {Array.from({ length: rungs }, (_, i) => {
          const t = (i + 0.5) / rungs;
          const cx = a.x + dx * t, cy = a.y + dy * t;
          return <line key={i} x1={cx + nx} y1={cy + ny} x2={cx - nx} y2={cy - ny} stroke="#e8b86a" strokeWidth={4} strokeLinecap="round" />;
        })}
      </g>,
    );
  }
  for (const [fromStr, to] of Object.entries(SNAKES)) {
    const a = squareXY(Number(fromStr)); // head
    const b = squareXY(to); // tail
    const dx = b.x - a.x, dy = b.y - a.y;
    const nx = -dy * 0.18, ny = dx * 0.18;
    const p1x = a.x + dx * 0.33 + nx, p1y = a.y + dy * 0.33 + ny;
    const p2x = a.x + dx * 0.66 - nx, p2y = a.y + dy * 0.66 - ny;
    links.push(
      <g key={`s${fromStr}`} opacity={0.9}>
        <path
          d={`M ${a.x} ${a.y} C ${p1x} ${p1y} ${p2x} ${p2y} ${b.x} ${b.y}`}
          stroke="#3fa864" strokeWidth={9} fill="none" strokeLinecap="round"
        />
        <path
          d={`M ${a.x} ${a.y} C ${p1x} ${p1y} ${p2x} ${p2y} ${b.x} ${b.y}`}
          stroke="#7ed957" strokeWidth={3.5} fill="none" strokeLinecap="round" strokeDasharray="7 9"
        />
        <circle cx={a.x} cy={a.y} r={9} fill="#3fa864" stroke="#0b0e1d" strokeWidth={1.5} />
        <circle cx={a.x - 3} cy={a.y - 2.5} r={1.8} fill="#ffd98a" />
        <circle cx={a.x + 3} cy={a.y - 2.5} r={1.8} fill="#ffd98a" />
      </g>,
    );
  }

  // Tokens, fanned out when sharing a square — the animating seat (if any)
  // is drawn separately, on top, at its live hop/slide coordinates.
  const bySquare = new Map<number, number[]>();
  for (const [seatStr, pos] of Object.entries(view.positions)) {
    if (pos === 0 || Number(seatStr) === anim?.seat) continue;
    const arr = bySquare.get(pos) ?? [];
    arr.push(Number(seatStr));
    bySquare.set(pos, arr);
  }
  const tokens: React.ReactElement[] = [];
  for (const [sq, seats] of bySquare) {
    const { x, y } = squareXY(sq);
    seats.forEach((seat, i) => {
      const offset = (i - (seats.length - 1) / 2) * 16;
      tokens.push(<SeatToken key={`t${seat}`} summary={summary} seat={seat} cx={x + offset} cy={y + 8} r={11} />);
    });
  }
  if (anim) {
    tokens.push(<SeatToken key={`t${anim.seat}`} summary={summary} seat={anim.seat} cx={anim.x} cy={anim.y + 8} r={12} />);
  }

  // Start area tokens (position 0)
  const waiting = Object.entries(view.positions).filter(([, p]) => p === 0);
  const fit = useBoardFit();

  return (
    <svg viewBox={`0 0 ${W} ${W + (waiting.length ? 34 : 0)}`}
      preserveAspectRatio={fit}
      style={{ maxWidth: size, width: '100%', height: '100%', maxHeight: '100%' }}>
      {cells}
      {links}
      {tokens}
      {waiting.map(([seatStr], i) => (
        <SeatToken key={`w${seatStr}`} summary={summary} seat={Number(seatStr)} cx={PAD + 14 + i * 30} cy={W + 14} r={11} />
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
        <Board view={view} summary={state.summary} />
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

/** The board lives on the TV — the phone is just your dice + status. */
function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<SnlPublic, { kind: 'ROLL' }>) {
  const view = state.view;
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const myPos = view.positions[yourSeat] ?? 0;
  const standings = Object.entries(view.positions)
    .map(([s, p]) => ({ seat: Number(s), pos: p }))
    .sort((a, b) => b.pos - a.pos);
  return (
    <div className="page">
      <div className="card center">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <>
            <Prompt>Your turn!</Prompt>
            <button className="big" onClick={() => submitMove('ROLL', {})}>
              🎲 Roll the die
            </button>
          </>
        ) : (
          <Waiting state={state} />
        )}
        {view.lastRoll && (
          <>
            <div className="action-bar">
              <Die value={view.lastRoll.die} />
            </div>
            <p className="dim">
              {seatName(state.summary, view.lastRoll.seat)} rolled a {view.lastRoll.die}
              {view.lastRoll.slide !== null && (view.lastRoll.slide < view.lastRoll.to ? ' — down a snake 🐍' : ' — up a ladder 🪜')}
            </p>
          </>
        )}
        <div style={{ fontSize: '2.6rem', fontWeight: 900, color: 'var(--gold)' }}>{myPos}</div>
        <p className="dim small">your square (100 to win — watch the TV!)</p>
      </div>
      <div className="card">
        <h3>Race standings</h3>
        {standings.map(({ seat, pos }, i) => (
          <div key={seat} className="row between">
            <span className="row" style={{ gap: 6 }}>
              <span className="dim small">#{i + 1}</span>
              <SeatDot summary={state.summary} seat={seat} size={16} />
              {seatName(state.summary, seat)}{seat === yourSeat && ' (you)'}
            </span>
            <strong>{pos}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export const snakesAndLaddersUi: GameUi = {
  slug: 'snakes-and-ladders',
  PlayerView,
  TvView,
};
