import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Beat, TableOptions, TurnClock } from '@gamebox/shared-types';
import { DEFAULT_TABLE_OPTIONS } from '@gamebox/shared-types';
import { playBeatSound, soundReady } from './sfx.js';
import type { LiveState } from './types.js';

/**
 * Replays the narration of a move at a human pace.
 *
 * The authoritative state still lands immediately — buttons, legality and the
 * scoreboard must never lag behind the server, and a stalled animation must
 * never be able to wedge the game. What the player pauses on is the *story*:
 * one beat at a time, on top of a board whose tokens walk rather than teleport.
 */

export interface QueuedBeat extends Beat {
  /** Monotonic id, so React keys stay stable across identical texts. */
  id: number;
}

export interface BeatPlayer {
  /** The beat on screen right now, or null when the table is quiet. */
  current: QueuedBeat | null;
  /** Beats still waiting behind `current`. */
  pending: number;
  /** True while any narration is playing. */
  busy: boolean;
  /** Drop everything queued and land on the final state now. */
  skip: () => void;
}

const DEFAULT_HOLD: Record<string, number> = {
  dice: 1100,
  move: 900,
  money: 900,
  card: 1900,
  capture: 800,
  build: 700,
  reveal: 1200,
  jail: 1200,
  turn: 700,
  say: 1000,
};

export function beatHold(beat: Beat): number {
  return beat.holdMs ?? DEFAULT_HOLD[beat.kind] ?? 900;
}

/**
 * Watches a live state for incoming beats and plays them in order.
 *
 * Enqueue is keyed on the state *object identity* rather than on `seq`: every
 * socket broadcast produces a fresh object, and only the broadcast that
 * followed a mutation carries beats, so a client that reconnects mid-game
 * receives an empty list and replays nothing it already missed.
 */
export function useBeatPlayer(state: LiveState | null, options?: TableOptions): BeatPlayer {
  const opts = options ?? state?.options ?? DEFAULT_TABLE_OPTIONS;
  const animate = opts.animate;
  const speed = opts.speed || 1;
  const wantSound = opts.sound;

  const [queue, setQueue] = useState<QueuedBeat[]>([]);
  const [current, setCurrent] = useState<QueuedBeat | null>(null);
  const nextId = useRef(0);
  const seenState = useRef<LiveState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Ingest ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state || state === seenState.current) return;
    seenState.current = state;
    const incoming = state.beats ?? [];
    if (incoming.length === 0) return;
    if (!animate) {
      // Narration off: still fire the sounds so the table stays audible.
      if (wantSound) for (const b of incoming) playBeatSound(b.kind, b.data);
      return;
    }
    setQueue((q) => [...q, ...incoming.map((b) => ({ ...b, id: nextId.current++ }))]);
  }, [state, animate, wantSound]);

  // ── Playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (current || queue.length === 0) return;
    const [head, ...rest] = queue;
    setQueue(rest);
    setCurrent(head!);
    if (wantSound && soundReady()) playBeatSound(head!.kind, head!.data);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCurrent(null);
    }, Math.max(120, beatHold(head!) / speed));
  }, [queue, current, speed, wantSound]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const skip = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setQueue([]);
    setCurrent(null);
  }, []);

  return useMemo(
    () => ({ current, pending: queue.length, busy: current !== null || queue.length > 0, skip }),
    [current, queue.length, skip],
  );
}

/** The most recent beat of a given kind, while it is on screen. */
export function activeBeat(player: BeatPlayer, kind: Beat['kind']): QueuedBeat | null {
  return player.current?.kind === kind ? player.current : null;
}

// ─── Turn clock ─────────────────────────────────────────────────────────────

export interface ClockReading {
  /** 0 → just started, 1 → expired. */
  progress: number;
  secondsLeft: number;
  expired: boolean;
  urgent: boolean;
}

/**
 * Ticks a local countdown off the server's deadline. The deadline is
 * authoritative and shared, so every screen in the room drains in step —
 * this only decides how often to repaint it.
 */
export function useClockReading(clock: TurnClock | null | undefined): ClockReading | null {
  const [, force] = useState(0);
  const running = Boolean(clock && clock.mode !== 'off' && clock.deadline);

  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(h);
  }, [running]);

  if (!clock || clock.mode === 'off' || !clock.deadline) return null;
  const start = Date.parse(clock.startedAt);
  const end = Date.parse(clock.deadline);
  const now = Date.now();
  const span = Math.max(1, end - start);
  const progress = Math.min(1, Math.max(0, (now - start) / span));
  const secondsLeft = Math.max(0, Math.ceil((end - now) / 1000));
  return { progress, secondsLeft, expired: now >= end, urgent: secondsLeft <= 10 };
}
