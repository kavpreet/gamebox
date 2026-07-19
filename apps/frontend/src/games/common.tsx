import type { ReactNode } from 'react';
import type { GameSummary, Seat } from '@gamebox/shared-types';
import type { LiveState } from './types.js';

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
