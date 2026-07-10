import type { Seat, Viewer, GameStatus, DisconnectOption } from '@gamebox/shared-types';
import type { GameModule, GameState, EndResult } from './game-module.js';
import { IllegalMove } from './game-module.js';
import { createSeededRandom, type SeededRandom } from './rng.js';

export interface MoveRecord {
  seq: number;
  seat: Seat | null; // null for system events (vote resolution, auto-skip)
  type: string;
  payload: unknown;
}

/**
 * Serializable snapshot of a running game — everything needed to rehydrate a
 * GameRuntime after a server restart. Maps onto games.current_state +
 * game_players.private_state + the rng state in the DB layer.
 */
export interface RuntimeSnapshot {
  state: GameState<unknown, unknown>;
  rngState: number;
  seq: number;
  status: GameStatus;
  activeSeats: Seat[];
  result: EndResult | null;
  removedSeats: Seat[];
}

export interface ApplyMoveResult {
  seq: number;
  status: GameStatus;
  activeSeats: Seat[];
  result: EndResult | null;
}

/**
 * In-memory runtime for one game instance. A single Node process holds a
 * Map<gameId, GameRuntime> (plan §5.3 — no Redis at this scale); persistence
 * is the caller's job via snapshot().
 */
export class GameRuntime {
  private state: GameState<unknown, unknown>;
  private rng: SeededRandom;
  private seq: number;
  private status: GameStatus;
  private result: EndResult | null;
  private removedSeats: Set<Seat>;

  constructor(
    public readonly module: GameModule<any, any, any>,
    snapshot: RuntimeSnapshot,
  ) {
    this.state = snapshot.state;
    this.rng = createSeededRandom(snapshot.rngState);
    this.seq = snapshot.seq;
    this.status = snapshot.status;
    this.result = snapshot.result;
    this.removedSeats = new Set(snapshot.removedSeats);
  }

  static start(
    module: GameModule<any, any, any>,
    seats: { seat: Seat; team?: number }[],
    seed: number,
  ): GameRuntime {
    const rng = createSeededRandom(seed);
    const state = module.setup(seats, rng);
    return new GameRuntime(module, {
      state,
      rngState: rng.getState(),
      seq: 0,
      status: 'active',
      activeSeats: module.activePlayers(state),
      result: null,
      removedSeats: [],
    });
  }

  get currentSeq(): number {
    return this.seq;
  }

  get currentStatus(): GameStatus {
    return this.status;
  }

  get endResult(): EndResult | null {
    return this.result;
  }

  activeSeats(): Seat[] {
    if (this.status !== 'active') return [];
    return this.module
      .activePlayers(this.state)
      .filter((s) => !this.removedSeats.has(s));
  }

  isRemoved(seat: Seat): boolean {
    return this.removedSeats.has(seat);
  }

  pause(): void {
    if (this.status === 'active') this.status = 'paused';
  }

  resume(): void {
    if (this.status === 'paused') this.status = 'active';
  }

  disconnectOptions(): DisconnectOption[] {
    return this.module.disconnectOptions?.(this.state) ?? ['skip', 'pause', 'kick'];
  }

  /**
   * Validate-and-apply a player move. Throws IllegalMove to reject; on success
   * increments seq and re-derives active seats + end condition.
   */
  applyMove(seat: Seat, type: string, payload: unknown): ApplyMoveResult {
    if (this.status !== 'active') {
      throw new IllegalMove(`Game is ${this.status}, not accepting moves`);
    }
    if (this.removedSeats.has(seat)) {
      throw new IllegalMove('This seat has been removed from the game');
    }
    if (!this.activeSeats().includes(seat)) {
      throw new IllegalMove('Not your turn');
    }
    const moveFn = this.module.moves[type];
    if (!moveFn) {
      throw new IllegalMove(`Unknown move type: ${type}`);
    }
    moveFn({ state: this.state, seat, payload, rng: this.rng });
    return this.afterMutation();
  }

  /**
   * System-driven mutation (kick resolution, auto-skip). seat=null in the move log.
   */
  removePlayer(seat: Seat): ApplyMoveResult {
    this.removedSeats.add(seat);
    this.module.onPlayerRemoved?.(this.state, seat);
    return this.afterMutation();
  }

  private afterMutation(): ApplyMoveResult {
    this.seq += 1;
    const end = this.module.endIf(this.state);
    if (end) {
      this.status = 'completed';
      this.result = end;
    }
    return {
      seq: this.seq,
      status: this.status,
      activeSeats: this.activeSeats(),
      result: this.result,
    };
  }

  legalMoves(seat: Seat): unknown[] {
    if (this.status !== 'active' || this.removedSeats.has(seat)) return [];
    return this.module.legalMoves?.(this.state, seat) ?? [];
  }

  /** Per-viewer projection — the mechanism behind TV-vs-player views (plan §2). */
  view(viewer: Viewer): unknown {
    return this.module.view(this.state, viewer);
  }

  snapshot(): RuntimeSnapshot {
    return {
      state: this.state,
      rngState: this.rng.getState(),
      seq: this.seq,
      status: this.status,
      activeSeats: this.activeSeats(),
      result: this.result,
      removedSeats: Array.from(this.removedSeats),
    };
  }
}
