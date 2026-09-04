import express, { type Request, type Response, type NextFunction } from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import type { AuthInstance } from './auth.js';
import { GameService, GameServiceError } from './services/game-service.js';
import { RoomService, RoomServiceError } from './services/room-service.js';
import { AdminService, AdminServiceError } from './services/admin-service.js';
import { listGames } from './games/registry.js';
import { config, isGoogleEnabled, isAdminEmail } from './config.js';
import type { GameOptions } from '@gamebox/shared-types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userName?: string;
      userEmail?: string;
    }
  }
}

const codeToStatus: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export function buildHttpApp(
  auth: AuthInstance,
  games: GameService,
  rooms: RoomService,
  admin: AdminService,
  onRoomAssigned: (code: string, gameId: string | null) => Promise<void>,
  onGameChanged: (gameId: string) => Promise<void>,
  onRoomDevicesRevoked: (roomId: string) => Promise<void>,
) {
  const app = express();
  app.set('trust proxy', true);

  // CORS for the dev split-origin setup (Vite on 5173, backend on 3001).
  // In production both are served from one origin behind Caddy/Traefik.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && [config.baseUrl, config.backendUrl].includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // better-auth handles /api/auth/* — MUST be mounted before express.json()
  app.all('/api/auth/{*any}', toNodeHandler(auth));

  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  /** Which auth methods the frontend should offer. */
  app.get('/api/auth-config', (_req, res) => {
    res.json({
      emailPassword: config.emailPasswordEnabled,
      google: isGoogleEnabled(),
    });
  });

  const requireUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) {
        res.status(401).json({ error: 'Not signed in' });
        return;
      }
      req.userId = session.user.id;
      req.userName = session.user.name;
      req.userEmail = session.user.email;
      next();
    } catch (err) {
      next(err);
    }
  };

  /**
   * Admin membership comes from ADMIN_EMAILS only — never from the DB — so it
   * cannot be granted through the app. 404 rather than 403: a non-admin should
   * not learn that an admin surface exists.
   */
  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    await requireUser(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (!isAdminEmail(req.userEmail)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      next();
    });
  };

  /** Who am I — drives the frontend's admin-only nav and route guard. */
  app.get('/api/me', requireUser, (req, res) => {
    res.json({
      id: req.userId,
      email: req.userEmail,
      displayName: req.userName,
      isAdmin: isAdminEmail(req.userEmail),
    });
  });

  // ── Game types ─────────────────────────────────────────────────────────
  app.get('/api/game-types', (_req, res) => {
    res.json(
      listGames().map((m) => ({
        slug: m.slug,
        displayName: m.displayName,
        minPlayers: m.minPlayers,
        maxPlayers: m.maxPlayers,
        teams: m.teams ?? 'none',
        supportsManual: Boolean(m.supportsManual),
      })),
    );
  });

  // ── Lobby ──────────────────────────────────────────────────────────────
  app.post('/api/games', requireUser, async (req, res, next) => {
    try {
      const summary = await games.createGame(
        req.userId!,
        String(req.body.gameType ?? ''),
        (req.body.options ?? {}) as Partial<GameOptions>,
      );
      res.status(201).json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/games/join', requireUser, async (req, res, next) => {
    try {
      const summary = await games.joinByPin(req.userId!, String(req.body.pin ?? ''));
      await onGameChanged(summary.id);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/games/mine', requireUser, async (req, res, next) => {
    try {
      res.json(await games.myGames(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/games/:id', requireUser, async (req, res, next) => {
    try {
      res.json(await games.getSummary(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  // Table settings — how the game *feels* (manual pieces, turn clock,
  // animation). Host-only and lobby-only: the runtime freezes its own copy at
  // start so a mid-game change can't desync the clock.
  app.get('/api/games/:id/options', requireUser, async (req, res, next) => {
    try {
      res.json(await games.getOptions(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/games/:id/options', requireUser, async (req, res, next) => {
    try {
      const opts = await games.setOptions(
        String(req.params.id),
        req.userId!,
        (req.body ?? {}) as Partial<GameOptions>,
      );
      await onGameChanged(String(req.params.id)).catch(() => {});
      res.json(opts);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/games/:id/teams', requireUser, async (req, res, next) => {
    try {
      const summary = await games.setTeams(String(req.params.id), req.userId!, req.body.teams ?? {});
      await onGameChanged(summary.id);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/games/:id/start', requireUser, async (req, res, next) => {
    try {
      await games.startGame(String(req.params.id), req.userId!);
      await onGameChanged(String(req.params.id));
      res.json(await games.getSummary(String(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/games/:id/abandon', requireUser, async (req, res, next) => {
    try {
      await games.abandonGame(String(req.params.id), req.userId!);
      await onGameChanged(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ── TV rooms ───────────────────────────────────────────────────────────
  app.get('/api/rooms', requireUser, async (_req, res, next) => {
    try {
      res.json(await rooms.listRooms());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/rooms/:code/assign', requireUser, async (req, res, next) => {
    try {
      const gameId = req.body.gameId ? String(req.body.gameId) : null;
      if (gameId) await games.requireGame(gameId);
      const room = await rooms.assignGame(String(req.params.code), gameId);
      await onRoomAssigned(room.pairingCode, gameId);
      res.json(room);
    } catch (err) {
      next(err);
    }
  });

  // ── TV pairing (unauthenticated by design — a TV has no user) ──────────
  /**
   * Room code + PIN → long-lived device token. Throttled per IP: a 4-digit PIN
   * is only as good as the number of guesses you get.
   */
  const pairAttempts = new Map<string, { n: number; until: number }>();
  const PAIR_WINDOW_MS = 10 * 60 * 1000;
  const PAIR_MAX = 10;

  app.post('/api/tv/pair', async (req, res, next) => {
    try {
      const key = req.ip ?? 'unknown';
      const now = Date.now();
      const entry = pairAttempts.get(key);
      if (entry && entry.until > now && entry.n >= PAIR_MAX) {
        res.status(429).json({ error: 'Too many attempts — wait a few minutes.' });
        return;
      }
      const fresh = !entry || entry.until <= now ? { n: 0, until: now + PAIR_WINDOW_MS } : entry;
      fresh.n += 1;
      pairAttempts.set(key, fresh);

      const paired = await rooms.pairDevice(String(req.body.room ?? ''), String(req.body.pin ?? ''));
      pairAttempts.delete(key); // a correct PIN clears the counter
      res.json(paired);
    } catch (err) {
      next(err);
    }
  });

  // ── Admin ──────────────────────────────────────────────────────────────
  app.get('/api/admin/rooms', requireAdmin, async (_req, res, next) => {
    try {
      res.json(await rooms.listRoomsForAdmin());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/rooms', requireAdmin, async (req, res, next) => {
    try {
      await rooms.createRoom(String(req.body.name ?? ''), String(req.body.pairingCode ?? ''), String(req.body.pin ?? ''));
      res.status(201).json(await rooms.listRoomsForAdmin());
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/rooms/:id', requireAdmin, async (req, res, next) => {
    try {
      const patch: { name?: string; pin?: string } = {};
      if (req.body.name !== undefined) patch.name = String(req.body.name);
      if (req.body.pin !== undefined) patch.pin = String(req.body.pin);
      await rooms.updateRoom(String(req.params.id), patch);
      if (patch.pin) await onRoomDevicesRevoked(String(req.params.id));
      res.json(await rooms.listRoomsForAdmin());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/rooms/:id/revoke', requireAdmin, async (req, res, next) => {
    try {
      await rooms.revokeDevices(String(req.params.id));
      await onRoomDevicesRevoked(String(req.params.id));
      res.json(await rooms.listRoomsForAdmin());
    } catch (err) {
      next(err);
    }
  });

  /** Mints a kiosk token for a Pi that can't type a PIN on a remote. */
  app.post('/api/admin/rooms/:id/token', requireAdmin, async (req, res, next) => {
    try {
      res.json({ token: await rooms.mintTokenFor(String(req.params.id)) });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/admin/rooms/:id', requireAdmin, async (req, res, next) => {
    try {
      await rooms.deleteRoom(String(req.params.id));
      await onRoomDevicesRevoked(String(req.params.id));
      res.json(await rooms.listRoomsForAdmin());
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/users', requireAdmin, async (_req, res, next) => {
    try {
      res.json(await admin.listAllowed());
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/users', requireAdmin, async (req, res, next) => {
    try {
      res.status(201).json(await admin.addAllowed(String(req.body.email ?? ''), req.userId!));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/admin/users/:email', requireAdmin, async (req, res, next) => {
    try {
      res.json(await admin.removeAllowed(decodeURIComponent(String(req.params.email))));
    } catch (err) {
      next(err);
    }
  });

  // ── Static SPA (production: backend serves the built frontend) ────────
  const dist = process.env.FRONTEND_DIST;
  if (dist) {
    app.use(express.static(dist));
    // SPA fallback for client-side routes (/tv, /game/..., /join/...)
    app.get(/^\/(?!api\/|socket\.io\/|healthz).*/, (_req, res) => {
      res.sendFile('index.html', { root: dist });
    });
  }

  // ── Errors ─────────────────────────────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (
      err instanceof GameServiceError ||
      err instanceof RoomServiceError ||
      err instanceof AdminServiceError
    ) {
      res.status(codeToStatus[err.code] ?? 400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
