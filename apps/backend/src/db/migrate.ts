import type { Kysely } from 'kysely';
import type { Database } from './schema.js';
import { config } from '../config.js';
import { nowIso } from './index.js';

/**
 * `ALTER TABLE ... ADD COLUMN` has no IF NOT EXISTS in SQLite, so introspect
 * first. Keeps migrateAppTables safe to run on every boot, like the rest of it.
 */
async function addColumnIfMissing(
  db: Kysely<Database>,
  table: string,
  column: string,
  build: (b: ReturnType<Kysely<Database>['schema']['alterTable']>) => unknown,
): Promise<void> {
  const tables = await db.introspection.getTables();
  const t = tables.find((x) => x.name === table);
  if (!t || t.columns.some((c) => c.name === column)) return;
  await (build(db.schema.alterTable(table)) as { execute: () => Promise<unknown> }).execute();
}

/**
 * Idempotent app-table migrations (better-auth's own tables are migrated
 * separately via its getMigrations helper — see auth.ts / index.ts).
 * Plain CREATE TABLE IF NOT EXISTS via the schema builder keeps this
 * cross-dialect (Postgres prod / SQLite dev).
 */
export async function migrateAppTables(db: Kysely<Database>): Promise<void> {
  await db.schema
    .createTable('game_types')
    .ifNotExists()
    .addColumn('slug', 'text', (c) => c.primaryKey())
    .addColumn('display_name', 'text', (c) => c.notNull())
    .addColumn('rules_version', 'text', (c) => c.notNull())
    .addColumn('min_players', 'integer', (c) => c.notNull())
    .addColumn('max_players', 'integer', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('games')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('game_type', 'text', (c) => c.notNull())
    .addColumn('rules_version', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('join_pin', 'text')
    .addColumn('version', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('current_state', 'text', (c) => c.notNull())
    .addColumn('final_result', 'text')
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'text', (c) => c.notNull())
    .addColumn('ended_at', 'text')
    .execute();

  await db.schema
    .createIndex('games_join_pin_unique')
    .ifNotExists()
    .on('games')
    .column('join_pin')
    .unique()
    .execute();

  await db.schema
    .createTable('game_players')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('game_id', 'text', (c) => c.notNull())
    .addColumn('user_id', 'text', (c) => c.notNull())
    .addColumn('seat_index', 'integer', (c) => c.notNull())
    .addColumn('team_index', 'integer')
    .addColumn('role', 'text', (c) => c.notNull().defaultTo('player'))
    .addColumn('connected', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('eliminated_at', 'text')
    .addColumn('last_seen_at', 'text')
    .execute();

  await db.schema
    .createIndex('game_players_game_user_unique')
    .ifNotExists()
    .on('game_players')
    .columns(['game_id', 'user_id'])
    .unique()
    .execute();

  await db.schema
    .createIndex('game_players_game_seat_unique')
    .ifNotExists()
    .on('game_players')
    .columns(['game_id', 'seat_index'])
    .unique()
    .execute();

  await db.schema
    .createTable('moves')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('game_id', 'text', (c) => c.notNull())
    .addColumn('seq', 'integer', (c) => c.notNull())
    .addColumn('player_id', 'text')
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('payload', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex('moves_game_seq_unique')
    .ifNotExists()
    .on('moves')
    .columns(['game_id', 'seq'])
    .unique()
    .execute();

  await db.schema
    .createTable('rooms')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('pairing_code', 'text', (c) => c.notNull())
    .addColumn('active_game_id', 'text')
    .addColumn('last_seen_at', 'text')
    .execute();

  await db.schema
    .createIndex('rooms_pairing_code_unique')
    .ifNotExists()
    .on('rooms')
    .column('pairing_code')
    .unique()
    .execute();

  // TV room auth (added after the rooms table shipped without it).
  await addColumnIfMissing(db, 'rooms', 'pin_hash', (b) => b.addColumn('pin_hash', 'text'));
  await addColumnIfMissing(db, 'rooms', 'token_epoch', (b) =>
    b.addColumn('token_epoch', 'integer', (c) => c.notNull().defaultTo(0)),
  );

  // Per-game table settings (manual mode, turn clock, animation) — added
  // after the games table shipped, so existing rows fall back to defaults.
  await addColumnIfMissing(db, 'games', 'options', (b) => b.addColumn('options', 'text'));

  await db.schema
    .createTable('allowed_emails')
    .ifNotExists()
    .addColumn('email', 'text', (c) => c.primaryKey())
    .addColumn('added_by', 'text')
    .addColumn('added_at', 'text', (c) => c.notNull())
    .execute();
}

/**
 * Copies ALLOWED_EMAILS into the DB allowlist once, so an existing deploy (or a
 * brand-new one) always has someone who can sign in. After the first boot the
 * table is authoritative — removing someone in /admin must not be undone on the
 * next restart, so this only ever inserts rows that are absent, and only while
 * the table is still empty.
 */
export async function seedAllowlist(db: Kysely<Database>): Promise<number> {
  const seeds = [...new Set([...config.allowedEmails, ...config.adminEmails])];
  if (seeds.length === 0) return 0;
  const existing = await db.selectFrom('allowed_emails').select('email').execute();
  if (existing.length > 0) return 0;
  await db
    .insertInto('allowed_emails')
    .values(seeds.map((email) => ({ email, added_by: null, added_at: nowIso() })))
    .execute();
  return seeds.length;
}
