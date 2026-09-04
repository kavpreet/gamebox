import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { RoomDTO } from '@gamebox/shared-types';
import { getSocket, emitAck } from '../socket.js';
import { api } from '../api.js';
import { getGameUi } from '../games/registry.js';
import type { LiveState } from '../games/types.js';
import { SeatTokens, WinnerBanner } from '../games/common.js';
import { TableProvider } from '../games/table.js';
import { TableChrome, TableTurnBanner } from '../games/chrome.js';

/** Per-room so one browser can pair to several rooms (and a wipe is scoped). */
const tokenKey = (code: string) => `gamebox.tv.token.${code}`;

/**
 * The kiosk page (plan §5.7): boots to a stable ROOM url — /tv?room=<code> —
 * never a game url. Shows idle screen until a phone casts a game to this room,
 * then follows rooms.active_game_id pushed over the socket.
 *
 * A TV has no user session, so it authenticates as a *device*: enter the room's
 * PIN once, store the returned long-lived token, replay it on every tv:watch.
 * An admin revoking the room (or rotating its PIN) drops us back to the prompt.
 */
export function TvPage() {
  const [params] = useSearchParams();
  const roomCode = (params.get('room') ?? 'TV').toUpperCase();
  const urlToken = params.get('token'); // pre-provisioned kiosks (Pi config)
  const [room, setRoom] = useState<RoomDTO | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [qr, setQr] = useState('');
  const [token, setToken] = useState<string | null>(
    () => urlToken ?? localStorage.getItem(tokenKey(roomCode)),
  );
  const [pin, setPin] = useState('');
  const [pairError, setPairError] = useState('');
  const [pairing, setPairing] = useState(false);

  // A token handed over in the URL is persisted, then dropped from the address
  // bar so it doesn't linger on a screen everyone can see.
  useEffect(() => {
    if (!urlToken) return;
    localStorage.setItem(tokenKey(roomCode), urlToken);
    window.history.replaceState(null, '', `/tv?room=${encodeURIComponent(roomCode)}`);
  }, [urlToken, roomCode]);

  const unpair = useCallback(() => {
    localStorage.removeItem(tokenKey(roomCode));
    setToken(null);
    setRoom(null);
    setState(null);
  }, [roomCode]);

  const submitPin = async () => {
    setPairing(true);
    setPairError('');
    try {
      const res = await api.pairTv(roomCode, pin);
      localStorage.setItem(tokenKey(roomCode), res.token);
      setPin('');
      setToken(res.token);
    } catch (err) {
      setPairError(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setPairing(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const socket = getSocket();

    const watch = async () => {
      const res = await emitAck<{ ok: boolean; room?: RoomDTO; needsPin?: boolean }>('tv:watch', {
        room: roomCode,
        token,
      });
      if (res.ok && res.room) {
        setRoom(res.room);
        if (!res.room.activeGameId) setState(null);
      } else if (res.needsPin) {
        unpair();
      }
    };

    const onTvState = (s: LiveState) => setState(s);
    const onUnpaired = () => unpair();
    const onAssigned = (a: { pairingCode: string; gameId: string | null }) => {
      if (a.pairingCode === roomCode) {
        if (!a.gameId) setState(null);
        setRoom((r) => (r ? { ...r, activeGameId: a.gameId } : r));
      }
    };

    socket.on('tv:state', onTvState);
    socket.on('room:assigned', onAssigned);
    socket.on('tv:unpaired', onUnpaired);
    socket.on('connect', watch);
    watch();

    return () => {
      socket.off('tv:state', onTvState);
      socket.off('room:assigned', onAssigned);
      socket.off('tv:unpaired', onUnpaired);
      socket.off('connect', watch);
    };
  }, [roomCode, token, unpair]);

  if (!token) {
    return (
      <div className="idle-screen">
        <h1>
          Game<span style={{ color: 'var(--accent)' }}>Box</span>
        </h1>
        <p style={{ fontSize: '2.5vmin' }} className="dim">
          Pair this TV to room <strong>{roomCode}</strong> — enter its PIN once.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPin();
          }}
          style={{ display: 'flex', gap: '1.5vmin', alignItems: 'center' }}
        >
          <input
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            style={{ fontSize: '5vmin', width: '9em', textAlign: 'center', letterSpacing: '0.3em' }}
          />
          <button className="big" style={{ width: 'auto', fontSize: '3vmin' }} disabled={pairing || pin.length < 4}>
            {pairing ? 'Pairing…' : 'Pair'}
          </button>
        </form>
        {pairError && <p className="error" style={{ fontSize: '2.2vmin' }}>{pairError}</p>}
      </div>
    );
  }

  const joinUrl = state?.summary.joinPin ? `${window.location.origin}/join/${state.summary.joinPin}` : '';
  useEffect(() => {
    if (joinUrl) {
      QRCode.toDataURL(joinUrl, { width: 260, margin: 1, color: { dark: '#0f1220', light: '#eef0ff' } }).then(setQr);
    } else {
      setQr('');
    }
  }, [joinUrl]);

  if (!state) {
    return (
      <div className="idle-screen">
        <h1>
          Game<span style={{ color: 'var(--accent)' }}>Box</span>
        </h1>
        <p style={{ fontSize: '2.5vmin' }} className="dim">
          This TV is ready. Start a game on your phone and cast it here.
        </p>
        <div className="room-code">{room?.name ?? roomCode}</div>
        <p className="dim" style={{ fontSize: '2vmin' }}>
          room code: {roomCode}
        </p>
      </div>
    );
  }

  // Lobby on the big screen: PIN + QR
  if (state.status === 'lobby') {
    return (
      <div className="idle-screen">
        <h1 style={{ fontSize: '3.5vmin' }}>Waiting for players…</h1>
        <div className="pin-display" style={{ fontSize: '9vmin' }}>
          {state.summary.joinPin}
        </div>
        {qr && <img src={qr} alt="Join QR" style={{ borderRadius: 12, width: '26vmin' }} />}
        <div style={{ display: 'flex', gap: '2vmin', flexWrap: 'wrap', justifyContent: 'center' }}>
          {state.summary.players.map((p) => (
            <div key={p.seat} className="tv-player-chip">
              <span className={`token seat-color-${p.seat % 6}`} />
              {p.displayName}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const ui = getGameUi(state.summary.gameType);
  return (
    <TableProvider state={state}>
      <div className="tv-screen" style={{ position: 'relative' }}>
        <div className="tv-header">
          <span>
            Game<span style={{ color: 'var(--accent)' }}>Box</span>
            {state.status === 'paused' && <span style={{ color: 'var(--gold)' }}> — PAUSED</span>}
          </span>
          {state.summary.joinPin && <span className="dim">PIN {state.summary.joinPin}</span>}
        </div>
        {state.status === 'active' && state.activeSeats.length > 0 && (
          <TableTurnBanner seats={state.activeSeats} />
        )}
        {ui ? (
          <ui.TvView state={state} />
        ) : (
          <div className="tv-main">
            <div className="tv-board dim">No TV view registered for {state.summary.gameType}</div>
            <div className="tv-sidebar">
              <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
              <WinnerBanner state={state} />
            </div>
          </div>
        )}
        {/* Narration and the sound unlock sit above whatever board is showing,
            so a game UI never has to remember to render them. */}
        <TableChrome showSoundGate />
      </div>
    </TableProvider>
  );
}
