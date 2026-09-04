import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { nowIso } from '../db/index.js';
import { config, isAdminEmail } from '../config.js';
import type { AuthInstance } from '../auth.js';

export class AdminServiceError extends Error {
  constructor(message: string, public code: 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT') {
    super(message);
    this.name = 'AdminServiceError';
  }
}

export interface AllowedEmailDTO {
  email: string;
  addedAt: string;
  /** true once someone has actually signed up with this address */
  hasAccount: boolean;
  /** admins come from env and cannot be removed here */
  isAdmin: boolean;
  userId: string | null;
  displayName: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The family allowlist, moved out of ALLOWED_EMAILS into the DB so it can be
 * edited from /admin without a redeploy (auth.ts reads this table in its user
 * `create.before` hook). Admin membership itself stays env-only — see
 * config.adminEmails.
 */
export class AdminService {
  constructor(private db: Kysely<Database>, private auth: AuthInstance) {}

  async listAllowed(): Promise<AllowedEmailDTO[]> {
    const [rows, users] = await Promise.all([
      this.db.selectFrom('allowed_emails').selectAll().orderBy('email').execute(),
      this.db.selectFrom('user').select(['id', 'email', 'name']).execute(),
    ]);
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    return rows.map((r) => {
      const user = byEmail.get(r.email);
      return {
        email: r.email,
        addedAt: r.added_at,
        hasAccount: Boolean(user),
        isAdmin: isAdminEmail(r.email),
        userId: user?.id ?? null,
        displayName: user?.name ?? null,
      };
    });
  }

  async addAllowed(email: string, addedBy: string): Promise<AllowedEmailDTO[]> {
    const clean = String(email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) throw new AdminServiceError('That is not a valid email', 'BAD_REQUEST');
    const existing = await this.db
      .selectFrom('allowed_emails')
      .select('email')
      .where('email', '=', clean)
      .executeTakeFirst();
    if (existing) throw new AdminServiceError('That email is already allowed', 'CONFLICT');
    await this.db
      .insertInto('allowed_emails')
      .values({ email: clean, added_by: addedBy, added_at: nowIso() })
      .execute();
    return this.listAllowed();
  }

  /**
   * Removes the allowlist entry AND, if they had signed up, deletes the account
   * so existing sessions die immediately — otherwise "remove user" would only
   * stop them signing up again, and a year-long session (auth.ts) would keep
   * them in the house indefinitely.
   */
  async removeAllowed(email: string): Promise<AllowedEmailDTO[]> {
    const clean = String(email ?? '').trim().toLowerCase();
    if (isAdminEmail(clean)) {
      throw new AdminServiceError('Admins are set in ADMIN_EMAILS and cannot be removed here', 'FORBIDDEN');
    }
    const row = await this.db
      .selectFrom('allowed_emails')
      .select('email')
      .where('email', '=', clean)
      .executeTakeFirst();
    if (!row) throw new AdminServiceError('That email is not on the list', 'NOT_FOUND');

    const user = await this.db
      .selectFrom('user')
      .select('id')
      .where('email', '=', clean)
      .executeTakeFirst();
    if (user) {
      // deletes the user plus their sessions and linked accounts
      const ctx = await this.auth.$context;
      await ctx.internalAdapter.deleteUser(user.id);
    }
    await this.db.deleteFrom('allowed_emails').where('email', '=', clean).execute();
    return this.listAllowed();
  }
}

/** Whether the allowlist gate is active at all (empty list = open, dev only). */
export async function allowlistIsEmpty(db: Kysely<Database>): Promise<boolean> {
  const row = await db.selectFrom('allowed_emails').select('email').executeTakeFirst();
  return !row && config.allowedEmails.length === 0;
}
