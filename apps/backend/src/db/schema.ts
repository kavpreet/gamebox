/**
 * Kysely table typings for GameBox's own tables (better-auth manages its own:
 * user, session, account, verification).
 *
 * Cross-dialect notes (Postgres in production, SQLite in dev):
 * - ids are app-generated uuid strings (text columns)
 * - timestamps are ISO-8601 text
 * - JSON payloads are serialized text; (de)serialization lives in the repo layer
 *
 * Deviation from the plan's schema sketch (§5.3), deliberate: the full runtime
 * snapshot — public state, per-seat private zones, and RNG state — is stored in
 * games.current_state as one JSON blob instead of splitting private zones into
 * game_players.private_state. The server never sends raw rows to clients (all
 * outbound state goes through the module's view() projection), so the split
 * bought defense-in-depth at the cost of a reassembly step everywhere; one
 * column keeps resume/rehydrate O(1) and trivially correct.
 */
export interface GamesTable {
  id: string;
  game_type: string;
  rules_version: string;
  status: string; // GameStatus
  join_pin: string | null;
  version: number; // optimistic-concurrency counter == last move seq
  current_state: string; // JSON RuntimeSnapshot (server-only, never sent raw)
  final_result: string | null; // JSON EndResult
  created_by: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface GamePlayersTable {
  id: string;
  game_id: string;
  user_id: string;
  seat_index: number;
  team_index: number | null;
  role: string; // 'player' | 'spectator'
  connected: number; // 0/1 (SQLite has no boolean)
  eliminated_at: string | null;
  last_seen_at: string | null;
}

export interface MovesTable {
  id: string;
  game_id: string;
  seq: number;
  player_id: string | null; // null for system events
  type: string;
  payload: string; // JSON
  created_at: string;
}

export interface GameTypesTable {
  slug: string;
  display_name: string;
  rules_version: string;
  min_players: number;
  max_players: number;
}

export interface RoomsTable {
  id: string;
  name: string;
  pairing_code: string;
  active_game_id: string | null;
  last_seen_at: string | null;
}

/**
 * Minimal typing of better-auth's `user` table — owned/migrated by better-auth;
 * declared here only so we can join display names.
 */
export interface AuthUserTable {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface Database {
  user: AuthUserTable;
  games: GamesTable;
  game_players: GamePlayersTable;
  moves: MovesTable;
  game_types: GameTypesTable;
  rooms: RoomsTable;
}
