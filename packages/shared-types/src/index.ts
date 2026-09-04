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
  /** Resolved house rules for this match (every option id the module declares). */
  options: GameOptions;
}

// ── House rules (alternate/variant rules picked in the lobby) ───────────────

/**
 * Every table plays a little differently — out on a 1 in Ludo, stacking +2s in
 * UNO, cash on Free Parking. Modules declare the variants they support as data;
 * the lobby renders that declaration into controls, the server validates
 * against it, and setup() receives the resolved values. Nothing about a
 * specific game leaks into the engine or the lobby UI.
 */
export type GameOptionValue = boolean | string | number;
export type GameOptions = Record<string, GameOptionValue>;

interface GameOptionBase {
  id: string;
  label: string;
  /** One-line explanation shown under the control. */
  description?: string;
}

export interface ToggleOptionDef extends GameOptionBase {
  kind: 'toggle';
  default: boolean;
}

export interface ChoiceOptionDef extends GameOptionBase {
  kind: 'choice';
  default: string;
  choices: readonly { value: string; label: string; description?: string }[];
}

export interface NumberOptionDef extends GameOptionBase {
  kind: 'number';
  default: number;
  min: number;
  max: number;
  step?: number;
  /** e.g. '$' — cosmetic only. */
  prefix?: string;
}

export type GameOptionDef = ToggleOptionDef | ChoiceOptionDef | NumberOptionDef;

/** Validate one value against its definition. Returns null when unusable. */
export function coerceOptionValue(def: GameOptionDef, raw: unknown): GameOptionValue | null {
  if (def.kind === 'toggle') {
    return typeof raw === 'boolean' ? raw : null;
  }
  if (def.kind === 'choice') {
    return typeof raw === 'string' && def.choices.some((c) => c.value === raw) ? raw : null;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const step = def.step ?? 1;
  const snapped = def.min + Math.round((raw - def.min) / step) * step;
  const clamped = Math.min(def.max, Math.max(def.min, snapped));
  return Number(clamped.toFixed(6));
}

export function defaultGameOptions(defs: readonly GameOptionDef[]): GameOptions {
  const out: GameOptions = {};
  for (const def of defs) out[def.id] = def.default;
  return out;
}

/** Fill in defaults, drop unknown ids, repair invalid values. Always complete. */
export function resolveGameOptions(
  defs: readonly GameOptionDef[],
  raw: unknown,
): GameOptions {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: GameOptions = {};
  for (const def of defs) {
    const value = coerceOptionValue(def, stored[def.id]);
    out[def.id] = value === null ? def.default : value;
  }
  return out;
}

/** Human-readable summary of everything that differs from the standard rules. */
export function describeNonDefaultOptions(
  defs: readonly GameOptionDef[],
  options: GameOptions,
): string[] {
  const out: string[] = [];
  for (const def of defs) {
    const value = options[def.id];
    if (value === undefined || value === def.default) continue;
    if (def.kind === 'toggle') {
      out.push(value ? def.label : `No ${def.label.toLowerCase()}`);
    } else if (def.kind === 'choice') {
      const choice = def.choices.find((c) => c.value === value);
      out.push(`${def.label}: ${choice?.label ?? value}`);
    } else {
      out.push(`${def.label}: ${def.prefix ?? ''}${value}`);
    }
  }
  return out;
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

/** The first 6 palette entries double as the default (uncustomized) seat colors. */
export function defaultSeatColor(seat: number): string {
  return SEAT_COLOR_PALETTE[seat % 6]!;
}

export function isValidSeatColor(c: string): boolean {
  return (SEAT_COLOR_PALETTE as readonly string[]).includes(c);
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
  /**
   * Narration for the move that produced THIS update, in order. Present only
   * on the broadcast that follows a mutation — a re-broadcast to a client that
   * just joined carries none, so nobody replays a story they already missed.
   */
  beats?: Beat[];
  clock?: TurnClock | null;
  /**
   * How this table is being *played* — pacing, manual pieces, 3D, sound.
   * Distinct from `GameSummary.options`, which is the house rules: what the
   * game is, versus how it feels to sit at.
   */
  table?: TableOptions;
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

// ─── Table feel: beats, turn clock, table settings ────────────────────────

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
 * Table settings — how a match is *played*, as opposed to what its rules are.
 *
 * Deliberately separate from the house rules in `GameOptions` above: those are
 * declared per-module as data and change the game, these are the same handful
 * of controls for every game and change only its pacing and presentation.
 *
 * `manual` is the big one: it splits atomic moves into the separate
 * physical acts a board demands (walk your own token, hand over your own rent)
 * without giving up server authority — the server still knows the right answer
 * and rejects a wrong one.
 */
export interface TableOptions {
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

export const DEFAULT_TABLE_OPTIONS: TableOptions = {
  manual: false,
  clock: 'soft',
  clockSeconds: 90,
  animate: true,
  speed: 1,
  perspective: true,
  sound: true,
};

export function normalizeTableOptions(raw: unknown): TableOptions {
  const o = (raw ?? {}) as Partial<TableOptions>;
  const clock: ClockMode =
    o.clock === 'off' || o.clock === 'soft' || o.clock === 'hard' ? o.clock : DEFAULT_TABLE_OPTIONS.clock;
  return {
    manual: Boolean(o.manual),
    clock,
    clockSeconds: clampInt(o.clockSeconds, 15, 600, DEFAULT_TABLE_OPTIONS.clockSeconds),
    animate: o.animate === undefined ? DEFAULT_TABLE_OPTIONS.animate : Boolean(o.animate),
    speed: clampNum(o.speed, 0.25, 4, DEFAULT_TABLE_OPTIONS.speed),
    perspective: o.perspective === undefined ? DEFAULT_TABLE_OPTIONS.perspective : Boolean(o.perspective),
    sound: o.sound === undefined ? DEFAULT_TABLE_OPTIONS.sound : Boolean(o.sound),
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
