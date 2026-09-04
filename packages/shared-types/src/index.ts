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

/** Admin-only room row: never carries the PIN itself, only whether one is set. */
export interface AdminRoomDTO extends RoomDTO {
  hasPin: boolean;
  lastSeenAt: string | null;
}

export interface AllowedEmailDTO {
  email: string;
  addedAt: string;
  hasAccount: boolean;
  isAdmin: boolean;
  userId: string | null;
  displayName: string | null;
}

export interface MeDTO {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
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
  /**
   * Narration for the move that produced THIS update, in order. Present only
   * on the broadcast that follows a mutation — a re-broadcast to a client that
   * just joined carries none, so nobody replays a story they already missed.
   */
  beats?: Beat[];
  clock?: TurnClock | null;
  options?: GameOptions;
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

// ─── Table feel: beats, turn clock, per-game options ────────────────────────

/**
 * A single narrated *step* inside one server move.
 *
 * The root cause of "it moved and we didn't even see it" was that a move like
 * Monopoly's ROLL did six physical things (roll, walk, land, draw, charge,
 * jail) and collapsed them into one state snapshot with a single overwritable
 * `lastEvent` string. Beats are that lost story, recorded in order: the client
 * replays them with pacing and animation, then the authoritative state lands.
 *
 * Beats are presentation only — never rules. A client that ignores them still
 * plays a correct game, just an abrupt one.
 */
export type BeatKind =
  | 'say'        // plain narration
  | 'dice'       // dice tumble; data: { dice: number[] }
  | 'move'       // token walks; data: { from, to, path?: number[] }
  | 'money'      // cash changes hands; data: { amount, from?, to? }
  | 'card'       // a card is drawn/flipped; data: { title, text }
  | 'capture'    // a piece/army/token is removed; data: { at, victim? }
  | 'build'      // something is placed on the board; data: { at }
  | 'reveal'     // hidden info becomes public; data: free-form
  | 'jail'       // sent to jail / penalty box
  | 'turn';      // the turn passed; data: { seat }

export interface Beat {
  kind: BeatKind;
  /** Who this beat is about (null = the bank / the board / the system). */
  seat: Seat | null;
  /** One short line, already phrased for display ("pays $250 to Mya"). */
  text: string;
  data?: Record<string, unknown>;
  /** Suggested dwell time before the next beat; the client may scale it. */
  holdMs?: number;
}

export type ClockMode = 'off' | 'soft' | 'hard';

/**
 * Server-authoritative turn clock. Generic machinery, so it lives in the
 * engine rather than in any module: every client renders the same hourglass
 * from the same deadline instead of each running its own drifting timer.
 */
export interface TurnClock {
  mode: ClockMode;
  /** ISO instant the current turn began. */
  startedAt: string;
  /** ISO instant the turn expires, or null when mode is 'off'. */
  deadline: string | null;
  /** Seats the clock is currently running against. */
  seats: Seat[];
}

/**
 * Per-game table settings, chosen by the host at creation and frozen into the
 * runtime. `manual` is the big one: it splits atomic moves into the separate
 * physical acts a board demands (walk your own token, hand over your own rent)
 * without giving up server authority — the server still knows the right answer
 * and rejects a wrong one.
 */
export interface GameOptions {
  /** Move your own pieces and confirm your own payments. */
  manual: boolean;
  /** Turn clock: 'soft' shows an hourglass, 'hard' auto-passes on expiry. */
  clock: ClockMode;
  clockSeconds: number;
  /** Replay beats with animation instead of snapping to the new state. */
  animate: boolean;
  /** Playback speed multiplier applied to every beat's holdMs. */
  speed: number;
  /** Tilt the board into 3D and rotate it to the active player's seat. */
  perspective: boolean;
  sound: boolean;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  manual: false,
  clock: 'soft',
  clockSeconds: 90,
  animate: true,
  speed: 1,
  perspective: true,
  sound: true,
};

export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (raw ?? {}) as Partial<GameOptions>;
  const clock: ClockMode =
    o.clock === 'off' || o.clock === 'soft' || o.clock === 'hard' ? o.clock : DEFAULT_GAME_OPTIONS.clock;
  return {
    manual: Boolean(o.manual),
    clock,
    clockSeconds: clampInt(o.clockSeconds, 15, 600, DEFAULT_GAME_OPTIONS.clockSeconds),
    animate: o.animate === undefined ? DEFAULT_GAME_OPTIONS.animate : Boolean(o.animate),
    speed: clampNum(o.speed, 0.25, 4, DEFAULT_GAME_OPTIONS.speed),
    perspective: o.perspective === undefined ? DEFAULT_GAME_OPTIONS.perspective : Boolean(o.perspective),
    sound: o.sound === undefined ? DEFAULT_GAME_OPTIONS.sound : Boolean(o.sound),
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
