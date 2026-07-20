import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GameSummary, Seat } from '@gamebox/shared-types';
import type { LiveState } from './types.js';

/**
 * Player appearance: each player can pick a color and/or an emoji icon
 * (GamePage lobby UI). seatColor()/seatIcon() below fall back to the
 * default seat palette when a player hasn't customized — every board's
 * "token" rendering should go through these instead of raw SEAT_HEX
 * indexing, so a chosen look shows up everywhere the seat does.
 */
export function seatColor(summary: GameSummary, seat: Seat): string {
  const p = summary.players.find((pl) => pl.seat === seat);
  if (p?.color) return p.color;
  return SEAT_HEX[seat % SEAT_HEX.length]!;
}

/** null = no icon chosen (plain colored token). */
export function seatIcon(summary: GameSummary, seat: Seat): string | null {
  return summary.players.find((pl) => pl.seat === seat)?.icon ?? null;
}

export function seatIsTransparent(summary: GameSummary, seat: Seat): boolean {
  return summary.players.find((pl) => pl.seat === seat)?.color === 'transparent';
}

/** A player's token, everywhere it appears as a small DOM dot (chips, lists). */
export function SeatDot({ summary, seat, size }: { summary: GameSummary; seat: Seat; size?: number }) {
  const color = seatColor(summary, seat);
  const icon = seatIcon(summary, seat);
  const transparent = color === 'transparent';
  return (
    <span
      className="token"
      style={{
        background: transparent ? 'transparent' : color,
        boxShadow: transparent
          ? 'inset 0 0 0 2px rgba(255,255,255,0.7)'
          : 'inset 0 -2px 3px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.4)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        ...(size ? { width: size, height: size, fontSize: size * 0.72 } : { fontSize: '1.3em' }),
      }}
    >
      {icon ?? ''}
    </span>
  );
}

/** SVG counterpart of SeatDot — a circle (or ring, if transparent) plus centered icon glyph. */
export function SeatToken({ summary, seat, cx, cy, r, ringOnly }: {
  summary: GameSummary;
  seat: Seat;
  cx: number;
  cy: number;
  r: number;
  /** force a stroke-only ring even for opaque colors (e.g. highlighted state) */
  ringOnly?: boolean;
}) {
  const color = seatColor(summary, seat);
  const icon = seatIcon(summary, seat);
  const transparent = ringOnly || color === 'transparent';
  return (
    <g>
      {!transparent && <circle cx={cx} cy={cy + r * 0.15} r={r} fill="rgba(0,0,0,0.35)" />}
      <circle cx={cx} cy={cy} r={r}
        fill={transparent ? 'none' : color}
        stroke={transparent ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)'}
        strokeWidth={transparent ? Math.max(2, r * 0.22) : Math.max(1.5, r * 0.12)} />
      {!transparent && <circle cx={cx - r * 0.3} cy={cy - r * 0.3} r={r * 0.22} fill="rgba(255,255,255,0.4)" />}
      {icon && (
        <text x={cx} y={cy + r * 0.35} textAnchor="middle" fontSize={r * 1.3} style={{ pointerEvents: 'none' }}>
          {icon}
        </text>
      )}
    </g>
  );
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Generic "slide a piece from A to B" tween, so a board can show motion
 * instead of an instant snap whenever exactly one piece relocates.
 * Pass a `moveKey` that changes once per real move (e.g. a move counter or
 * `${from}-${to}-${seq}`) — while sliding this returns the live {x, y};
 * once settled (or before the first move) it returns null, meaning "render
 * at the resting `to` position normally".
 */
export function useSlideAnim(
  moveKey: string | null,
  from: { x: number; y: number } | null,
  to: { x: number; y: number } | null,
  duration = 320,
): { x: number; y: number } | null {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!moveKey || !from || !to) return;
    if (seen.current === moveKey) return;
    const isFirst = seen.current === null;
    seen.current = moveKey;
    if (isFirst) return; // don't animate the initial mount / rehydrate

    let cancelled = false;
    const start = performance.now();
    const frame = (now: number) => {
      if (cancelled) return;
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOutQuad(t);
      setPos({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        setTimeout(() => !cancelled && setPos(null), 60);
      }
    };
    requestAnimationFrame(frame);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey]);

  return pos;
}

/**
 * How the TV letterboxes board SVGs: 'fit' keeps the aspect ratio,
 * 'stretch' fills the whole area. TvPage provides it; phones use the default.
 */
export type TvFit = 'fit' | 'stretch';
export const TvFitContext = createContext<TvFit>('fit');

/** preserveAspectRatio value for board <svg>s honoring the TV's fit mode. */
export function useBoardFit(): string {
  return useContext(TvFitContext) === 'stretch' ? 'none' : 'xMidYMid meet';
}

/** Canonical seat colors — keep in sync with .seat-color-N in styles.css. */
export const SEAT_HEX = ['#ff4d6d', '#2ee6c9', '#ffb930', '#8b6cff', '#45a6ff', '#9ad14b'];

export function seatName(summary: GameSummary, seat: Seat): string {
  return summary.players.find((p) => p.seat === seat)?.displayName ?? `Player ${seat + 1}`;
}

/** Sidebar list of players with turn highlight + connectivity. */
export function SeatTokens({
  summary,
  activeSeats,
}: {
  summary: GameSummary;
  activeSeats: Seat[];
}) {
  return (
    <>
      {summary.players.map((p) => (
        <div key={p.seat} className={`tv-player-chip ${activeSeats.includes(p.seat) ? 'active' : ''}`}>
          <SeatDot summary={summary} seat={p.seat} />
          <span className="grow">
            {p.displayName}
            {p.team !== null && <span className="dim small"> · team {p.team + 1}</span>}
          </span>
          {p.eliminated ? <span className="dc">✕</span> : !p.connected && <span className="dc">⚠</span>}
        </div>
      ))}
    </>
  );
}

/** Gold "it's your turn" callout. */
export function Prompt({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <div className={`prompt${danger ? ' danger' : ''}`}>{children}</div>;
}

/** "Waiting for X…" with animated ellipsis. */
export function Waiting({ state }: { state: LiveState<any, any> }) {
  const names = state.activeSeats.map((s) => seatName(state.summary, s)).join(', ');
  return <p className="waiting">Waiting for {names || 'others'}</p>;
}

/** A die face rendered with pips. */
const PIP_CELLS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};
export function Die({ value, size = 52 }: { value: number; size?: number }) {
  const pips = PIP_CELLS[value] ?? [];
  return (
    <span className="die rolled" key={value} style={{ width: size, height: size }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={pips.includes(i) ? 'pip' : ''} style={{ width: size * 0.17, height: size * 0.17 }} />
      ))}
    </span>
  );
}

export function EventLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <p className="event-line" key={text}>{text}</p>;
}

const CONFETTI_COLORS = ['#ff4d6d', '#2ee6c9', '#8b6cff', '#45a6ff', '#ffffff', '#ff9d3c'];

export function WinnerBanner({ state }: { state: LiveState<any, any> }) {
  if (state.status !== 'completed' || !state.result) return null;
  const { winners, winningTeam, cooperativeLoss } = state.result;
  let text: string;
  if (cooperativeLoss) {
    text = 'The game won — better luck next time!';
  } else if (winningTeam !== undefined) {
    text = `Team ${winningTeam + 1} wins!`;
  } else if (winners && winners.length > 0) {
    text = `${winners.map((s) => seatName(state.summary, s)).join(' & ')} wins!`;
  } else {
    text = 'Game over';
  }
  if (cooperativeLoss) {
    return <div className="winner-banner loss">💀 {text}</div>;
  }
  return (
    <div className="winner-banner">
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${(i * 7.3 + 3) % 100}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDelay: `${(i % 7) * 0.35}s`,
            animationDuration: `${2.1 + (i % 4) * 0.4}s`,
          }}
        />
      ))}
      <span className="trophy">🏆</span> {text}
    </div>
  );
}
