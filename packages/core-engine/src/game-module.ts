import type {
  Seat,
  Viewer,
  DisconnectOption,
  Beat,
  BeatKind,
  GameOptionDef,
  GameOptions,
  TableOptions,
} from '@gamebox/shared-types';
import { DEFAULT_TABLE_OPTIONS } from '@gamebox/shared-types';
import type { SeededRandom } from './rng.js';

export type { Seat, Viewer, Beat, BeatKind, GameOptionDef, GameOptions, TableOptions };
export { DEFAULT_TABLE_OPTIONS };

/**
 * Records the ordered steps inside one move so the client can replay them with
 * pacing. Modules call `emit` where they used to overwrite a single
 * `lastEvent` string — a module that never calls it still plays a correct
 * game, it just tells no story.
 */
export type EmitBeat = (beat: Beat) => void;

export interface GameState<TPublic, TPrivate> {
  public: TPublic;
  private: Record<Seat, TPrivate>;
}

export interface EndResult {
  winners?: Seat[];
  winningTeam?: number;
  cooperativeLoss?: boolean;
}

export interface MoveCtx<TPublic, TPrivate, TMove> {
  state: GameState<TPublic, TPrivate>;
  seat: Seat;
  payload: TMove;
  rng: SeededRandom;
  /** Narrate this move step by step. Presentation only — never rules. */
  emit: EmitBeat;
  /**
   * How the table is played — manual pieces, clock, pacing. Never rules.
   *
   * The house rules deliberately aren't here: setup() receives them and a
   * module that needs them later stashes them in its own public state, so the
   * engine never has to hold game-specific rule values.
   */
  table: TableOptions;
}

export class IllegalMove extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMove';
  }
}

/**
 * The one interface every game plugin implements. The core engine never contains
 * game-specific rules — only generic machinery: connections, rooms, turn
 * bookkeeping, persistence, and view redaction. See dream/gamebox-plan.md §4.1.
 */
export interface GameModule<TPublic = unknown, TPrivate = unknown, TMove = unknown> {
  slug: string;
  displayName: string;
  /** One-liner shown on the TV lobby and pickers. */
  description?: string;
  rulesVersion: string;
  minPlayers: number;
  maxPlayers: number;
  teams?: 'none' | 'optional' | 'required';

  /**
   * Alternate ("house") rules this module supports, declared as data so the
   * lobby can render pickers and the server can validate choices without
   * knowing anything about the game. The chosen values reach setup(); modules
   * that need them later stash them in their own public state.
   */
  options?: readonly GameOptionDef[];

  /**
   * Manual-mode support: true when this module splits its atomic moves into
   * separate player-confirmed physical acts (walk the token, hand over the
   * rent). The lobby only offers the manual toggle for modules that say yes.
   */
  supportsManual?: boolean;

  setup(
    seats: { seat: Seat; team?: number }[],
    rng: SeededRandom,
    options: GameOptions,
    table?: TableOptions,
  ): GameState<TPublic, TPrivate>;

  /** Who may act right now — derived from state on every call, never a static flag. */
  activePlayers(state: GameState<TPublic, TPrivate>): Seat[];

  moves: Record<string, (ctx: MoveCtx<TPublic, TPrivate, TMove>) => void>;

  /** Powers legal-move highlighting on the phone UI. Optional but strongly recommended. */
  legalMoves?(state: GameState<TPublic, TPrivate>, seat: Seat): TMove[];

  endIf(state: GameState<TPublic, TPrivate>): EndResult | null;

  /** The one function that makes TV-vs-player and hidden-hand work automatically. */
  view(state: GameState<TPublic, TPrivate>, viewer: Viewer): unknown;

  disconnectOptions?(state: GameState<TPublic, TPrivate>): DisconnectOption[];

  onPlayerRemoved?(state: GameState<TPublic, TPrivate>, seat: Seat): void;

  /**
   * Auto-pass this seat's turn (the 'skip' disconnect-vote outcome). A module
   * that cannot legally pass a turn (chess) omits this — and must then also
   * exclude 'skip' from disconnectOptions.
   */
  onPlayerSkipped?(state: GameState<TPublic, TPrivate>, seat: Seat): void;
}

export interface GameModuleRegistration {
  module: GameModule<any, any, any>;
}

const registry = new Map<string, GameModule<any, any, any>>();

export function registerGame(module: GameModule<any, any, any>): void {
  registry.set(module.slug, module);
}

export function getGame(slug: string): GameModule<any, any, any> | undefined {
  return registry.get(slug);
}

export function listGames(): GameModule<any, any, any>[] {
  return Array.from(registry.values());
}
