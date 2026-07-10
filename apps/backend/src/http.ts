import express, { type Request, type Response, type NextFunction } from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import type { AuthInstance } from './auth.js';
import { GameService, GameServiceError } from './services/game-service.js';
import { RoomService } from './services/room-service.js';
import { listGames } from './games/registry.js';
import { config, isGoogleEnabled } from './config.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userName?: string;
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
  onRoomAssigned: (code: string, gameId: string | null) => Promise<void>,
  onGameChanged: (gameId: string) => Promise<void>,
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
      next();
    } catch (err) {
      next(err);
    }
  };

  // ── Game types ─────────────────────────────────────────────────────────
  app.get('/api/game-types', (_req, res) => {
    res.json(
      listGames().map((m) => ({
        slug: m.slug,
        displayName: m.displayName,
        minPlayers: m.minPlayers,
        maxPlayers: m.maxPlayers,
        teams: m.teams ?? 'none',
      })),
    );
  });

  // ── Lobby ──────────────────────────────────────────────────────────────
  app.post('/api/games', requireUser, async (req, res, next) => {
    try {
      const summary = await games.createGame(req.userId!, String(req.body.gameType ?? ''));
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
    if (err instanceof GameServiceError) {
      res.status(codeToStatus[err.code] ?? 400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
