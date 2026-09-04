import { describe, it, expect, beforeEach } from 'vitest';
import { Kysely, SqliteDialect } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import type { Database } from '../src/db/schema.js';
import { migrateAppTables, seedAllowlist } from '../src/db/migrate.js';
import { RoomService, RoomServiceError } from '../src/services/room-service.js';
import { AdminService, AdminServiceError } from '../src/services/admin-service.js';
import { mintTvToken, verifyTvToken, hashPin, verifyPin } from '../src/tv-token.js';
import { config } from '../src/config.js';

async function freshDb(): Promise<Kysely<Database>> {
  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
  });
  await migrateAppTables(db);
  // better-auth owns `user` in production; AdminService only reads it.
  await db.schema
    .createTable('user')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('image', 'text')
    .execute();
  return db;
}

/** Stubs the one better-auth call AdminService makes. */
function stubAuth(deleted: string[]) {
  return {
    $context: Promise.resolve({
      internalAdapter: {
        deleteUser: async (id: string) => {
          deleted.push(id);
        },
      },
    }),
  } as never;
}

describe('tv device tokens', () => {
  it('round-trips and rejects tampering', () => {
    const token = mintTvToken('room-1', 0);
    expect(verifyTvToken(token)).toMatchObject({ rid: 'room-1', ep: 0 });

    const [body, sig] = token.split('.');
    expect(verifyTvToken(`${body}x.${sig}`)).toBeNull(); // payload swapped
    // Flip the last signature character to something it definitely isn't —
    // hard-coding one letter silently no-ops whenever the real signature
    // already ends in it.
    const lastChar = sig!.slice(-1);
    expect(verifyTvToken(`${body}.${sig!.slice(0, -1)}${lastChar === 'A' ? 'B' : 'A'}`)).toBeNull();
    expect(verifyTvToken('')).toBeNull();
    expect(verifyTvToken('not-a-token')).toBeNull();
  });

  it('expires', () => {
    const token = mintTvToken('room-1', 0);
    const afterExpiry = Date.now() + (config.tvTokenDays + 1) * 24 * 60 * 60 * 1000;
    expect(verifyTvToken(token, afterExpiry)).toBeNull();
  });

  it('hashes PINs with a per-PIN salt', () => {
    const a = hashPin('1234');
    const b = hashPin('1234');
    expect(a).not.toBe(b); // salted
    expect(a).not.toContain('1234'); // not stored in the clear
    expect(verifyPin('1234', a)).toBe(true);
    expect(verifyPin('1235', a)).toBe(false);
    expect(verifyPin('1234', null)).toBe(false);
  });
});

describe('room pairing', () => {
  let db: Kysely<Database>;
  let rooms: RoomService;

  beforeEach(async () => {
    db = await freshDb();
    rooms = new RoomService(db);
  });

  it('pairs with the right PIN and authorizes the token', async () => {
    const room = await rooms.createRoom('Lounge', 'lounge', '4242');
    expect(room.pairingCode).toBe('LOUNGE');

    const { token } = await rooms.pairDevice('lounge', '4242');
    const authorized = await rooms.authorizeToken(token);
    expect(authorized?.id).toBe(room.id);
  });

  it('rejects a wrong PIN and an unknown room identically', async () => {
    await rooms.createRoom('Lounge', 'LOUNGE', '4242');
    const wrongPin = await rooms.pairDevice('LOUNGE', '9999').catch((e) => e as RoomServiceError);
    const noRoom = await rooms.pairDevice('NOPE', '4242').catch((e) => e as RoomServiceError);
    expect((wrongPin as RoomServiceError).message).toBe((noRoom as RoomServiceError).message);
    expect((wrongPin as RoomServiceError).code).toBe('FORBIDDEN');
  });

  it('refuses a room with no PIN, a weak PIN, and a duplicate code', async () => {
    await expect(rooms.createRoom('Bad', 'BAD', '')).rejects.toThrow(/4–8 digits/);
    await expect(rooms.createRoom('Bad', 'BAD', '12')).rejects.toThrow(/4–8 digits/);
    await expect(rooms.createRoom('Bad', 'BAD', 'abcd')).rejects.toThrow(/4–8 digits/);
    await rooms.createRoom('Lounge', 'LOUNGE', '4242');
    await expect(rooms.createRoom('Other', 'lounge', '1111')).rejects.toThrow(/already taken/);
  });

  it('revoking devices invalidates existing tokens but keeps the PIN', async () => {
    const room = await rooms.createRoom('Lounge', 'LOUNGE', '4242');
    const { token } = await rooms.pairDevice('LOUNGE', '4242');
    expect(await rooms.authorizeToken(token)).not.toBeNull();

    await rooms.revokeDevices(room.id);
    expect(await rooms.authorizeToken(token)).toBeNull();

    // the PIN still works, so the TV can re-pair
    const again = await rooms.pairDevice('LOUNGE', '4242');
    expect(await rooms.authorizeToken(again.token)).not.toBeNull();
  });

  it('changing the PIN invalidates old tokens and the old PIN', async () => {
    const room = await rooms.createRoom('Lounge', 'LOUNGE', '4242');
    const { token } = await rooms.pairDevice('LOUNGE', '4242');
    await rooms.updateRoom(room.id, { pin: '8888' });

    expect(await rooms.authorizeToken(token)).toBeNull();
    await expect(rooms.pairDevice('LOUNGE', '4242')).rejects.toThrow();
    expect(await rooms.authorizeToken((await rooms.pairDevice('LOUNGE', '8888')).token)).not.toBeNull();
  });

  it('renaming keeps devices paired', async () => {
    const room = await rooms.createRoom('Lounge', 'LOUNGE', '4242');
    const { token } = await rooms.pairDevice('LOUNGE', '4242');
    await rooms.updateRoom(room.id, { name: 'Den' });
    const authorized = await rooms.authorizeToken(token);
    expect(authorized?.name).toBe('Den');
  });

  it('a deleted room stops authorizing, and casting to it fails', async () => {
    const room = await rooms.createRoom('Lounge', 'LOUNGE', '4242');
    const { token } = await rooms.pairDevice('LOUNGE', '4242');
    await rooms.deleteRoom(room.id);
    expect(await rooms.authorizeToken(token)).toBeNull();
    await expect(rooms.assignGame('LOUNGE', 'game-1')).rejects.toThrow(/No room with code/);
  });

  it('never invents a room — casting to an unknown code is an error, not a create', async () => {
    await expect(rooms.assignGame('GHOST', null)).rejects.toThrow(/No room with code/);
    expect(await rooms.listRooms()).toHaveLength(0);
  });

  it('admin token minting produces a token the room accepts', async () => {
    const room = await rooms.createRoom('Pi', 'PI', '1234');
    const token = await rooms.mintTokenFor(room.id);
    expect(await rooms.authorizeToken(token)).not.toBeNull();
    await rooms.revokeDevices(room.id);
    expect(await rooms.authorizeToken(token)).toBeNull();
  });

  it('the admin list exposes whether a PIN is set, never the PIN', async () => {
    await rooms.createRoom('Lounge', 'LOUNGE', '4242');
    const [row] = await rooms.listRoomsForAdmin();
    expect(row!.hasPin).toBe(true);
    expect(JSON.stringify(row)).not.toContain('4242');
  });
});

describe('allowlist admin', () => {
  let db: Kysely<Database>;
  let admin: AdminService;
  let deleted: string[];

  beforeEach(async () => {
    db = await freshDb();
    deleted = [];
    admin = new AdminService(db, stubAuth(deleted));
  });

  it('seeds from env once and never resurrects a removed email', async () => {
    const n = await seedAllowlist(db);
    expect(n).toBeGreaterThan(0);
    expect((await admin.listAllowed()).some((u) => u.isAdmin)).toBe(true);

    await admin.addAllowed('kid@example.com', 'admin-id');
    await admin.removeAllowed('kid@example.com');

    // a restart must not bring them back
    expect(await seedAllowlist(db)).toBe(0);
    expect((await admin.listAllowed()).map((u) => u.email)).not.toContain('kid@example.com');
  });

  it('validates emails and rejects duplicates', async () => {
    await expect(admin.addAllowed('not-an-email', 'a')).rejects.toThrow(/valid email/);
    await admin.addAllowed('Kid@Example.com', 'a');
    expect((await admin.listAllowed()).map((u) => u.email)).toContain('kid@example.com'); // normalized
    await expect(admin.addAllowed('kid@example.com', 'a')).rejects.toThrow(/already allowed/);
  });

  it('removing a signed-up user deletes the account so sessions die', async () => {
    await admin.addAllowed('kid@example.com', 'a');
    await db
      .insertInto('user')
      .values({ id: 'u1', name: 'Kid', email: 'kid@example.com', image: null })
      .execute();

    expect((await admin.listAllowed()).find((u) => u.email === 'kid@example.com')?.hasAccount).toBe(true);
    await admin.removeAllowed('kid@example.com');
    expect(deleted).toEqual(['u1']);
  });

  it('refuses to remove an env-configured admin', async () => {
    await seedAllowlist(db);
    const adminEmail = config.adminEmails[0]!;
    const err = await admin.removeAllowed(adminEmail).catch((e) => e as AdminServiceError);
    expect((err as AdminServiceError).code).toBe('FORBIDDEN');
    expect((await admin.listAllowed()).map((u) => u.email)).toContain(adminEmail);
    expect(deleted).toEqual([]); // and their account survives
  });

  it('removing an email that is not on the list is a 404, not a silent success', async () => {
    const err = await admin.removeAllowed('nobody@example.com').catch((e) => e as AdminServiceError);
    expect((err as AdminServiceError).code).toBe('NOT_FOUND');
  });
});
