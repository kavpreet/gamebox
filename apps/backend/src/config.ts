import path from 'node:path';

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
