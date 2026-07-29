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
