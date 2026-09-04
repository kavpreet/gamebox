import type { Seat } from '@gamebox/shared-types';
import React from 'react';
import { BeatBanner, BoardStage, CashFly, SoundGate, TurnBanner, povSpin } from './anim.js';
import { activeBeat } from './beats.js';
import { useTable } from './table.js';

/**
 * The bits of table furniture every screen wants: the narration banner and,
 * on the TV, the one tap that unlocks audio.
 *
 * Rendered by the page rather than by each game UI, so a board that hasn't
 * been taught about beats still narrates its moves.
 */
export function TableChrome({ showSoundGate = false }: { showSoundGate?: boolean }) {
  const { beats, options, nameOf } = useTable();
  // Money is the change players most often failed to notice, so when a money
  // beat is on screen the amount also flies up over the board.
  const money = activeBeat(beats, 'money');
  const amount = Number(money?.data?.amount ?? 0);
  return (
    <>
      {options.animate && amount !== 0 && <CashFly key={money!.id} amount={amount} />}
      {options.animate && <BeatBanner player={beats} nameOf={nameOf} />}
      {showSoundGate && <SoundGate wanted={options.sound} />}
    </>
  );
}

/**
 * Puts a board on a table you are sitting at.
 *
 * Two things happen here. The board is tilted away from the viewer so it reads
 * as a physical surface rather than a diagram, and on the TV it *turns* to
 * bring the current player's edge to the front — which is what makes a shared
 * screen say "your go" without a label. Phones never rotate: your own view of
 * the table should not swing around under you between turns.
 *
 * While the dice are in the air the camera lifts and pulls back to take in the
 * whole board, then settles again — the roll gets its own moment instead of
 * being a number that quietly changed.
 */
export function TableStage({
  children,
  sides = 4,
  tilt = 46,
  rotate = true,
}: {
  children: React.ReactNode;
  /** How many edges players sit at — 4 for a square board, 2 for a grid. */
  sides?: number;
  tilt?: number;
  rotate?: boolean;
}) {
  const { options, povSeat, beats } = useTable();
  const rolling = beats.current?.kind === 'dice';
  return (
    <BoardStage
      enabled={options.perspective}
      tilt={rolling ? Math.max(0, tilt - 20) : tilt}
      spin={rotate ? povSpin(povSeat, sides) : 0}
      zoom={rolling ? 0.88 : 1}
    >
      {children}
    </BoardStage>
  );
}

/** The big "who is up" strip. TV only — a phone already knows it is you. */
export function TableTurnBanner({ seats, label }: { seats: Seat[]; label?: string }) {
  const { nameOf, clock } = useTable();
  return <TurnBanner seats={seats} nameOf={nameOf} label={label} reading={clock} />;
}
