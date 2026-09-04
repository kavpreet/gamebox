import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export interface WalkResult<K extends string | number> {
  /** Positions to draw right now — behind `target` while a token is walking. */
  shown: Record<K, number>;
  /** Whoever is mid-walk, so the UI can spotlight them. */
  walking: K | null;
  /** True while any token is still travelling. */
  busy: boolean;
}

/**
 * Walks tokens to their new squares one step at a time instead of teleporting.
 *
 * This is the fix for "we didn't even understand it moved": the eye tracks a
 * moving object and ignores one that jumps. The path is supplied by the caller
 * because "the squares between here and there" means something different on a
 * Monopoly ring, a serpentine Snakes ladder, and a Ludo track.
 */
export function useWalk<K extends string | number>(
  target: Record<K, number>,
  pathBetween: (from: number, to: number) => number[],
  opts: { stepMs?: number; enabled?: boolean; sound?: boolean } = {},
): WalkResult<K> {
  const { stepMs = 210, enabled = true, sound = true } = opts;
  const [shown, setShown] = useState<Record<K, number>>(target);
  const [walking, setWalking] = useState<K | null>(null);
  const queues = useRef(new Map<K, number[]>());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // Playback settings are read inside the ticker, which must not be torn down
  // and rebuilt when they change — that would reset its phase mid-walk.
  const cfg = useRef({ stepMs, sound });
  cfg.current = { stepMs, sound };

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  /** Advance every walking token by one square. */
  const tick = useCallback(() => {
    if (queues.current.size === 0) {
      stop();
      setWalking(null);
      return;
    }
    const next = { ...shownRef.current };
    let moved: K | null = null;
    let landed = false;
    for (const [key, path] of queues.current) {
      const step = path.shift();
      if (step === undefined) {
        queues.current.delete(key);
        landed = true;
        continue;
      }
      next[key] = step;
      moved = key;
      if (cfg.current.sound && soundReady()) sfx.hop(0, path.length + 1);
    }
    if (landed && cfg.current.sound && soundReady()) sfx.land();
    shownRef.current = next;
    setShown(next);
    setWalking(moved);
    if (queues.current.size === 0) {
      stop();
      setWalking(null);
    }
  }, [stop]);

  const start = useCallback(() => {
    if (timer.current) return; // already walking — never reset its phase
    timer.current = setInterval(tick, cfg.current.stepMs);
  }, [tick]);

  // New target → queue the squares each token must pass through, then walk.
  useEffect(() => {
    if (!enabled) {
      queues.current.clear();
      stop();
      shownRef.current = target;
      setShown(target);
      setWalking(null);
      return;
    }

    const next = { ...shownRef.current };
    let placed = false;
    for (const key of Object.keys(target) as K[]) {
      const to = target[key]!;
      const from = shownRef.current[key];
      if (from === undefined) {
        // A token we have never drawn (a player just seated) — place it.
        next[key] = to;
        placed = true;
        continue;
      }
      if (from === to) continue;
      const path = pathBetween(from, to).filter((sq) => sq !== from);
      queues.current.set(key, path.length ? path : [to]);
    }
    // A token that vanished (bankrupt, removed) stops being drawn.
    for (const key of Object.keys(shownRef.current) as K[]) {
      if (!(key in target)) {
        queues.current.delete(key);
        delete next[key];
        placed = true;
      }
    }
    if (placed) {
      shownRef.current = next;
      setShown(next);
    }
    if (queues.current.size > 0) start();
    // `target` is a fresh object each render from the server view, so identity
    // is the right trigger; pathBetween is expected to be stable or memoised.
  }, [target, pathBetween, enabled, start, stop]);

  useEffect(() => stop, [stop]);

  return { shown, walking, busy: queues.current.size > 0 };
}

/** Forward path around a ring of `size` squares (Monopoly, Ludo's main track). */
export function ringPath(size: number) {
  return (from: number, to: number): number[] => {
    const out: number[] = [];
    let cur = from;
    for (let i = 0; i < size; i++) {
      cur = (cur + 1) % size;
      out.push(cur);
      if (cur === to) break;
    }
    return out;
  };
}

/** Straight count from `from` to `to` — used by Snakes & Ladders' 1..100 track. */
export function countPath(from: number, to: number): number[] {
  const out: number[] = [];
  const dir = to > from ? 1 : -1;
  // A snake or ladder is a *jump*, not a walk: past a few squares it reads as
  // a slide, so long backwards/forwards leaps land in one step.
  if (Math.abs(to - from) > 12) return [to];
  for (let sq = from + dir; dir > 0 ? sq <= to : sq >= to; sq += dir) out.push(sq);
  return out.length ? out : [to];
}

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
  if (!enabled) return <div className={`board-flat ${className}`}>{children}</div>;
  return (
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

// ─── Dice ───────────────────────────────────────────────────────────────────

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [72, 25], [28, 50], [72, 50], [28, 75], [72, 75]],
};

/** A single die as a real CSS cube, tumbling then settling on its value. */
export function Die3D({ value, rolling, size = 84 }: { value: number; rolling: boolean; size?: number }) {
  // Each face is rotated into place on a cube of side `size`; the resting
  // transform brings the rolled value round to the front.
  const rest: Record<number, string> = {
    1: 'rotateX(0deg) rotateY(0deg)',
    2: 'rotateY(-90deg)',
    3: 'rotateX(-90deg)',
    4: 'rotateX(90deg)',
    5: 'rotateY(90deg)',
    6: 'rotateY(180deg)',
  };
  const faceTransform: Record<number, string> = {
    1: `translateZ(${size / 2}px)`,
    2: `rotateY(90deg) translateZ(${size / 2}px)`,
    3: `rotateX(90deg) translateZ(${size / 2}px)`,
    4: `rotateX(-90deg) translateZ(${size / 2}px)`,
    5: `rotateY(-90deg) translateZ(${size / 2}px)`,
    6: `rotateY(180deg) translateZ(${size / 2}px)`,
  };
  return (
    <div className="die-scene" style={{ width: size, height: size }}>
      <div
        className={`die-cube ${rolling ? 'rolling' : ''}`}
        style={{
          width: size,
          height: size,
          transform: rolling ? undefined : rest[value] ?? rest[1],
        }}
      >
        {[1, 2, 3, 4, 5, 6].map((f) => (
          <div key={f} className="die-face" style={{ width: size, height: size, transform: faceTransform[f] }}>
            <svg viewBox="0 0 100 100" width={size} height={size}>
              {PIPS[f]!.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={9} fill="#1b2038" />
              ))}
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The dice moment: the table pushes back and the dice land in front of it.
 *
 * The tumble is timed rather than driven from outside, because the result is
 * already known the instant the beat arrives — showing it immediately is what
 * made a roll feel like a number silently changing.
 */
export function DiceStage({
  dice,
  rolling,
  tumbleMs = 700,
}: {
  dice: number[];
  /** Force the tumble on; omit to let the stage settle on its own. */
  rolling?: boolean;
  tumbleMs?: number;
}) {
  const [settled, setSettled] = useState(false);
  const key = dice.join(',');
  useEffect(() => {
    setSettled(false);
    const h = setTimeout(() => setSettled(true), tumbleMs);
    return () => clearTimeout(h);
  }, [key, tumbleMs]);

  if (dice.length === 0) return null;
  const tumbling = rolling ?? !settled;
  return (
    <div className="dice-stage" aria-live="polite">
      {dice.map((d, i) => (
        <Die3D key={i} value={d} rolling={tumbling} />
      ))}
      {!tumbling && dice.length > 1 && (
        <div className="dice-total">{dice.reduce((a, b) => a + b, 0)}</div>
      )}
    </div>
  );
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

/** Stable per-render memo of a ring path function. */
export function useRingPath(size: number) {
  return useMemo(() => ringPath(size), [size]);
}
