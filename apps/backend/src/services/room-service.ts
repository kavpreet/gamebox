import type { Kysely } from 'kysely';
import type { RoomDTO } from '@gamebox/shared-types';
import type { Database } from '../db/schema.js';
import { newId, nowIso } from '../db/index.js';
import { hashPin, verifyPin, mintTvToken, verifyTvToken } from '../tv-token.js';

export class RoomServiceError extends Error {
  constructor(message: string, public code: 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT') {
    super(message);
    this.name = 'RoomServiceError';
  }
}

type RoomRow = {
  id: string;
  name: string;
  pairing_code: string;
  active_game_id: string | null;
  pin_hash?: string | null;
  token_epoch?: number | null;
};

/**
 * Physical TVs (plan §5.7): a room row per TV/Pi, identified by a stable
 * pairing code the kiosk URL carries (`/tv?room=<code>`). Assigning a game to
 * a room makes every TV showing that room follow it.
 *
 * Rooms are created by an admin only. They used to self-register on first
 * `tv:watch`, which meant any unauthenticated socket could conjure a room and
 * watch whatever got cast to it — see `pairDevice`/`authorizeToken` for the
 * PIN → device-token flow that replaced it.
 */
export class RoomService {
  constructor(private db: Kysely<Database>) {}

  // ── Admin CRUD ───────────────────────────────────────────────────────────

  async createRoom(name: string, pairingCode: string, pin: string): Promise<RoomDTO> {
    const code = normalizeCode(pairingCode);
    const trimmed = name.trim();
    if (!code) throw new RoomServiceError('A pairing code is required', 'BAD_REQUEST');
    if (!trimmed) throw new RoomServiceError('A room name is required', 'BAD_REQUEST');
    requirePinShape(pin);
    if (await this.rowByCode(code)) {
      throw new RoomServiceError(`Room code ${code} is already taken`, 'CONFLICT');
    }
    const room = {
      id: newId(),
      name: trimmed,
      pairing_code: code,
      active_game_id: null,
      last_seen_at: null,
      pin_hash: hashPin(pin),
      token_epoch: 0,
    };
    await this.db.insertInto('rooms').values(room).execute();
    return this.toDto(room);
  }

  /** Rename and/or re-PIN. Setting a new PIN revokes every paired device. */
  async updateRoom(id: string, patch: { name?: string; pin?: string }): Promise<RoomDTO> {
    const row = await this.rowById(id);
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new RoomServiceError('A room name is required', 'BAD_REQUEST');
      set.name = trimmed;
    }
    if (patch.pin !== undefined && patch.pin !== '') {
      requirePinShape(patch.pin);
      set.pin_hash = hashPin(patch.pin);
      set.token_epoch = (row.token_epoch ?? 0) + 1; // old devices must re-pair
    }
    if (Object.keys(set).length === 0) return this.toDto(row);
    await this.db.updateTable('rooms').set(set).where('id', '=', id).execute();
    return this.toDto({ ...row, ...(set as Partial<RoomRow>) });
  }

  /** Kicks every paired device off this room without changing the PIN. */
  async revokeDevices(id: string): Promise<RoomDTO> {
    const row = await this.rowById(id);
    const epoch = (row.token_epoch ?? 0) + 1;
    await this.db.updateTable('rooms').set({ token_epoch: epoch }).where('id', '=', id).execute();
    return this.toDto({ ...row, token_epoch: epoch });
  }

  async deleteRoom(id: string): Promise<void> {
    await this.rowById(id);
    await this.db.deleteFrom('rooms').where('id', '=', id).execute();
  }

  async listRooms(): Promise<RoomDTO[]> {
    const rows = await this.db.selectFrom('rooms').selectAll().orderBy('name').execute();
    return rows.map((r) => this.toDto(r));
  }

  /** Admin view — adds the bits the kiosk must never see the values of. */
  async listRoomsForAdmin(): Promise<(RoomDTO & { hasPin: boolean; lastSeenAt: string | null })[]> {
    const rows = await this.db.selectFrom('rooms').selectAll().orderBy('name').execute();
    return rows.map((r) => ({
      ...this.toDto(r),
      hasPin: Boolean(r.pin_hash),
      lastSeenAt: r.last_seen_at,
    }));
  }

  /** Rooms currently showing a given game (used to clear TVs when it closes). */
  async roomsShowing(gameId: string): Promise<RoomDTO[]> {
    const rows = await this.db
      .selectFrom('rooms')
      .selectAll()
      .where('active_game_id', '=', gameId)
      .execute();
    return rows.map((r) => this.toDto(r));
  }

  /** Mints a token for a kiosk that can't practically type a PIN (Pi config). */
  async mintTokenFor(id: string): Promise<string> {
    const row = await this.rowById(id);
    return mintTvToken(row.id, row.token_epoch ?? 0);
  }

  // ── Device pairing ───────────────────────────────────────────────────────

  /**
   * PIN → device token. Deliberately reports the same error for "no such room"
   * and "wrong PIN" so the endpoint can't be used to enumerate room codes.
   */
  async pairDevice(pairingCode: string, pin: string): Promise<{ token: string; room: RoomDTO }> {
    const row = await this.rowByCode(normalizeCode(pairingCode));
    const ok = row && verifyPin(String(pin ?? ''), row.pin_hash ?? null);
    if (!row || !ok) {
      throw new RoomServiceError('Wrong room code or PIN', 'FORBIDDEN');
    }
    return { token: mintTvToken(row.id, row.token_epoch ?? 0), room: this.toDto(row) };
  }

  /**
   * Verifies a device token against the live room row and marks the TV seen.
   * Returns null for forged/expired/revoked tokens or a deleted room — the
   * caller turns that into "re-pair this TV".
   */
  async authorizeToken(token: string | null | undefined): Promise<RoomDTO | null> {
    const payload = verifyTvToken(token);
    if (!payload) return null;
    const row = await this.db
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', payload.rid)
      .executeTakeFirst();
    if (!row) return null;
    if ((row.token_epoch ?? 0) !== payload.ep) return null; // revoked
    await this.db
      .updateTable('rooms')
      .set({ last_seen_at: nowIso() })
      .where('id', '=', row.id)
      .execute();
    return this.toDto(row);
  }

  // ── Casting ──────────────────────────────────────────────────────────────

  async assignGame(pairingCode: string, gameId: string | null): Promise<RoomDTO> {
    const code = normalizeCode(pairingCode);
    const row = await this.rowByCode(code);
    if (!row) throw new RoomServiceError(`No room with code ${code}`, 'NOT_FOUND');
    await this.db
      .updateTable('rooms')
      .set({ active_game_id: gameId })
      .where('id', '=', row.id)
      .execute();
    return this.toDto({ ...row, active_game_id: gameId });
  }

  async roomByCode(pairingCode: string): Promise<RoomDTO | null> {
    const row = await this.rowByCode(normalizeCode(pairingCode));
    return row ? this.toDto(row) : null;
  }

  private async rowByCode(code: string) {
    return this.db.selectFrom('rooms').selectAll().where('pairing_code', '=', code).executeTakeFirst();
  }

  private async rowById(id: string) {
    const row = await this.db.selectFrom('rooms').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw new RoomServiceError('No such room', 'NOT_FOUND');
    return row;
  }

  private toDto(r: RoomRow): RoomDTO {
    return {
      id: r.id,
      name: r.name,
      pairingCode: r.pairing_code,
      activeGameId: r.active_game_id,
    };
  }
}

function normalizeCode(code: string): string {
  return String(code ?? '').trim().toUpperCase();
}

function requirePinShape(pin: string): void {
  if (!/^\d{4,8}$/.test(String(pin ?? ''))) {
    throw new RoomServiceError('PIN must be 4–8 digits', 'BAD_REQUEST');
  }
}
