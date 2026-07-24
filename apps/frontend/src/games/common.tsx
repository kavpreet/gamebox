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
  // 'transparent' is a legacy value from before it was removed as an option
  if (p?.color && p.color !== 'transparent') return p.color;
  return SEAT_HEX[seat % SEAT_HEX.length]!;
}

/** null = no icon chosen (plain colored token). */
export function seatIcon(summary: GameSummary, seat: Seat): string | null {
  return summary.players.find((pl) => pl.seat === seat)?.icon ?? null;
}

/** A player's token, everywhere it appears as a small DOM dot (chips, lists). */
export function SeatDot({ summary, seat, size }: { summary: GameSummary; seat: Seat; size?: number }) {
  const color = seatColor(summary, seat);
  const icon = seatIcon(summary, seat);
  return (
    <span
      className="token"
      style={{
        background: color,
        boxShadow: 'inset 0 -2px 3px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.4)',
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

/** SVG counterpart of SeatDot — a domed circle plus centered icon glyph. */
export function SeatToken({ summary, seat, cx, cy, r }: {
  summary: GameSummary;
  seat: Seat;
  cx: number;
  cy: number;
  r: number;
}) {
  const color = seatColor(summary, seat);
  const icon = seatIcon(summary, seat);
  return (
    <g>
      <ellipse cx={cx} cy={cy + r * 0.28} rx={r * 1.05} ry={r * 0.85} fill="rgba(0,0,0,0.4)" />
      <circle cx={cx} cy={cy} r={r}
        fill={color}
        stroke="rgba(255,255,255,0.55)"
        strokeWidth={Math.max(1.5, r * 0.12)} />
      {/* domed top-light; falls back to a plain sheen if the board has no FxDefs */}
      <circle cx={cx} cy={cy} r={r * 0.94} fill="url(#gb-shine) rgba(255,255,255,0.18)" style={{ pointerEvents: 'none' }} />
      <circle cx={cx - r * 0.3} cy={cy - r * 0.32} r={r * 0.24} fill="rgba(255,255,255,0.45)" />
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

export type HandPhase = 'grab' | 'drag' | 'drop';

export interface HandMoveState {
  /** live position of the carried piece */
  x: number;
  y: number;
  phase: HandPhase;
  /** progress through the current phase, 0..1 */
  t: number;
}

/**
 * "A hand picks the piece up, drags it, and sets it down" — the dramatic
 * version of useSlideAnim. Same contract: pass a moveKey that changes once
 * per real move; returns null when idle (render the piece at rest), or the
 * live carried position + phase while animating. Render the piece at {x,y}
 * and a <HandGlyph> on top.
 */
export function useHandMove(
  moveKey: string | null,
  from: { x: number; y: number } | null,
  to: { x: number; y: number } | null,
  duration = 480,
): HandMoveState | null {
  const [st, setSt] = useState<HandMoveState | null>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!moveKey || !from || !to) return;
    if (seen.current === moveKey) return;
    const isFirst = seen.current === null;
    seen.current = moveKey;
    if (isFirst) return; // don't animate initial mount / rehydrate

    const GRAB = 220;
    const DROP = 260;
    let cancelled = false;
    const start = performance.now();
    const frame = (now: number) => {
      if (cancelled) return;
      const el = now - start;
      if (el >= GRAB + duration + DROP) {
        setSt(null);
        return;
      }
      if (el < GRAB) {
        setSt({ x: from.x, y: from.y, phase: 'grab', t: el / GRAB });
      } else if (el < GRAB + duration) {
        const t = (el - GRAB) / duration;
        const e = easeInOutQuad(t);
        const lift = Math.sin(t * Math.PI) * 7; // slight arc, like lifting off the board
        setSt({
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e - lift,
          phase: 'drag',
          t,
        });
      } else {
        setSt({ x: to.x, y: to.y, phase: 'drop', t: (el - GRAB - duration) / DROP });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey]);

  return st;
}

/** The hand that "moves" pieces. Draw after the carried piece so it sits on top. */
export function HandGlyph({ x, y, phase, t, size = 40 }: {
  x: number;
  y: number;
  phase: HandPhase;
  t: number;
  size?: number;
}) {
  const holding = phase === 'drag';
  // hand descends onto the piece, pinches while dragging, lifts away after
  const hover = phase === 'grab' ? (1 - t) * size * 0.6 : phase === 'drop' ? t * size * 0.7 : 0;
  const opacity = phase === 'grab' ? Math.min(1, t * 2 + 0.3) : phase === 'drop' ? 1 - t : 1;
  return (
    <text
      x={x + size * 0.34}
      y={y + size * 0.52 - hover}
      textAnchor="middle"
      fontSize={size}
      opacity={opacity}
      transform={`rotate(-28 ${x} ${y})`}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {holding ? '🤏' : '🖐'}
    </text>
  );
}

/**
 * True while `key` changed within the last `ms` (after `delay`). Skips the
 * first observed key so rehydrates don't flash effects. Use for transient
 * board FX: capture explosions, rebirth pulses, conquest flashes.
 */
export function useRecentChange(key: string | null, ms = 900, delay = 0): boolean {
  const [active, setActive] = useState(false);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!key) return;
    if (seen.current === key) return;
    const isFirst = seen.current === null;
    seen.current = key;
    if (isFirst) return;
    let off: ReturnType<typeof setTimeout>;
    const on = setTimeout(() => {
      setActive(true);
      off = setTimeout(() => setActive(false), ms);
    }, delay);
    return () => {
      clearTimeout(on);
      if (off) clearTimeout(off);
      setActive(false);
    };
  }, [key, ms, delay]);
  return active;
}

/**
 * Explosion where a piece just got captured/conquered: white flash, shock
 * ring, flying shards, 💥. Mount it (conditionally) when the capture happens —
 * CSS keyframes run once on mount. Pair with useRecentChange for timing.
 */
export function CaptureBlast({ x, y, color, r = 18 }: { x: number; y: number; color: string; r?: number }) {
  const N = 10;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={r * 1.4} fill="#ffffff" className="gb-flash" />
      <circle cx={x} cy={y} r={r * 2.1} fill="none" stroke={color} strokeWidth={Math.max(2.5, r * 0.16)} className="gb-ring" />
      {Array.from({ length: N }, (_, i) => {
        const deg = (i / N) * 360 + 17;
        const dist = r * (2 + (i % 3) * 0.6);
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${deg})`}>
            <circle
              r={r * (i % 2 ? 0.14 : 0.22)}
              fill={i % 3 === 2 ? '#ffd97a' : color}
              className="gb-shard"
              style={{ ['--gb-dist' as string]: `${dist}px` }}
            />
          </g>
        );
      })}
      <text x={x} y={y + r * 0.55} textAnchor="middle" fontSize={r * 1.9} className="gb-boom">💥</text>
    </g>
  );
}

/**
 * Rebirth glow at the spot where a captured piece respawns (Ludo yard,
 * Sorry! start, etc). Converging ring + soft glow; render the respawned
 * piece with className="gb-pop" alongside for the pop-in.
 */
export function RebirthPulse({ x, y, color, r = 18 }: { x: number; y: number; color: string; r?: number }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={r * 1.6} fill={color} opacity={0.25} className="gb-flash" />
      <circle cx={x} cy={y} r={r * 1.5} fill="none" stroke={color} strokeWidth={Math.max(2, r * 0.14)} className="gb-rebirth-ring" />
      <text x={x} y={y + r * 0.4} textAnchor="middle" fontSize={r * 1.3} className="gb-boom">✨</text>
    </g>
  );
}

/**
 * Shared pseudo-3D defs for board SVGs. Include once inside the <svg>, then
 * reference: url(#gb-shine) (radial top-light for tokens/tiles),
 * url(#gb-vignette) (edge darkening over the whole board),
 * url(#gb-boardlight) (diagonal top-light wash), filter url(#gb-glow).
 */
export function FxDefs() {
  return (
    <defs>
      <radialGradient id="gb-shine" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="45%" stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
      </radialGradient>
      <radialGradient id="gb-vignette" cx="50%" cy="42%" r="72%">
        <stop offset="0%" stopColor="#000000" stopOpacity="0" />
        <stop offset="78%" stopColor="#000000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.38" />
      </radialGradient>
      <linearGradient id="gb-boardlight" x1="0%" y1="0%" x2="65%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
        <stop offset="45%" stopColor="#ffffff" stopOpacity="0.02" />
        <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
      </linearGradient>
      <filter id="gb-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="4" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
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
