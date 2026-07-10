import path from 'node:path';
import fs from 'node:fs';

/**
 * Minimal .env loader (no dependency): reads `.env` from the working directory
 * or the repo root, without overriding variables already in the environment.
 */
function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'), // apps/backend → repo root
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key!] !== undefined) continue;
      let value = raw!;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key!] = value;
    }
    break;
  }
}
loadDotEnv();

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1' || v === 'yes';
}

export const config = {
  /** Port the backend HTTP + WebSocket server listens on. */
  port: Number(process.env.PORT ?? 3001),

  /** Public origin the app is served from (used for auth callbacks + CORS). */
  baseUrl: process.env.BASE_URL ?? 'http://localhost:5173',

  /** Backend's own origin (better-auth baseURL). */
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3001',

  /**
   * Postgres connection string. When unset, falls back to a local SQLite file —
   * zero-setup for development; production (Pi/VPS) should always set this.
   */
  databaseUrl: process.env.DATABASE_URL ?? '',

  /** SQLite fallback path (dev only). */
  sqlitePath: process.env.SQLITE_PATH ?? path.resolve(process.cwd(), 'gamebox.dev.sqlite'),

  /** Secret for better-auth session signing. REQUIRED in production. */
  authSecret: process.env.AUTH_SECRET ?? 'dev-only-insecure-secret-change-me',

  /**
   * Development auth: email/password sign-in + sign-up. Turn OFF for production
   * once Google login is configured (plan: email/pass during dev, Google at the end).
   */
  emailPasswordEnabled: bool(process.env.AUTH_EMAIL_PASSWORD_ENABLED, true),

  /** Google OAuth credentials — when both set, Google sign-in is active. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',

  /**
   * Family allowlist: comma-separated emails permitted to create accounts.
   * Empty = allow anyone (dev convenience only — set this in production!).
   */
  allowedEmails: (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  /** Grace period before a disconnected seat becomes vote-eligible (ms). */
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS ?? 60_000),

  /** Days of inactivity before lobby/active/paused games are purged. */
  purgeAfterDays: Number(process.env.PURGE_AFTER_DAYS ?? 30),
};

export function isGoogleEnabled(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}
