export type Seat = number;

export type GameStatus =
  | 'lobby'
  | 'active'
  | 'paused'
  | 'completed'
  | 'abandoned'
  | 'discontinued';

export type DisconnectOption = 'skip' | 'pause' | 'kick';

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SeatAssignment {
  seat: Seat;
  userId: string | null;
  displayName: string;
  team: number | null;
  connected: boolean;
  eliminated: boolean;
  /** hex color, or 'transparent'; null = not yet customized (fallback palette applies) */
  color: string | null;
  /** an emoji, or null = no icon (plain colored token) */
  icon: string | null;
}

export interface GameSummary {
  id: string;
  gameType: string;
  status: GameStatus;
  joinPin: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  players: SeatAssignment[];
}

export interface RoomDTO {
  id: string;
  name: string;
  pairingCode: string;
  activeGameId: string | null;
}

/** Viewer identity passed to a GameModule's `view()` — a seat, or the passive TV/spectator sentinel. */
export type Viewer = Seat | 'SPECTATOR';

/**
 * Fixed palettes for player appearance customization (plan: pieces should be
 * recognizable at a glance — color, icon, or both). Shared between frontend
 * (picker UI) and backend (server-side validation) so they can never drift.
 */
export const SEAT_COLOR_PALETTE = [
  '#ff4d6d', '#2ee6c9', '#ffb930', '#8b6cff', '#45a6ff', '#9ad14b',
  '#ff8fd6', '#c9a13b', '#4de0a0', '#ff7a45', '#5ac8fa', '#e0e0e0',
] as const;

export const SEAT_ICON_PALETTE = [
  '😀', '😎', '🤖', '👻', '🐶', '🐱', '🦊', '🐸', '🐵', '🦁',
  '🐯', '🐼', '🐧', '🦄', '🐲', '🦖', '👑', '⭐', '🔥', '⚡',
] as const;

export function isValidSeatColor(c: string): boolean {
  return c === 'transparent' || (SEAT_COLOR_PALETTE as readonly string[]).includes(c);
}

export function isValidSeatIcon(i: string): boolean {
  return (SEAT_ICON_PALETTE as readonly string[]).includes(i);
}

/**
 * Wire message envelope for gameplay traffic over Socket.IO.
 * `state` is always the pre-projected view for the specific viewer that receives it —
 * never the raw authoritative state (see core-engine's view redaction).
 */
export interface StateUpdate<TView = unknown> {
  gameId: string;
  seq: number;
  status: GameStatus;
  activeSeats: Seat[];
  view: TView;
}

export interface IllegalMoveError {
  gameId: string;
  message: string;
}

export interface DisconnectVoteState {
  targetSeat: Seat;
  calledAt: string;
  votes: Partial<Record<Seat, DisconnectOption>>;
  resolvedOption: DisconnectOption | null;
}

export const DISCONNECT_GRACE_PERIOD_MS = 60_000;
