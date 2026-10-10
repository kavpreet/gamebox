import { createHmac, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import { config } from './config.js';

/**
 * TV device auth (plan §5.7 hardening).
 *
 * A TV is not a user: it has no cookie, no email, and lives on a screen the
 * whole household can see. So it authenticates as a *device paired to a room*:
 * type the room's PIN once, get back a long-lived signed token that the kiosk
 * stores locally and replays on every `tv:watch`.
 *
 * Tokens are stateless (HMAC over the payload, no server-side table) — the
 * revocation handle is `rooms.token_epoch`: bump it and every token minted for
 * that room stops verifying on the next connect.
 */

export interface TvTokenPayload {
  /** room id (not the pairing code — codes can be renamed) */
  rid: string;
  /** token epoch this token was minted against */
  ep: number;
  /** issued-at, epoch seconds */
  iat: number;
  /** expiry, epoch seconds */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(body: string): string {
  return b64url(createHmac('sha256', config.authSecret).update(body).digest());
}

/** `<payload>.<sig>` — compact, URL-safe, safe to paste into a kiosk config. */
export function mintTvToken(roomId: string, epoch: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload: TvTokenPayload = {
    rid: roomId,
    ep: epoch,
    iat,
    exp: iat + config.tvTokenDays * 24 * 60 * 60,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body)}`;
}

/**
 * Returns the payload, or null when the token is malformed, forged, or expired.
 * Epoch is NOT checked here — the caller compares it against the room row it
 * just loaded (that's the revocation check, and it needs the DB).
 */
export function verifyTvToken(token: string | null | undefined, now = Date.now()): TvTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = Buffer.from(sign(body), 'utf8');
  const actual = Buffer.from(sig, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as TvTokenPayload;
    if (typeof payload.rid !== 'string' || typeof payload.ep !== 'number') return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Room PIN hashing ────────────────────────────────────────────────────────
// scrypt from node:crypto — no new dependency, and PIN verification happens
// once per device pairing, so the cost is irrelevant.

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pin.normalize('NFKC'), salt, 32);
  return `${b64url(salt)}:${b64url(key)}`;
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltPart, keyPart] = stored.split(':');
  if (!saltPart || !keyPart) return false;
  try {
    const expected = fromB64url(keyPart);
    const actual = scryptSync(pin.normalize('NFKC'), fromB64url(saltPart), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
