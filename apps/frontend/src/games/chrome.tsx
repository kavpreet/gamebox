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
export function TableChrome({
  showSoundGate = false,
  banner = true,
}: {
  showSoundGate?: boolean;
  /**
   * The floating narration toast. On by default for phones; the TV turns it
   * off and uses <TableLog> in the sidebar instead, where a line can sit long
   * enough to actually be read from a sofa.
   */
  banner?: boolean;
}) {
  const { beats, options, nameOf } = useTable();
  // Money is the change players most often failed to notice, so when a money
  // beat is on screen the amount also flies up over the board.
  const money = activeBeat(beats, 'money');
  const amount = Number(money?.data?.amount ?? 0);
  return (
    <>
      {options.animate && amount !== 0 && <CashFly key={money!.id} amount={amount} />}
      {banner && options.animate && <BeatBanner player={beats} nameOf={nameOf} />}
      {showSoundGate && <SoundGate wanted={options.sound} />}
    </>
  );
}

/**
 * What has just happened, as a standing list rather than a passing toast.
 *
 * The floating banner was tuned for a phone in your hand: it appears, it goes,
 * and if you were looking at the board you missed it. On a TV across a room
 * that is exactly the wrong shape — so the same beats land here, in the
 * sidebar under the players, and stay until newer ones push them out. Newest
 * first, because that is where the eye goes back to.
 */
export function TableLog({ limit = 6 }: { limit?: number }) {
  const { beats, nameOf } = useTable();
  const items = beats.recent.slice(-limit).reverse();
  if (items.length === 0) return null;
  return (
    <div className="table-log" role="log" aria-live="polite">
      {items.map((b, i) => (
        <div
          key={b.id}
          className={`table-log-line beat-${b.kind}`}
          // Older lines recede rather than vanish, so the newest reads first
          // without the rest disappearing out from under anyone still reading.
          style={{ opacity: Math.max(0.32, 1 - i * 0.16) }}
        >
          {b.seat !== null && <span className={`token seat-color-${b.seat % 6}`} />}
          <span className="table-log-text">
            {b.seat !== null && <strong>{nameOf(b.seat)} </strong>}
            {b.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Puts a board on a table you are sitting at.
 *
 * Two things happen here. A board that turns is tilted away from the viewer so
 * it reads as a physical surface rather than a diagram, and on the TV it
 * *turns* to bring the current player's edge to the front — which is what
 * makes a shared screen say "your go" without a label. Phones never rotate:
 * your own view of the table should not swing around under you between turns.
 * A board with `rotate` off is drawn flat instead, at full size.
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
  // A board that never turns gains nothing from being laid back: the tilt only
  // foreshortens it and costs it size on screen. The tilt earns its keep by
  // selling the *turn*, so boards that don't turn come flat to the front.
  const laid = rotate ? (rolling ? Math.max(0, tilt - 20) : tilt) : 0;
  return (
    <BoardStage
      enabled={options.perspective}
      tilt={laid}
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
