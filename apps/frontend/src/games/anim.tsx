import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Seat } from '@gamebox/shared-types';
import type { BeatPlayer, ClockReading } from './beats.js';
import { sfx, soundReady, unlockSound } from './sfx.js';

/**
 * The shared "it feels like a board" layer: tokens that walk square by square,
 * dice that tumble, a table you look across at an angle, and a camera that
 * turns to face whoever is up.
 *
 * Nothing here is authoritative. Every component takes the already-correct
 * state and only decides how it arrives on screen.
 */

// ─── Walking tokens ─────────────────────────────────────────────────────────

// ─── 3D stage ───────────────────────────────────────────────────────────────

export interface StageProps {
  children: React.ReactNode;
  /** Degrees of forward tilt — 0 is flat-on, ~52 is "sitting at the table". */
  tilt?: number;
  /** Degrees the table is turned, to bring the active player's edge forward. */
  spin?: number;
  /** Camera push-in, used for the dice moment. */
  zoom?: number;
  /** Disable to render the plain flat board (accessibility / low-power TVs). */
  enabled?: boolean;
  className?: string;
}

/**
 * How far the board under this subtree is currently turned, in degrees.
 *
 * Boards whose squares carry writing read it back and counter-rotate their
 * labels: the *board* should turn to face you, but the text on it must never
 * end up upside-down, which is what a physical board gets for free by having
 * the players' heads move instead of the table.
 */
const BoardSpinContext = createContext(0);

export function useBoardSpin(): number {
  return useContext(BoardSpinContext);
}

/**
 * Tilts the board into a table you're sitting at, and turns it to face whoever
 * is up. The rotation is the point: on a real board you physically see the
 * layout from your own side, and turning the screen to match is what makes a
 * remote game read as "my turn" without a label.
 */
export function BoardStage({
  children,
  tilt = 0,
  spin = 0,
  zoom = 1,
  enabled = true,
  className = '',
}: StageProps) {
  if (!enabled) {
    return (
      <BoardSpinContext.Provider value={0}>
        <div className={`board-flat ${className}`}>{children}</div>
      </BoardSpinContext.Provider>
    );
  }
  return (
    <BoardSpinContext.Provider value={spin}>
      <div className={`board-stage ${className}`}>
        <div
          className="board-stage-inner"
          style={{
            transform: `translateZ(0) scale(${zoom}) rotateX(${tilt}deg) rotateZ(${spin}deg)`,
          }}
        >
          {children}
        </div>
      </div>
    </BoardSpinContext.Provider>
  );
}

/**
 * How far to turn a square board so `seat`'s edge faces the viewer.
 *
 * Players sit on four sides; seats beyond four share an edge, which is exactly
 * what happens at a crowded real table.
 */
export function povSpin(seat: Seat | null | undefined, sides = 4): number {
  if (seat === null || seat === undefined) return 0;
  return -(seat % sides) * (360 / sides);
}

// ─── Narration + clock chrome ───────────────────────────────────────────────

/** The current beat, centre-stage, with a nudge that you can tap past it. */
export function BeatBanner({
  player,
  nameOf,
  className = '',
}: {
  player: BeatPlayer;
  nameOf: (seat: Seat) => string;
  className?: string;
}) {
  const beat = player.current;
  if (!beat) return null;
  return (
    <div className={`beat-banner beat-${beat.kind} ${className}`} onClick={player.skip} role="status">
      {beat.seat !== null && <span className={`token seat-color-${beat.seat % 6}`} />}
      <span className="beat-text">
        {beat.seat !== null && <strong>{nameOf(beat.seat)} </strong>}
        {beat.text}
      </span>
      {player.pending > 0 && <span className="beat-more">+{player.pending}</span>}
    </div>
  );
}

/** Draining ring around whoever is up. */
export function ClockRing({ reading, size = 44 }: { reading: ClockReading | null; size?: number }) {
  const lastTick = useRef(-1);
  useEffect(() => {
    if (!reading || !reading.urgent || reading.expired) return;
    if (lastTick.current === reading.secondsLeft) return;
    lastTick.current = reading.secondsLeft;
    if (soundReady()) sfx.tick();
  }, [reading]);

  if (!reading) return null;
  const r = size / 2 - 3;
  const circumference = 2 * Math.PI * r;
  return (
    <svg className={`clock-ring ${reading.urgent ? 'urgent' : ''}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} className="clock-track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="clock-progress"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * reading.progress}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dy="0.35em" textAnchor="middle" className="clock-label">
        {reading.secondsLeft}
      </text>
    </svg>
  );
}

/**
 * A TV nobody has touched cannot legally make noise, so offer the one tap that
 * unlocks it rather than silently shipping a mute table.
 */
export function SoundGate({ wanted }: { wanted: boolean }) {
  const [ready, setReady] = useState(soundReady());
  useEffect(() => {
    if (!wanted || ready) return;
    const h = setInterval(() => setReady(soundReady()), 1000);
    return () => clearInterval(h);
  }, [wanted, ready]);
  if (!wanted || ready) return null;
  return (
    <button
      className="sound-gate"
      onClick={() => {
        unlockSound();
        setReady(soundReady());
      }}
    >
      🔈 Tap for sound
    </button>
  );
}

/**
 * Chime and buzz once whenever the turn arrives at this seat.
 *
 * The buzz matters more than the chime: it reaches a player who has put the
 * phone down and is looking at the TV, which is most of them, most of the
 * time. It is deliberately not gated on the sound setting — a silent table
 * still wants to know whose go it is.
 */
export function useTurnChime(isYourTurn: boolean, enabled: boolean): void {
  const was = useRef(isYourTurn);
  useEffect(() => {
    if (isYourTurn && !was.current) {
      if (enabled && soundReady()) sfx.yourTurn();
      try {
        navigator.vibrate?.([28, 60, 28]);
      } catch {
        // vibration is unsupported or blocked — nothing to fall back to
      }
    }
    was.current = isYourTurn;
  }, [isYourTurn, enabled]);
}

/**
 * A full-width announcement of whose turn it is.
 *
 * The active-seat chip is easy to miss from across a room, which is half of
 * "we didn't even understand it moved" — you cannot follow a board if you
 * don't know who is acting on it.
 */
export function TurnBanner({
  seats,
  nameOf,
  label = 'to play',
  reading,
}: {
  seats: Seat[];
  nameOf: (seat: Seat) => string;
  label?: string;
  reading?: ClockReading | null;
}) {
  if (seats.length === 0) return null;
  const lead = seats[0]!;
  return (
    <div className={`turn-banner seat-border-${lead % 6}`}>
      <span className={`token big-token seat-color-${lead % 6}`} />
      <span className="turn-name">{seats.map(nameOf).join(' & ')}</span>
      <span className="turn-label">{label}</span>
      {reading && <ClockRing reading={reading} size={54} />}
    </div>
  );
}

/** Money leaving or arriving, drawn where the eye already is. */
export function CashFly({ amount, at }: { amount: number; at?: { x: number; y: number } }) {
  if (!amount) return null;
  return (
    <div
      className={`cash-fly ${amount < 0 ? 'negative' : 'positive'}`}
      style={at ? { left: at.x, top: at.y } : { left: '50%', top: '38%' }}
    >
      {amount < 0 ? '−' : '+'}${Math.abs(amount)}
    </div>
  );
}

