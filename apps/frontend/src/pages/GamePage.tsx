import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { RoomDTO, Seat, DisconnectOption } from '@gamebox/shared-types';
import { useSession } from '../auth-client.js';
import { api, type GameTypeInfo } from '../api.js';
import { getSocket, emitAck } from '../socket.js';
import { getGameUi } from '../games/registry.js';
import type { LiveState } from '../games/types.js';
import { seatName } from '../games/common.js';

interface VoteUpdate {
  gameId: string;
  targetSeat: Seat;
  options: DisconnectOption[];
  votes: Record<number, DisconnectOption>;
}

export function GamePage() {
  const { id: gameId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [state, setState] = useState<LiveState | null>(null);
  const [yourSeat, setYourSeat] = useState<Seat | null>(null);
  const [error, setError] = useState('');
  const [moveError, setMoveError] = useState('');
  const [vote, setVote] = useState<VoteUpdate | null>(null);
  const [voteEligible, setVoteEligible] = useState<{ seat: Seat; options: DisconnectOption[] } | null>(null);
  const moveErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      navigate(`/login?redirect=${encodeURIComponent(`/game/${gameId}`)}`, { replace: true });
      return;
    }
    if (!gameId) return;

    const socket = getSocket();

    const join = async () => {
      const res = await emitAck<{ ok: boolean; seat?: Seat; error?: string }>('game:join', { gameId });
      if (res.ok && res.seat !== undefined) {
        setYourSeat(res.seat);
      } else {
        setError(res.error ?? 'Could not join');
      }
    };

    const onState = (s: LiveState) => {
      if (s.gameId === gameId) {
        setState(s);
        setVoteEligible(null);
      }
    };
    const onVoteUpdate = (v: VoteUpdate) => v.gameId === gameId && setVote(v);
    const onVoteResolved = () => setVote(null);
    const onVoteEligible = (v: { gameId: string; seat: Seat; options: DisconnectOption[] }) =>
      v.gameId === gameId && setVoteEligible({ seat: v.seat, options: v.options });

    socket.on('game:state', onState);
    socket.on('vote:update', onVoteUpdate);
    socket.on('vote:resolved', onVoteResolved);
    socket.on('vote:eligible', onVoteEligible);
    socket.on('connect', join);
    join();

    return () => {
      socket.off('game:state', onState);
      socket.off('vote:update', onVoteUpdate);
      socket.off('vote:resolved', onVoteResolved);
      socket.off('vote:eligible', onVoteEligible);
      socket.off('connect', join);
    };
  }, [gameId, session, isPending, navigate]);

  const submitMove = useCallback(
    async (type: string, payload: unknown): Promise<string | null> => {
      const res = await emitAck<{ ok: boolean; error?: string }>('game:move', { gameId, type, payload });
      if (!res.ok) {
        setMoveError(res.error ?? 'Move rejected');
        if (moveErrorTimer.current) clearTimeout(moveErrorTimer.current);
        moveErrorTimer.current = setTimeout(() => setMoveError(''), 4000);
        return res.error ?? 'Move rejected';
      }
      return null;
    },
    [gameId],
  );

  if (error) {
    return (
      <div className="page">
        <div className="card center">
          <p className="error">{error}</p>
          <button onClick={() => navigate('/')}>Back home</button>
        </div>
      </div>
    );
  }
  if (!state || yourSeat === null) {
    return (
      <div className="page">
        <p className="dim center">Connecting…</p>
      </div>
    );
  }

  if (state.status === 'lobby') {
    return <Lobby state={state} isHost={state.summary.createdBy === session?.user.id} />;
  }

  if (state.status === 'discontinued') {
    return (
      <div className="page">
        <div className="card center">
          <p>This game's rules were updated on the server — this match can't continue. Start a new one!</p>
          <button onClick={() => navigate('/')}>Back home</button>
        </div>
      </div>
    );
  }

  const ui = getGameUi(state.summary.gameType);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {state.status === 'paused' && (
        <div className="card center" style={{ margin: '1rem' }}>
          <h3>Game paused</h3>
          <button onClick={() => emitAck('game:resume', { gameId })}>Resume</button>
        </div>
      )}
      {moveError && <p className="error center">{moveError}</p>}
      {ui ? (
        <ui.PlayerView state={state} yourSeat={yourSeat} submitMove={submitMove} />
      ) : (
        <p className="error center">No UI registered for {state.summary.gameType}</p>
      )}

      {voteEligible && !vote && (
        <div className="overlay" onClick={() => setVoteEligible(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3>{seatName(state.summary, voteEligible.seat)} disconnected</h3>
            <p className="dim">Call a vote on what to do?</p>
            <button onClick={() => emitAck('vote:call', { gameId, targetSeat: voteEligible.seat })}>
              Call a vote
            </button>
            <button className="ghost" onClick={() => setVoteEligible(null)}>
              Keep waiting
            </button>
          </div>
        </div>
      )}

      {vote && vote.targetSeat !== yourSeat && (
        <div className="overlay">
          <div className="card">
            <h3>{seatName(state.summary, vote.targetSeat)} disconnected — what should happen?</h3>
            <div className="row">
              {vote.options.map((o) => (
                <button
                  key={o}
                  className={vote.votes[yourSeat] === o ? '' : 'secondary'}
                  onClick={() => emitAck('vote:cast', { gameId, option: o })}
                >
                  {o === 'skip' ? 'Skip their turns' : o === 'pause' ? 'Pause the game' : 'Remove them'}
                </button>
              ))}
            </div>
            <p className="dim small">{Object.keys(vote.votes).length} vote(s) cast</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Lobby({ state, isHost }: { state: LiveState; isHost: boolean }) {
  const navigate = useNavigate();
  const gameId = state.gameId;
  const summary = state.summary;
  const [types, setTypes] = useState<GameTypeInfo[]>([]);
  const [rooms, setRooms] = useState<RoomDTO[]>([]);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');

  const typeInfo = types.find((t) => t.slug === summary.gameType);
  const joinUrl = `${window.location.origin}/join/${summary.joinPin}`;

  useEffect(() => {
    api.gameTypes().then(setTypes).catch(() => {});
    api.rooms().then(setRooms).catch(() => {});
  }, []);

  useEffect(() => {
    if (summary.joinPin) {
      QRCode.toDataURL(joinUrl, { width: 220, margin: 1, color: { dark: '#0f1220', light: '#eef0ff' } }).then(setQr);
    }
  }, [joinUrl, summary.joinPin]);

  const start = async () => {
    try {
      await api.startGame(gameId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setTeam = async (seat: Seat, team: number | null) => {
    try {
      await api.setTeams(gameId, { [seat]: team });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const canStart = typeInfo ? summary.players.length >= typeInfo.minPlayers : summary.players.length >= 2;
  const teamsAllowed = typeInfo && typeInfo.teams !== 'none';

  return (
    <div className="page">
      <div className="card center">
        <h2>{typeInfo?.displayName ?? summary.gameType}</h2>
        <p className="dim">Join with PIN</p>
        <div className="pin-display">{summary.joinPin}</div>
        {qr && <img src={qr} alt="Join QR" style={{ margin: '0 auto', borderRadius: 10 }} />}
        <p className="dim small">{joinUrl}</p>
      </div>

      <div className="card">
        <h3>Players ({summary.players.length}{typeInfo ? `/${typeInfo.maxPlayers}` : ''})</h3>
        {summary.players.map((p) => (
          <div className="row between" key={p.seat}>
            <span>
              <span className={`token seat-color-${p.seat % 6}`} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, marginRight: 8 }} />
              {p.displayName}
            </span>
            {teamsAllowed && isHost ? (
              <select
                value={p.team ?? ''}
                onChange={(e) => setTeam(p.seat, e.target.value === '' ? null : Number(e.target.value))}
                style={{ width: 'auto' }}
              >
                <option value="">No team</option>
                {[0, 1, 2].map((t) => (
                  <option key={t} value={t}>
                    Team {t + 1}
                  </option>
                ))}
              </select>
            ) : (
              p.team !== null && <span className="badge">Team {p.team + 1}</span>
            )}
          </div>
        ))}
      </div>

      {rooms.length > 0 && (
        <div className="card">
          <h3>Show on TV</h3>
          {rooms.map((r) => (
            <div className="row between" key={r.id}>
              <span>📺 {r.name}</span>
              {r.activeGameId === gameId ? (
                <span className="badge on">showing this game</span>
              ) : (
                <button
                  className="secondary"
                  onClick={() => api.assignRoom(r.pairingCode, gameId).then(() => api.rooms().then(setRooms))}
                >
                  Cast here
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="error center">{error}</p>}

      {isHost ? (
        <>
          <button className="big" onClick={start} disabled={!canStart}>
            {canStart ? 'Start game' : `Waiting for players (need ${typeInfo?.minPlayers ?? 2})`}
          </button>
          <button className="ghost" onClick={() => api.abandonGame(gameId).then(() => navigate('/'))}>
            Cancel this game
          </button>
        </>
      ) : (
        <p className="dim center">Waiting for the host to start…</p>
      )}
    </div>
  );
}
