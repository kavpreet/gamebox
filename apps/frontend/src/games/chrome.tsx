import type { Seat } from '@gamebox/shared-types';
import { BeatBanner, CashFly, SoundGate, TurnBanner } from './anim.js';
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

/** The big "who is up" strip. TV only — a phone already knows it is you. */
export function TableTurnBanner({ seats, label }: { seats: Seat[]; label?: string }) {
  const { nameOf, clock } = useTable();
  return <TurnBanner seats={seats} nameOf={nameOf} label={label} reading={clock} />;
}
