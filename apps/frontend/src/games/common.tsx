import type { GameSummary, Seat } from '@gamebox/shared-types';
import type { LiveState } from './types.js';

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
          <span className={`token seat-color-${p.seat % 6}`} />
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

export function WinnerBanner({ state }: { state: LiveState<any, any> }) {
  if (state.status !== 'completed' || !state.result) return null;
  const { winners, winningTeam, cooperativeLoss } = state.result;
  let text: string;
  if (cooperativeLoss) {
    text = 'The game won — better luck next time!';
  } else if (winningTeam !== undefined) {
    text = `Team ${winningTeam + 1} wins! 🎉`;
  } else if (winners && winners.length > 0) {
    text = `${winners.map((s) => seatName(state.summary, s)).join(' & ')} wins! 🎉`;
  } else {
    text = 'Game over';
  }
  return (
    <div className="tv-player-chip active" style={{ justifyContent: 'center', fontWeight: 700 }}>
      🏆 {text}
    </div>
  );
}
