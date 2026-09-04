import { useEffect, useState } from 'react';
import type { AdminRoomDTO, AllowedEmailDTO } from '@gamebox/shared-types';
import { api } from '../api.js';

/**
 * Owner-only console (ADMIN_EMAILS on the server; the route is guarded in
 * App.tsx and every endpoint re-checks). Two jobs: which TVs exist and what
 * their PINs are, and who is allowed to have an account.
 */
export function AdminPage() {
  const [rooms, setRooms] = useState<AdminRoomDTO[]>([]);
  const [users, setUsers] = useState<AllowedEmailDTO[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [kioskUrl, setKioskUrl] = useState<{ id: string; url: string } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run(async () => {
      const [r, u] = await Promise.all([api.admin.rooms(), api.admin.users()]);
      setRooms(r);
      setUsers(u);
    });
  }, []);

  const addRoom = () =>
    run(async () => {
      setRooms(await api.admin.createRoom(name, code, pin));
      setName('');
      setCode('');
      setPin('');
    });

  const changePin = (room: AdminRoomDTO) =>
    run(async () => {
      const next = window.prompt(`New PIN for ${room.name} (4–8 digits).\nEvery paired TV will need it.`);
      if (next === null) return;
      setRooms(await api.admin.updateRoom(room.id, { pin: next.trim() }));
    });

  const rename = (room: AdminRoomDTO) =>
    run(async () => {
      const next = window.prompt('Room name', room.name);
      if (next === null) return;
      setRooms(await api.admin.updateRoom(room.id, { name: next }));
    });

  const revoke = (room: AdminRoomDTO) =>
    run(async () => {
      if (!window.confirm(`Sign out every TV paired to ${room.name}? The PIN stays the same.`)) return;
      setRooms(await api.admin.revokeRoom(room.id));
    });

  const remove = (room: AdminRoomDTO) =>
    run(async () => {
      if (!window.confirm(`Delete room ${room.name} (${room.pairingCode})? Its TVs stop working.`)) return;
      setRooms(await api.admin.deleteRoom(room.id));
    });

  const kiosk = (room: AdminRoomDTO) =>
    run(async () => {
      const { token } = await api.admin.roomToken(room.id);
      setKioskUrl({
        id: room.id,
        url: `${window.location.origin}/tv?room=${room.pairingCode}&token=${token}`,
      });
    });

  const addUser = () =>
    run(async () => {
      setUsers(await api.admin.addUser(email));
      setEmail('');
    });

  const removeUser = (u: AllowedEmailDTO) =>
    run(async () => {
      const warning = u.hasAccount
        ? `Remove ${u.email}? Their account and all their sessions are deleted immediately.`
        : `Remove ${u.email} from the allowlist?`;
      if (!window.confirm(warning)) return;
      setUsers(await api.admin.removeUser(u.email));
    });

  return (
    <div className="page wide">
      <h2>Admin</h2>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>TV rooms</h3>
        <p className="dim small">
          A TV opens <code>/tv?room=CODE</code> and enters the PIN once. Changing a PIN or revoking
          signs every paired TV out immediately.
        </p>

        {rooms.length === 0 && <p className="dim">No rooms yet — add one below.</p>}
        {rooms.map((r) => (
          <div key={r.id} className="row between" style={{ alignItems: 'flex-start' }}>
            <span>
              <strong>{r.name}</strong> <span className="badge">{r.pairingCode}</span>
              {!r.hasPin && <span className="error small"> no PIN set</span>}
              <span className="dim small">
                {' '}
                {r.lastSeenAt ? `· last seen ${new Date(r.lastSeenAt).toLocaleString()}` : '· never paired'}
                {r.activeGameId ? ' · casting' : ''}
              </span>
            </span>
            <span className="row">
              <button className="ghost" onClick={() => rename(r)} disabled={busy}>Rename</button>
              <button className="secondary" onClick={() => changePin(r)} disabled={busy}>New PIN</button>
              <button className="ghost" onClick={() => kiosk(r)} disabled={busy}>Kiosk link</button>
              <button className="ghost" onClick={() => revoke(r)} disabled={busy}>Sign out TVs</button>
              <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => remove(r)} disabled={busy}>
                Delete
              </button>
            </span>
          </div>
        ))}

        {kioskUrl && (
          <div className="card" style={{ marginTop: 12 }}>
            <p className="small dim">
              Paste into the Pi's kiosk config — it pairs without typing a PIN. Treat it like a
              password; “Sign out TVs” invalidates it.
            </p>
            <input readOnly value={kioskUrl.url} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
            <button className="ghost" onClick={() => setKioskUrl(null)}>Hide</button>
          </div>
        )}

        <h4 style={{ marginTop: 16 }}>Add a room</h4>
        <div className="row">
          <input placeholder="Name (Lounge)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="Code (LOUNGE)"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
          />
          <input
            placeholder="PIN (4–8 digits)"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <button onClick={addRoom} disabled={busy || !name || !code || pin.length < 4}>
            Add room
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Who can sign in</h3>
        <p className="dim small">
          Only these addresses can create an account. Admins are set in <code>ADMIN_EMAILS</code> on
          the server and can't be removed here.
        </p>
        {users.map((u) => (
          <div key={u.email} className="row between">
            <span>
              {u.email}
              {u.isAdmin && <span className="badge on"> admin</span>}
              <span className="dim small">
                {' '}
                {u.hasAccount ? `· signed up as ${u.displayName}` : '· not signed up yet'}
              </span>
            </span>
            {!u.isAdmin && (
              <button className="ghost" style={{ color: 'var(--danger)' }} onClick={() => removeUser(u)} disabled={busy}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}>
          <input
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button onClick={addUser} disabled={busy || !email}>Allow</button>
        </div>
      </div>
    </div>
  );
}
