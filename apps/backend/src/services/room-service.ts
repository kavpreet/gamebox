import type { Kysely } from 'kysely';
import type { RoomDTO } from '@gamebox/shared-types';
import type { Database } from '../db/schema.js';
import { newId, nowIso } from '../db/index.js';

/**
 * Physical TVs (plan §5.7): a room row per TV/Pi, identified by a stable
 * pairing code the kiosk URL carries (`/tv?room=<code>`). Assigning a game to
 * a room makes every TV showing that room follow it.
 */
export class RoomService {
  constructor(private db: Kysely<Database>) {}

  /** Idempotent: a TV that connects with an unknown code self-registers. */
  async ensureRoom(pairingCode: string, name?: string): Promise<RoomDTO> {
    const code = pairingCode.trim().toUpperCase();
    const existing = await this.db
      .selectFrom('rooms')
      .selectAll()
      .where('pairing_code', '=', code)
      .executeTakeFirst();
    if (existing) {
      await this.db
        .updateTable('rooms')
        .set({ last_seen_at: nowIso() })
        .where('id', '=', existing.id)
        .execute();
      return this.toDto(existing);
    }
    const room = {
      id: newId(),
      name: name ?? code,
      pairing_code: code,
      active_game_id: null,
      last_seen_at: nowIso(),
    };
    await this.db.insertInto('rooms').values(room).execute();
    return this.toDto(room);
  }

  async listRooms(): Promise<RoomDTO[]> {
    const rows = await this.db.selectFrom('rooms').selectAll().orderBy('name').execute();
    return rows.map((r) => this.toDto(r));
  }

  async assignGame(pairingCode: string, gameId: string | null): Promise<RoomDTO> {
    const code = pairingCode.trim().toUpperCase();
    const room = await this.ensureRoom(code);
    await this.db
      .updateTable('rooms')
      .set({ active_game_id: gameId })
      .where('pairing_code', '=', code)
      .execute();
    return { ...room, activeGameId: gameId };
  }

  async roomByCode(pairingCode: string): Promise<RoomDTO | null> {
    const row = await this.db
      .selectFrom('rooms')
      .selectAll()
      .where('pairing_code', '=', pairingCode.trim().toUpperCase())
      .executeTakeFirst();
    return row ? this.toDto(row) : null;
  }

  private toDto(r: {
    id: string;
    name: string;
    pairing_code: string;
    active_game_id: string | null;
  }): RoomDTO {
    return {
      id: r.id,
      name: r.name,
      pairingCode: r.pairing_code,
      activeGameId: r.active_game_id,
    };
  }
}
