import type { Seat, Viewer, DisconnectOption } from '@gamebox/shared-types';
import type { SeededRandom } from './rng.js';

export type { Seat, Viewer };

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

  setup(seats: { seat: Seat; team?: number }[], rng: SeededRandom): GameState<TPublic, TPrivate>;

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
