import type {
  Seat,
  Viewer,
  GameStatus,
  DisconnectOption,
  Beat,
  GameOptions,
  TurnClock,
} from '@gamebox/shared-types';
import { DEFAULT_GAME_OPTIONS, normalizeGameOptions } from '@gamebox/shared-types';
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
  /** Table settings frozen at start. Absent in snapshots written before options existed. */
  options?: GameOptions;
  /** ISO instant the current turn began — the anchor for the turn clock. */
  turnStartedAt?: string;
  /** Seats the clock is running against; a change here restarts the clock. */
  clockSeats?: Seat[];
}

export interface ApplyMoveResult {
  seq: number;
  status: GameStatus;
  activeSeats: Seat[];
  result: EndResult | null;
  /** Ordered narration for this mutation, for the client to replay. */
  beats: Beat[];
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
  private options: GameOptions;
  private turnStartedAt: string;
  private clockSeats: Seat[];
  /** Beats emitted by the most recent mutation, handed to clients once. */
  private beats: Beat[] = [];
  /**
   * The state as it was before the last player move, for a take-back.
   *
   * One step only. Deeper history would need the whole move log replayed from
   * the seed to stay honest about the RNG, and one step is what a table
   * actually allows — you can take back the move you just made, not the game.
   * Held in memory rather than persisted: a take-back is a live, social act,
   * and after a server restart there is nobody mid-protest.
   */
  private undoPoint: { snapshot: RuntimeSnapshot; seat: Seat; type: string } | null = null;

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
    this.options = normalizeGameOptions(snapshot.options);
    this.turnStartedAt = snapshot.turnStartedAt ?? new Date().toISOString();
    this.clockSeats = snapshot.clockSeats ?? snapshot.activeSeats;
  }

  static start(
    module: GameModule<any, any, any>,
    seats: { seat: Seat; team?: number }[],
    seed: number,
    options?: Partial<GameOptions>,
  ): GameRuntime {
    const rng = createSeededRandom(seed);
    const opts = normalizeGameOptions({ ...DEFAULT_GAME_OPTIONS, ...(options ?? {}) });
    // A module that hasn't implemented the split moves can't honour manual
    // mode; running it manually anyway would strand players waiting for a
    // button that never appears.
    if (!module.supportsManual) opts.manual = false;
    const state = module.setup(seats, rng, opts);
    const activeSeats = module.activePlayers(state);
    return new GameRuntime(module, {
      state,
      rngState: rng.getState(),
      seq: 0,
      status: 'active',
      activeSeats,
      result: null,
      removedSeats: [],
      options: opts,
      turnStartedAt: new Date().toISOString(),
      clockSeats: activeSeats,
    });
  }

  get gameOptions(): GameOptions {
    return this.options;
  }

  /** Narration from the most recent mutation; reading it clears it. */
  takeBeats(): Beat[] {
    const b = this.beats;
    this.beats = [];
    return b;
  }

  /**
   * The turn clock is generic machinery, so it lives here rather than in any
   * module: it restarts whenever the set of seats that may act changes, which
   * means a player handed the turn always gets the full allowance and a player
   * partway through a multi-step manual turn is not punished for it.
   */
  clock(): TurnClock | null {
    if (this.status !== 'active') return null;
    const seats = this.activeSeats();
    const deadline =
      this.options.clock === 'off'
        ? null
        : new Date(Date.parse(this.turnStartedAt) + this.options.clockSeconds * 1000).toISOString();
    return { mode: this.options.clock, startedAt: this.turnStartedAt, deadline, seats };
  }

  /** Seats whose allowance has run out — hard-mode enforcement only. */
  expiredSeats(now = Date.now()): Seat[] {
    const c = this.clock();
    if (!c || c.mode !== 'hard' || !c.deadline) return [];
    return Date.parse(c.deadline) <= now ? c.seats : [];
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
    // Capture before mutating: the snapshot has to predate the move it undoes.
    // structuredClone keeps the restored state from aliasing the live one,
    // which would make the "undo" silently share objects with the new state.
    this.undoPoint = { snapshot: structuredClone(this.snapshot()), seat, type };
    const beats: Beat[] = [];
    moveFn({
      state: this.state,
      seat,
      payload,
      rng: this.rng,
      emit: (b) => beats.push(b),
      options: this.options,
    });
    return this.afterMutation(beats);
  }

  /**
   * Auto-pass a seat's turn (skip-vote outcome). Only valid if the module
   * implements onPlayerSkipped.
   */
  skipSeat(seat: Seat): ApplyMoveResult {
    if (!this.module.onPlayerSkipped) {
      throw new IllegalMove('This game cannot skip turns');
    }
    this.module.onPlayerSkipped(this.state, seat);
    return this.afterMutation([
      { kind: 'turn', seat, text: 'turn skipped — disconnected', holdMs: 900 },
    ]);
  }

  /**
   * System-driven mutation (kick resolution, auto-skip). seat=null in the move log.
   */
  removePlayer(seat: Seat): ApplyMoveResult {
    this.removedSeats.add(seat);
    this.module.onPlayerRemoved?.(this.state, seat);
    return this.afterMutation([
      { kind: 'turn', seat, text: 'left the table', holdMs: 900 },
    ]);
  }

  private afterMutation(beats: Beat[] = []): ApplyMoveResult {
    this.seq += 1;
    const end = this.module.endIf(this.state);
    if (end) {
      this.status = 'completed';
      this.result = end;
    }
    const activeSeats = this.activeSeats();
    // Restart the clock only when the baton actually changed hands, so one
    // multi-step manual turn (roll → walk → pay) runs on a single allowance.
    if (!sameSeats(activeSeats, this.clockSeats)) {
      this.clockSeats = activeSeats;
      this.turnStartedAt = new Date().toISOString();
    }
    this.beats = beats;
    return {
      seq: this.seq,
      status: this.status,
      activeSeats,
      result: this.result,
      beats,
    };
  }

  /** What a take-back would unwind, or null when there is nothing to take back. */
  undoable(): { seat: Seat; type: string; toSeq: number } | null {
    if (this.status !== 'active' || !this.undoPoint) return null;
    return {
      seat: this.undoPoint.seat,
      type: this.undoPoint.type,
      toSeq: this.undoPoint.snapshot.seq,
    };
  }

  /**
   * Roll back the last player move. Restores the RNG position too, so a
   * re-rolled die is genuinely re-rolled rather than replaying the same value
   * — otherwise a take-back would be a way to peek at the next roll.
   */
  undoLastMove(): ApplyMoveResult | null {
    const point = this.undoPoint;
    if (!point || this.status !== 'active') return null;
    this.undoPoint = null;
    const snap = point.snapshot;
    this.state = snap.state;
    this.rng = createSeededRandom(snap.rngState);
    this.seq = snap.seq;
    this.status = snap.status;
    this.result = snap.result;
    this.removedSeats = new Set(snap.removedSeats);
    this.turnStartedAt = new Date().toISOString();
    this.clockSeats = this.activeSeats();
    const beats: Beat[] = [
      { kind: 'turn', seat: point.seat, text: 'takes the move back', holdMs: 1600 },
    ];
    this.beats = beats;
    return {
      seq: this.seq,
      status: this.status,
      activeSeats: this.activeSeats(),
      result: this.result,
      beats,
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
      options: this.options,
      turnStartedAt: this.turnStartedAt,
      clockSeats: this.clockSeats,
    };
  }
}

function sameSeats(a: Seat[], b: Seat[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((s) => bs.has(s));
}
