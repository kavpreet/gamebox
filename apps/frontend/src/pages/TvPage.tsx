import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { RoomDTO } from '@gamebox/shared-types';
import { getSocket, emitAck } from '../socket.js';
import { getGameUi } from '../games/registry.js';
import type { LiveState } from '../games/types.js';
import { SeatTokens, SeatDot, WinnerBanner, TvFitContext, type TvFit } from '../games/common.js';
import { api, type GameTypeInfo } from '../api.js';

const FIT_STORAGE_KEY = 'gamebox-tv-fit';

function loadFit(): TvFit {
  return window.localStorage.getItem(FIT_STORAGE_KEY) === 'stretch' ? 'stretch' : 'fit';
}

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
  const [types, setTypes] = useState<GameTypeInfo[]>([]);
  const [fit, setFit] = useState<TvFit>(loadFit);

  const setAndStoreFit = (f: TvFit) => {
    setFit(f);
    window.localStorage.setItem(FIT_STORAGE_KEY, f);
  };

  useEffect(() => {
    api.gameTypes().then(setTypes).catch(() => {});
  }, []);

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

  if (!state || state.status === 'abandoned') {
    return (
      <div className="idle-screen">
        <h1 className="wordmark">GameBox</h1>
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
    const typeInfo = types.find((t) => t.slug === state.summary.gameType);
    return (
      <div className="idle-screen">
        <h1 className="wordmark" style={{ fontSize: '4.5vmin' }}>{typeInfo?.displayName ?? state.summary.gameType}</h1>
        {typeInfo?.description && (
          <p className="dim" style={{ fontSize: '2.2vmin', marginTop: '-1.4rem', maxWidth: '60vmin' }}>{typeInfo.description}</p>
        )}
        <div className="pin-display" style={{ fontSize: '9vmin' }}>
          {state.summary.joinPin}
        </div>
        {qr && <img src={qr} alt="Join QR" style={{ borderRadius: 16, width: '26vmin', boxShadow: '0 10px 40px rgba(3,5,16,0.6)' }} />}
        <p className="dim" style={{ fontSize: '2vmin', marginTop: '-1rem' }}>scan with your phone, or enter the PIN at {window.location.origin}</p>
        <div style={{ display: 'flex', gap: '2vmin', flexWrap: 'wrap', justifyContent: 'center' }}>
          {state.summary.players.map((p) => (
            <div key={p.seat} className="tv-player-chip">
              <SeatDot summary={state.summary} seat={p.seat} />
              {p.displayName}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const ui = getGameUi(state.summary.gameType);
  return (
    <TvFitContext.Provider value={fit}>
      <div className="tv-screen">
        <div className="tv-header">
          <span className="logo">
            <span className="wordmark">GameBox</span>
            {state.status === 'paused' && <span style={{ color: 'var(--gold)' }}> — PAUSED</span>}
          </span>
          <span className="row" style={{ gap: '1.4vmin' }}>
            {state.summary.joinPin && <span className="dim">join with PIN <strong style={{ color: 'var(--gold)' }}>{state.summary.joinPin}</strong></span>}
            <span className="row" style={{ gap: 0, fontSize: '1.6vmin' }}>
              <button
                className={fit === 'fit' ? 'secondary' : 'ghost'}
                style={{ padding: '0.3em 0.7em', fontSize: 'inherit', borderRadius: '999px 0 0 999px' }}
                onClick={() => setAndStoreFit('fit')}
                title="Keep the board's proportions, letterbox the rest"
              >
                Fit
              </button>
              <button
                className={fit === 'stretch' ? 'secondary' : 'ghost'}
                style={{ padding: '0.3em 0.7em', fontSize: 'inherit', borderRadius: '0 999px 999px 0' }}
                onClick={() => setAndStoreFit('stretch')}
                title="Stretch the board to fill the whole area"
              >
                Stretch
              </button>
            </span>
          </span>
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
    </TvFitContext.Provider>
  );
}
