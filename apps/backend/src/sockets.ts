import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import {
  createVote,
  castVote,
  IllegalMove,
  type DisconnectVote,
  type GameRuntime,
} from '@gamebox/core-engine';
import type { Seat, DisconnectOption } from '@gamebox/shared-types';
import type { AuthInstance } from './auth.js';
import { GameService, GameServiceError } from './services/game-service.js';
import { RoomService } from './services/room-service.js';
import { config } from './config.js';

interface SocketData {
  userId: string | null;
  displayName: string | null;
  /** gameIds this socket has joined as a seated player, mapped to seat. */
  seats: Map<string, Seat>;
}

interface GamePresence {
  /** seat → count of live sockets for that seat */
  connections: Map<Seat, number>;
  graceTimers: Map<Seat, ReturnType<typeof setTimeout>>;
  vote: DisconnectVote | null;
  /** seats being auto-skipped until they reconnect */
  skipping: Set<Seat>;
}

const playerRoom = (gameId: string, seat: Seat) => `game:${gameId}:seat:${seat}`;
const tvRoom = (gameId: string) => `tv:${gameId}`;
const pairedRoom = (code: string) => `room:${code}`;

export function setupSockets(
  httpServer: HttpServer,
  auth: AuthInstance,
  games: GameService,
  rooms: RoomService,
): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: [config.baseUrl, config.backendUrl], credentials: true },
  });

  const presence = new Map<string, GamePresence>();

  function presenceOf(gameId: string): GamePresence {
    let p = presence.get(gameId);
    if (!p) {
      p = { connections: new Map(), graceTimers: new Map(), vote: null, skipping: new Set() };
      presence.set(gameId, p);
    }
    return p;
  }

  function connectedSeats(gameId: string): Seat[] {
    const p = presence.get(gameId);
    if (!p) return [];
    return Array.from(p.connections.entries())
      .filter(([, n]) => n > 0)
      .map(([seat]) => seat);
  }

  /**
   * The broadcast: one authoritative state, projected per viewer (plan §2).
   * Each seat's sockets get view(seat); the TV/spectator room gets view('SPECTATOR').
   */
  async function broadcastState(gameId: string): Promise<void> {
    const summary = await games.getSummary(gameId);
    const runtime = await games.getRuntime(gameId).catch(() => null);

    const base = {
      gameId,
      summary,
      seq: runtime?.currentSeq ?? 0,
      status: summary.status,
      activeSeats: runtime?.activeSeats() ?? [],
    };

    for (const player of summary.players) {
      io.to(playerRoom(gameId, player.seat)).emit('game:state', {
        ...base,
        yourSeat: player.seat,
        view: runtime ? runtime.view(player.seat) : null,
        legalMoves: runtime ? runtime.legalMoves(player.seat) : [],
        result: runtime?.endResult ?? null,
      });
    }

    io.to(tvRoom(gameId)).emit('tv:state', {
      ...base,
      view: runtime ? runtime.view('SPECTATOR') : null,
      result: runtime?.endResult ?? null,
    });
  }

  /** After any mutation, auto-skip seats that a skip-vote covered while they stay disconnected. */
  async function runAutoSkips(gameId: string): Promise<void> {
    const p = presenceOf(gameId);
    if (p.skipping.size === 0) return;
    const connected = new Set(connectedSeats(gameId));

    for (let guard = 0; guard < 30; guard++) {
      const runtime = await games.getRuntime(gameId);
      if (!runtime || runtime.currentStatus !== 'active') return;
      const active = runtime.activeSeats();
      const skippable = active.filter((s) => p.skipping.has(s) && !connected.has(s));
      // Only auto-skip when EVERY active seat is a disconnected skip target,
      // otherwise the connected actors should act first.
      if (skippable.length === 0 || skippable.length < active.length) return;
      for (const seat of skippable) {
        await games.skipSeat(gameId, seat);
      }
      await broadcastState(gameId);
    }
  }

  function clearGrace(gameId: string, seat: Seat): void {
    const p = presenceOf(gameId);
    const t = p.graceTimers.get(seat);
    if (t) clearTimeout(t);
    p.graceTimers.delete(seat);
  }

  async function onSeatDisconnected(gameId: string, seat: Seat): Promise<void> {
    const p = presenceOf(gameId);
    clearGrace(gameId, seat);
    p.graceTimers.set(
      seat,
      setTimeout(async () => {
        try {
          const runtime = await games.getRuntime(gameId);
          if (!runtime || runtime.currentStatus !== 'active') return;
          if ((p.connections.get(seat) ?? 0) > 0) return; // reconnected meanwhile
          const options = runtime.disconnectOptions().filter(
            (o) => o !== 'skip' || runtime.module.onPlayerSkipped,
          );
          io.to(tvRoom(gameId)).emit('vote:eligible', { gameId, seat, options });
          for (const player of (await games.getSummary(gameId)).players) {
            if (player.seat !== seat) {
              io.to(playerRoom(gameId, player.seat)).emit('vote:eligible', { gameId, seat, options });
            }
          }
        } catch {
          // game may have ended in the meantime
        }
      }, config.disconnectGraceMs),
    );
  }

  async function resolveVote(gameId: string, option: DisconnectOption, targetSeat: Seat): Promise<void> {
    const p = presenceOf(gameId);
    p.vote = null;
    io.to(tvRoom(gameId)).emit('vote:resolved', { gameId, targetSeat, option });

    if (option === 'pause') {
      await games.pauseGame(gameId);
    } else if (option === 'kick') {
      await games.kickSeat(gameId, targetSeat);
    } else if (option === 'skip') {
      p.skipping.add(targetSeat);
    }
    await broadcastState(gameId);
    await runAutoSkips(gameId);
  }

  io.use(async (socket, next) => {
    // Player sockets carry the better-auth session cookie; TV sockets have none.
    const data: SocketData = { userId: null, displayName: null, seats: new Map() };
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.handshake.headers),
      });
      if (session) {
        data.userId = session.user.id;
        data.displayName = session.user.name;
      }
    } catch {
      // unauthenticated is fine — TV role
    }
    socket.data = data;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;

    // ── TV / kiosk ──────────────────────────────────────────────────────────
    socket.on('tv:watch', async (payload: { room: string }, ack?: (r: unknown) => void) => {
      try {
        const room = await rooms.ensureRoom(payload.room);
        for (const r of socket.rooms) {
          if (r.startsWith('room:') || r.startsWith('tv:')) socket.leave(r);
        }
        socket.join(pairedRoom(room.pairingCode));
        if (room.activeGameId) {
          socket.join(tvRoom(room.activeGameId));
          await broadcastState(room.activeGameId);
        }
        ack?.({ ok: true, room });
      } catch (err) {
        ack?.({ ok: false, error: errMessage(err) });
      }
    });

    socket.on('game:watch', async (payload: { gameId: string }, ack?: (r: unknown) => void) => {
      try {
        await games.requireGame(payload.gameId);
        socket.join(tvRoom(payload.gameId));
        await broadcastState(payload.gameId);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: errMessage(err) });
      }
    });

    // ── Player ──────────────────────────────────────────────────────────────
    socket.on('game:join', async (payload: { gameId: string }, ack?: (r: unknown) => void) => {
      try {
        if (!data.userId) throw new GameServiceError('Not signed in', 'UNAUTHORIZED');
        const seat = await games.seatOf(payload.gameId, data.userId);
        if (seat === null) throw new GameServiceError('You are not in this game', 'FORBIDDEN');

        socket.join(playerRoom(payload.gameId, seat));
        data.seats.set(payload.gameId, seat);

        const p = presenceOf(payload.gameId);
        p.connections.set(seat, (p.connections.get(seat) ?? 0) + 1);
        p.skipping.delete(seat); // reconnection cancels auto-skip
        clearGrace(payload.gameId, seat);
        await games.setConnected(payload.gameId, data.userId, true);

        await broadcastState(payload.gameId);
        ack?.({ ok: true, seat });
      } catch (err) {
        ack?.({ ok: false, error: errMessage(err) });
      }
    });

    socket.on(
      'game:move',
      async (payload: { gameId: string; type: string; payload: unknown }, ack?: (r: unknown) => void) => {
        try {
          if (!data.userId) throw new GameServiceError('Not signed in', 'UNAUTHORIZED');
          await games.applyMove(payload.gameId, data.userId, payload.type, payload.payload);
          await broadcastState(payload.gameId);
          await runAutoSkips(payload.gameId);
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: errMessage(err) });
        }
      },
    );

    socket.on('game:resume', async (payload: { gameId: string }, ack?: (r: unknown) => void) => {
      try {
        if (!data.userId) throw new GameServiceError('Not signed in', 'UNAUTHORIZED');
        const seat = await games.seatOf(payload.gameId, data.userId);
        if (seat === null) throw new GameServiceError('You are not in this game', 'FORBIDDEN');
        await games.resumeGame(payload.gameId);
        await broadcastState(payload.gameId);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: errMessage(err) });
      }
    });

    // ── Disconnect votes ────────────────────────────────────────────────────
    socket.on(
      'vote:call',
      async (payload: { gameId: string; targetSeat: Seat }, ack?: (r: unknown) => void) => {
        try {
          if (!data.userId) throw new GameServiceError('Not signed in', 'UNAUTHORIZED');
          const seat = await games.seatOf(payload.gameId, data.userId);
          if (seat === null) throw new GameServiceError('You are not in this game', 'FORBIDDEN');
          const runtime = await games.getRuntime(payload.gameId);
          if (!runtime) throw new GameServiceError('Game is not active', 'CONFLICT');

          const p = presenceOf(payload.gameId);
          const options = runtime
            .disconnectOptions()
            .filter((o) => o !== 'skip' || runtime.module.onPlayerSkipped);
          p.vote = createVote(payload.targetSeat, options);
          emitVoteUpdate(payload.gameId, p.vote);
          ack?.({ ok: true, options });
        } catch (err) {
          ack?.({ ok: false, error: errMessage(err) });
        }
      },
    );

    socket.on(
      'vote:cast',
      async (payload: { gameId: string; option: DisconnectOption }, ack?: (r: unknown) => void) => {
        try {
          if (!data.userId) throw new GameServiceError('Not signed in', 'UNAUTHORIZED');
          const seat = await games.seatOf(payload.gameId, data.userId);
          if (seat === null) throw new GameServiceError('You are not in this game', 'FORBIDDEN');
          const p = presenceOf(payload.gameId);
          if (!p.vote) throw new GameServiceError('No vote in progress', 'CONFLICT');

          const outcome = castVote(p.vote, seat, payload.option, connectedSeats(payload.gameId));
          if (outcome.resolved && outcome.option) {
            await resolveVote(payload.gameId, outcome.option, p.vote?.targetSeat ?? 0);
          } else {
            emitVoteUpdate(payload.gameId, p.vote);
          }
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: errMessage(err) });
        }
      },
    );

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      for (const [gameId, seat] of data.seats) {
        const p = presenceOf(gameId);
        const remaining = (p.connections.get(seat) ?? 1) - 1;
        p.connections.set(seat, Math.max(0, remaining));
        if (remaining <= 0 && data.userId) {
          await games.setConnected(gameId, data.userId, false).catch(() => {});
          await broadcastState(gameId).catch(() => {});
          await onSeatDisconnected(gameId, seat);
        }
      }
    });
  });

  function emitVoteUpdate(gameId: string, vote: DisconnectVote): void {
    const update = {
      gameId,
      targetSeat: vote.targetSeat,
      options: vote.options,
      votes: Object.fromEntries(vote.votes),
    };
    io.to(tvRoom(gameId)).emit('vote:update', update);
    for (const [seat] of presenceOf(gameId).connections) {
      io.to(playerRoom(gameId, seat)).emit('vote:update', update);
    }
  }

  /** Push a room's TVs onto a newly assigned game (plan §5.7: reassign without touching the device). */
  async function notifyRoomAssignment(pairingCode: string, gameId: string | null): Promise<void> {
    const code = pairingCode.trim().toUpperCase();
    const sockets = await io.in(pairedRoom(code)).fetchSockets();
    for (const s of sockets) {
      for (const r of s.rooms) {
        if (r.startsWith('tv:')) s.leave(r);
      }
      if (gameId) s.join(tvRoom(gameId));
    }
    io.to(pairedRoom(code)).emit('room:assigned', { pairingCode: code, gameId });
    if (gameId) await broadcastState(gameId);
  }

  (io as any).gameboxBroadcast = broadcastState;
  (io as any).gameboxNotifyRoom = notifyRoomAssignment;
  return io;
}

export function getBroadcast(io: SocketIOServer): (gameId: string) => Promise<void> {
  return (io as any).gameboxBroadcast;
}

export function getNotifyRoom(io: SocketIOServer): (code: string, gameId: string | null) => Promise<void> {
  return (io as any).gameboxNotifyRoom;
}

function errMessage(err: unknown): string {
  if (err instanceof IllegalMove || err instanceof GameServiceError) return err.message;
  console.error(err);
  return 'Internal error';
}
