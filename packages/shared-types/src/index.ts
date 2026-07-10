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
