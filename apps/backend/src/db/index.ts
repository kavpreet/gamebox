import { Kysely, PostgresDialect, SqliteDialect, type Dialect } from 'kysely';
import type { Database } from './schema.js';
import { config } from '../config.js';

export type KyselyDatabaseType = 'postgres' | 'sqlite';

let dialect: Dialect | null = null;
let dialectType: KyselyDatabaseType = 'sqlite';
let db: Kysely<Database> | null = null;

async function buildDialect(): Promise<{ dialect: Dialect; type: KyselyDatabaseType }> {
  if (config.databaseUrl) {
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: config.databaseUrl });
    return { dialect: new PostgresDialect({ pool }), type: 'postgres' };
  }
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const sqlite = new BetterSqlite3(config.sqlitePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return { dialect: new SqliteDialect({ database: sqlite }), type: 'sqlite' };
}

/** Idempotent init — better-auth and the app share the same dialect/connection. */
export async function getDialect(): Promise<{ dialect: Dialect; type: KyselyDatabaseType }> {
  if (!dialect) {
    const built = await buildDialect();
    dialect = built.dialect;
    dialectType = built.type;
  }
  return { dialect, type: dialectType };
}

export async function getDb(): Promise<Kysely<Database>> {
  if (!db) {
    const { dialect } = await getDialect();
    db = new Kysely<Database>({ dialect });
  }
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
