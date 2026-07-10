import type { Kysely } from 'kysely';
import type { Database } from './schema.js';

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
}
