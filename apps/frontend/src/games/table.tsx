import React, { createContext, useContext, useEffect, useMemo } from 'react';
import type { Seat } from '@gamebox/shared-types';
import { DEFAULT_GAME_OPTIONS, type GameOptions } from '@gamebox/shared-types';
import { useBeatPlayer, useClockReading, type BeatPlayer, type ClockReading } from './beats.js';
import { useTurnChime } from './anim.js';
import { setMuted, unlockSound } from './sfx.js';
import { seatName } from './common.js';
import type { LiveState } from './types.js';

/**
 * One table context per screen.
 *
 * The beat player owns timers and fires sounds, so exactly one may exist per
 * live state — two would double every cue and race each other's queues. The
 * page creates it here and every game UI reads it, instead of each board
 * spinning up its own.
 */
export interface TableContextValue {
  options: GameOptions;
  beats: BeatPlayer;
  clock: ClockReading | null;
  /** Seat whose point of view the board should present, or null for neutral. */
  povSeat: Seat | null;
  nameOf: (seat: Seat) => string;
}

const TableContext = createContext<TableContextValue | null>(null);

export function useTable(): TableContextValue {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error('useTable must be used inside a <TableProvider>');
  return ctx;
}

/**
 * Safe variant for components that may render outside a provider (a board
 * embedded in the lobby preview, say) — returns sensible inert defaults.
 */
export function useTableOptional(): TableContextValue | null {
  return useContext(TableContext);
}

export function TableProvider({
  state,
  yourSeat,
  children,
}: {
  state: LiveState<any, any> | null;
  /** The viewer's own seat on a phone; omit on the TV, which has no seat. */
  yourSeat?: Seat | null;
  children: React.ReactNode;
}) {
  const options = state?.options ?? DEFAULT_GAME_OPTIONS;
  const beats = useBeatPlayer(state, options);
  const clock = useClockReading(state?.clock);

  useEffect(() => {
    setMuted(!options.sound);
  }, [options.sound]);

  // Browsers only start an AudioContext from a real gesture. On a phone the
  // first tap anywhere is enough; the TV gets an explicit <SoundGate>.
  useEffect(() => {
    if (!options.sound) return;
    const unlock = () => unlockSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [options.sound]);

  const isYourTurn =
    yourSeat !== null && yourSeat !== undefined && (state?.activeSeats.includes(yourSeat) ?? false);
  useTurnChime(isYourTurn && state?.status === 'active', options.sound);

  /**
   * Whose side of the table we are looking from. On a phone that is always
   * you — your own board never spins away under you. On the TV it follows
   * whoever is up, which is what makes a shared screen read as a real board
   * being turned towards the current player.
   */
  const povSeat: Seat | null = useMemo(() => {
    if (!options.perspective) return null;
    if (yourSeat !== null && yourSeat !== undefined) return yourSeat;
    return state?.activeSeats[0] ?? null;
  }, [options.perspective, yourSeat, state?.activeSeats]);

  const value = useMemo<TableContextValue>(
    () => ({
      options,
      beats,
      clock,
      povSeat,
      nameOf: (seat: Seat) => (state ? seatName(state.summary, seat) : `Player ${seat + 1}`),
    }),
    [options, beats, clock, povSeat, state],
  );

  return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
}
