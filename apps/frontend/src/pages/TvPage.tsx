import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { RoomDTO } from '@gamebox/shared-types';
import { getSocket, emitAck } from '../socket.js';
import { getGameUi } from '../games/registry.js';
import type { LiveState } from '../games/types.js';
import { SeatTokens, WinnerBanner } from '../games/common.js';

/**
 * The kiosk page (plan §5.7): boots to a stable ROOM url — /tv?room=<code> —
 * never a game url. Shows idle screen until a phone casts a game to this room,
 * then follows rooms.active_game_id pushed over the socket.
 */
export function TvPage() {
  const [params] = useSearchParams();
  const roomCode = (params.get('room') ?? 'TV').toUpperCase();
  const [room, setRoom] = useState<RoomDTO | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [qr, setQr] = useState('');

  useEffect(() => {
    const socket = getSocket();

    const watch = async () => {
      const res = await emitAck<{ ok: boolean; room?: RoomDTO }>('tv:watch', { room: roomCode });
      if (res.ok && res.room) {
        setRoom(res.room);
        if (!res.room.activeGameId) setState(null);
      }
    };

    const onTvState = (s: LiveState) => setState(s);
    const onAssigned = (a: { pairingCode: string; gameId: string | null }) => {
      if (a.pairingCode === roomCode) {
        if (!a.gameId) setState(null);
        setRoom((r) => (r ? { ...r, activeGameId: a.gameId } : r));
      }
    };

    socket.on('tv:state', onTvState);
    socket.on('room:assigned', onAssigned);
    socket.on('connect', watch);
    watch();

    return () => {
      socket.off('tv:state', onTvState);
      socket.off('room:assigned', onAssigned);
      socket.off('connect', watch);
    };
  }, [roomCode]);

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
    <div className="tv-screen">
      <div className="tv-header">
        <span>
          Game<span style={{ color: 'var(--accent)' }}>Box</span>
          {state.status === 'paused' && <span style={{ color: 'var(--gold)' }}> — PAUSED</span>}
        </span>
        {state.summary.joinPin && <span className="dim">PIN {state.summary.joinPin}</span>}
      </div>
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
    </div>
  );
}
