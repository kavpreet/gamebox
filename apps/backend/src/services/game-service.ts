import type { Kysely } from 'kysely';
import {
  GameRuntime,
  IllegalMove,
  newSeed,
  type GameModule,
  type RuntimeSnapshot,
} from '@gamebox/core-engine';
import {
  isValidSeatColor,
  isValidSeatIcon,
  type GameStatus,
  type Seat,
  type GameSummary,
  type SeatAssignment,
} from '@gamebox/shared-types';
import type { Database, GamesTable } from '../db/schema.js';
import { newId, nowIso } from '../db/index.js';
import { getGame, listGames } from '../games/registry.js';

export class GameServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'BAD_REQUEST',
  ) {
    super(message);
    this.name = 'GameServiceError';
  }
}

/**
 * Owns the in-memory Map<gameId, GameRuntime> (plan §5.3 — one Node process
 * holds every live game) and all game-lifecycle persistence.
 */
export class GameService {
  private runtimes = new Map<string, GameRuntime>();

  constructor(private db: Kysely<Database>) {}

  // ── Game types ────────────────────────────────────────────────────────────

  /** Sync registered modules into game_types; discontinue in-flight games whose rules changed. */
  async syncGameTypes(): Promise<string[]> {
    const discontinuedTypes: string[] = [];
    for (const mod of listGames()) {
      const existing = await this.db
        .selectFrom('game_types')
        .selectAll()
        .where('slug', '=', mod.slug)
        .executeTakeFirst();

      if (!existing) {
        await this.db
          .insertInto('game_types')
          .values({
            slug: mod.slug,
            display_name: mod.displayName,
            rules_version: mod.rulesVersion,
            min_players: mod.minPlayers,
            max_players: mod.maxPlayers,
          })
          .execute();
        continue;
      }

      if (existing.rules_version !== mod.rulesVersion) {
        // Rules changed → discontinue this type's in-flight games (plan §5.3).
        await this.db
          .updateTable('games')
          .set({ status: 'discontinued', join_pin: null, updated_at: nowIso() })
          .where('game_type', '=', mod.slug)
          .where('status', 'in', ['lobby', 'active', 'paused'])
          .execute();
        await this.db
          .updateTable('game_types')
          .set({
            rules_version: mod.rulesVersion,
            display_name: mod.displayName,
            min_players: mod.minPlayers,
            max_players: mod.maxPlayers,
          })
          .where('slug', '=', mod.slug)
          .execute();
        discontinuedTypes.push(mod.slug);
      }
    }
    return discontinuedTypes;
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  async createGame(userId: string, gameType: string): Promise<GameSummary> {
    const mod = this.requireModule(gameType);
    const id = newId();
    const pin = await this.allocatePin();
    const now = nowIso();

    await this.db
      .insertInto('games')
      .values({
        id,
        game_type: mod.slug,
        rules_version: mod.rulesVersion,
        status: 'lobby',
        join_pin: pin,
        version: 0,
        current_state: JSON.stringify(null), // no runtime until start
        final_result: null,
        created_by: userId,
        created_at: now,
        updated_at: now,
        ended_at: null,
      })
      .execute();

    // Creator takes seat 0 automatically.
    await this.addPlayer(id, userId, 0);
    return this.getSummary(id);
  }

  async joinByPin(userId: string, pin: string): Promise<GameSummary> {
    const game = await this.db
      .selectFrom('games')
      .selectAll()
      .where('join_pin', '=', pin)
      .executeTakeFirst();
    if (!game) throw new GameServiceError('No game with that PIN', 'NOT_FOUND');

    const players = await this.playersOf(game.id);
    const existing = players.find((p) => p.user_id === userId);
    if (existing) {
      if (existing.eliminated_at) {
        throw new GameServiceError('You were removed from this game', 'FORBIDDEN');
      }
      return this.getSummary(game.id); // device switch / rejoin — always allowed
    }

    if (game.status !== 'lobby') {
      throw new GameServiceError('Game already started', 'CONFLICT');
    }
    const mod = this.requireModule(game.game_type);
    if (players.length >= mod.maxPlayers) {
      throw new GameServiceError('Game is full', 'CONFLICT');
    }
    const nextSeat = players.length === 0 ? 0 : Math.max(...players.map((p) => p.seat_index)) + 1;
    await this.addPlayer(game.id, userId, nextSeat);
    return this.getSummary(game.id);
  }

  async setTeams(gameId: string, userId: string, teams: Record<string, number | null>): Promise<GameSummary> {
    const game = await this.requireGame(gameId);
    if (game.created_by !== userId) throw new GameServiceError('Only the host can configure teams', 'FORBIDDEN');
    if (game.status !== 'lobby') throw new GameServiceError('Game already started', 'CONFLICT');
    for (const [seatStr, team] of Object.entries(teams)) {
      await this.db
        .updateTable('game_players')
        .set({ team_index: team })
        .where('game_id', '=', gameId)
        .where('seat_index', '=', Number(seatStr))
        .execute();
    }
    return this.getSummary(gameId);
  }

  /**
   * Each player picks their own look. Rules (enforced here, not just in the
   * UI, since the UI can't be trusted): every non-transparent color must be
   * unique among this game's seats; every non-null icon must be unique;
   * a plain-color (no icon) player may not be transparent — the board would
   * render an invisible piece.
   */
  async setAppearance(
    gameId: string,
    userId: string,
    color: string | null,
    icon: string | null,
  ): Promise<GameSummary> {
    const game = await this.requireGame(gameId);
    if (game.status !== 'lobby') throw new GameServiceError('Can only customize before the game starts', 'CONFLICT');
    if (color !== null && !isValidSeatColor(color)) throw new GameServiceError('Unknown color', 'BAD_REQUEST');
    if (icon !== null && !isValidSeatIcon(icon)) throw new GameServiceError('Unknown icon', 'BAD_REQUEST');
    if (color === 'transparent' && icon === null) {
      throw new GameServiceError('Pick an icon to use a transparent background', 'BAD_REQUEST');
    }

    const players = await this.playersOf(gameId);
    const me = players.find((p) => p.user_id === userId);
    if (!me) throw new GameServiceError('You are not in this game', 'FORBIDDEN');

    if (color !== null && color !== 'transparent') {
      const clash = players.some((p) => p.seat_index !== me.seat_index && p.color === color);
      if (clash) throw new GameServiceError('Another player already has that color', 'CONFLICT');
    }
    if (icon !== null) {
      const clash = players.some((p) => p.seat_index !== me.seat_index && p.icon === icon);
      if (clash) throw new GameServiceError('Another player already has that icon', 'CONFLICT');
    }

    await this.db
      .updateTable('game_players')
      .set({ color, icon })
      .where('game_id', '=', gameId)
      .where('seat_index', '=', me.seat_index)
      .execute();
    return this.getSummary(gameId);
  }

  async startGame(gameId: string, userId: string): Promise<GameRuntime> {
    const game = await this.requireGame(gameId);
    if (game.created_by !== userId) throw new GameServiceError('Only the host can start the game', 'FORBIDDEN');
    if (game.status !== 'lobby') throw new GameServiceError('Game already started', 'CONFLICT');

    const mod = this.requireModule(game.game_type);
    const players = (await this.playersOf(gameId)).filter((p) => p.role === 'player');
    if (players.length < mod.minPlayers) {
      throw new GameServiceError(`Need at least ${mod.minPlayers} players`, 'CONFLICT');
    }
    if (mod.teams === 'required' && players.some((p) => p.team_index === null)) {
      throw new GameServiceError('All players must be assigned a team', 'CONFLICT');
    }

    const seats = players
      .sort((a, b) => a.seat_index - b.seat_index)
      .map((p) => ({ seat: p.seat_index, team: p.team_index ?? undefined }));

    const runtime = GameRuntime.start(mod, seats, newSeed());
    this.runtimes.set(gameId, runtime);
    await this.persist(gameId, runtime, { status: 'active' });
    return runtime;
  }

  async abandonGame(gameId: string, userId: string): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.created_by !== userId) throw new GameServiceError('Only the host can abandon the game', 'FORBIDDEN');
    if (['completed', 'abandoned', 'discontinued'].includes(game.status)) return;
    this.runtimes.delete(gameId);
    await this.db
      .updateTable('games')
      .set({ status: 'abandoned', join_pin: null, updated_at: nowIso(), ended_at: nowIso() })
      .where('id', '=', gameId)
      .execute();
  }

  // ── Runtime access / rehydration ──────────────────────────────────────────

  async getRuntime(gameId: string): Promise<GameRuntime | null> {
    const cached = this.runtimes.get(gameId);
    if (cached) return cached;

    const game = await this.requireGame(gameId);
    // Completed games rehydrate too (read-only): reconnecting viewers still
    // get the final board; the runtime itself rejects further moves.
    if (!['active', 'paused', 'completed'].includes(game.status)) return null;

    const mod = this.requireModule(game.game_type);
    const snapshot = JSON.parse(game.current_state) as RuntimeSnapshot | null;
    if (!snapshot) return null;
    const runtime = new GameRuntime(mod, snapshot);
    this.runtimes.set(gameId, runtime);
    return runtime;
  }

  // ── Moves ─────────────────────────────────────────────────────────────────

  async applyMove(
    gameId: string,
    userId: string,
    type: string,
    payload: unknown,
  ): Promise<{ runtime: GameRuntime; seat: Seat }> {
    const runtime = await this.getRuntime(gameId);
    if (!runtime) throw new GameServiceError('Game is not active', 'CONFLICT');

    const seat = await this.seatOf(gameId, userId);
    if (seat === null) throw new GameServiceError('You are not in this game', 'FORBIDDEN');

    const result = runtime.applyMove(seat, type, payload); // throws IllegalMove
    await this.recordMove(gameId, result.seq, userId, type, payload);
    await this.persist(gameId, runtime, {
      status: result.status,
      finalResult: result.result,
    });
    return { runtime, seat };
  }

  /** System mutation: kick a seat after a vote resolves. */
  async kickSeat(gameId: string, seat: Seat): Promise<GameRuntime> {
    const runtime = await this.getRuntime(gameId);
    if (!runtime) throw new GameServiceError('Game is not active', 'CONFLICT');
    const result = runtime.removePlayer(seat);
    await this.db
      .updateTable('game_players')
      .set({ eliminated_at: nowIso() })
      .where('game_id', '=', gameId)
      .where('seat_index', '=', seat)
      .execute();
    await this.recordMove(gameId, result.seq, null, 'SYSTEM_KICK', { seat });
    await this.persist(gameId, runtime, { status: result.status, finalResult: result.result });
    return runtime;
  }

  /** System mutation: auto-pass a disconnected seat's turn (skip-vote outcome). */
  async skipSeat(gameId: string, seat: Seat): Promise<GameRuntime> {
    const runtime = await this.getRuntime(gameId);
    if (!runtime) throw new GameServiceError('Game is not active', 'CONFLICT');
    const result = runtime.skipSeat(seat);
    await this.recordMove(gameId, result.seq, null, 'SYSTEM_SKIP', { seat });
    await this.persist(gameId, runtime, { status: result.status, finalResult: result.result });
    return runtime;
  }

  async pauseGame(gameId: string): Promise<GameRuntime | null> {
    const runtime = await this.getRuntime(gameId);
    if (!runtime) return null;
    runtime.pause();
    await this.persist(gameId, runtime, { status: 'paused', skipVersionCheck: true });
    return runtime;
  }

  async resumeGame(gameId: string): Promise<GameRuntime | null> {
    const game = await this.requireGame(gameId);
    if (game.status !== 'paused') return this.getRuntime(gameId);
    const mod = this.requireModule(game.game_type);
    const snapshot = JSON.parse(game.current_state) as RuntimeSnapshot;
    snapshot.status = 'active';
    const runtime = this.runtimes.get(gameId) ?? new GameRuntime(mod, snapshot);
    runtime.resume();
    this.runtimes.set(gameId, runtime);
    await this.persist(gameId, runtime, { status: 'active', skipVersionCheck: true });
    return runtime;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  async getSummary(gameId: string): Promise<GameSummary> {
    const game = await this.requireGame(gameId);
    const players = await this.db
      .selectFrom('game_players')
      .leftJoin('user', 'user.id', 'game_players.user_id')
      .select([
        'game_players.seat_index',
        'game_players.user_id',
        'game_players.team_index',
        'game_players.connected',
        'game_players.eliminated_at',
        'game_players.color',
        'game_players.icon',
        'user.name as display_name',
      ])
      .where('game_players.game_id', '=', gameId)
      .orderBy('game_players.seat_index')
      .execute();

    const seatAssignments: SeatAssignment[] = players.map((p) => ({
      seat: p.seat_index,
      userId: p.user_id,
      displayName: p.display_name ?? 'Player',
      team: p.team_index,
      connected: Boolean(p.connected),
      eliminated: Boolean(p.eliminated_at),
      color: p.color,
      icon: p.icon,
    }));

    return {
      id: game.id,
      gameType: game.game_type,
      status: game.status as GameStatus,
      joinPin: game.join_pin,
      createdBy: game.created_by,
      createdAt: game.created_at,
      updatedAt: game.updated_at,
      players: seatAssignments,
    };
  }

  async myGames(userId: string): Promise<GameSummary[]> {
    const rows = await this.db
      .selectFrom('game_players')
      .innerJoin('games', 'games.id', 'game_players.game_id')
      .select('games.id as id')
      .where('game_players.user_id', '=', userId)
      .where('games.status', 'in', ['lobby', 'active', 'paused', 'completed'])
      .orderBy('games.updated_at', 'desc')
      .limit(50)
      .execute();
    return Promise.all(rows.map((r) => this.getSummary(r.id)));
  }

  async seatOf(gameId: string, userId: string): Promise<Seat | null> {
    const row = await this.db
      .selectFrom('game_players')
      .select(['seat_index', 'eliminated_at'])
      .where('game_id', '=', gameId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row || row.eliminated_at) return null;
    return row.seat_index;
  }

  async setConnected(gameId: string, userId: string, connected: boolean): Promise<void> {
    await this.db
      .updateTable('game_players')
      .set({ connected: connected ? 1 : 0, last_seen_at: nowIso() })
      .where('game_id', '=', gameId)
      .where('user_id', '=', userId)
      .execute();
  }

  async playersOf(gameId: string) {
    return this.db
      .selectFrom('game_players')
      .selectAll()
      .where('game_id', '=', gameId)
      .orderBy('seat_index')
      .execute();
  }

  // ── Retention (plan §5.3) ─────────────────────────────────────────────────

  async purgeStaleGames(purgeAfterDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - purgeAfterDays * 24 * 60 * 60 * 1000).toISOString();
    const stale = await this.db
      .selectFrom('games')
      .select('id')
      .where((eb) =>
        eb.or([
          eb.and([
            eb('status', 'in', ['lobby', 'active', 'paused']),
            eb('updated_at', '<', cutoff),
          ]),
          eb('status', '=', 'discontinued'), // purged immediately
        ]),
      )
      .execute();

    for (const { id } of stale) {
      this.runtimes.delete(id);
      await this.db.deleteFrom('moves').where('game_id', '=', id).execute();
      await this.db
        .updateTable('games')
        .set({
          status: 'abandoned',
          join_pin: null,
          current_state: JSON.stringify({ purged: true }),
          updated_at: nowIso(),
          ended_at: nowIso(),
        })
        .where('id', '=', id)
        .execute();
    }
    return stale.length;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private requireModule(slug: string): GameModule<any, any, any> {
    const mod = getGame(slug);
    if (!mod) throw new GameServiceError(`Unknown game type: ${slug}`, 'NOT_FOUND');
    return mod;
  }

  async requireGame(gameId: string): Promise<GamesTable> {
    const game = await this.db
      .selectFrom('games')
      .selectAll()
      .where('id', '=', gameId)
      .executeTakeFirst();
    if (!game) throw new GameServiceError('Game not found', 'NOT_FOUND');
    return game;
  }

  private async addPlayer(gameId: string, userId: string, seat: Seat): Promise<void> {
    await this.db
      .insertInto('game_players')
      .values({
        id: newId(),
        game_id: gameId,
        user_id: userId,
        seat_index: seat,
        team_index: null,
        role: 'player',
        connected: 0,
        eliminated_at: null,
        last_seen_at: nowIso(),
        color: null,
        icon: null,
      })
      .execute();
  }

  private async recordMove(
    gameId: string,
    seq: number,
    playerId: string | null,
    type: string,
    payload: unknown,
  ): Promise<void> {
    await this.db
      .insertInto('moves')
      .values({
        id: newId(),
        game_id: gameId,
        seq,
        player_id: playerId,
        type,
        payload: JSON.stringify(payload ?? null),
        created_at: nowIso(),
      })
      .execute();
  }

  private async persist(
    gameId: string,
    runtime: GameRuntime,
    opts: { status: GameStatus; finalResult?: unknown; skipVersionCheck?: boolean },
  ): Promise<void> {
    const snapshot = runtime.snapshot();
    const ended = ['completed', 'abandoned', 'discontinued'].includes(opts.status);
    const query = this.db
      .updateTable('games')
      .set({
        status: opts.status,
        version: snapshot.seq,
        current_state: JSON.stringify(snapshot),
        updated_at: nowIso(),
        ...(opts.finalResult ? { final_result: JSON.stringify(opts.finalResult) } : {}),
        ...(ended ? { ended_at: nowIso(), join_pin: null } : {}),
      })
      .where('id', '=', gameId);

    if (!opts.skipVersionCheck && snapshot.seq > 0) {
      // Optimistic concurrency (plan §5.3): the previous persisted version must
      // be exactly seq-1, otherwise another writer got there first.
      const result = await query.where('version', '=', snapshot.seq - 1).executeTakeFirst();
      if (result.numUpdatedRows === 0n) {
        throw new GameServiceError('Concurrent update detected — refetch state', 'CONFLICT');
      }
    } else {
      await query.execute();
    }

    // Keep completed runtimes cached briefly so the final broadcast (and late
    // reconnects) still render the end state; evict after a grace window.
    if (ended) {
      setTimeout(() => this.runtimes.delete(gameId), 10 * 60 * 1000).unref?.();
    }
  }

  private async allocatePin(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const clash = await this.db
        .selectFrom('games')
        .select('id')
        .where('join_pin', '=', pin)
        .executeTakeFirst();
      if (!clash) return pin;
    }
    throw new GameServiceError('Could not allocate a join PIN', 'INTERNAL');
  }
}

export { IllegalMove };
