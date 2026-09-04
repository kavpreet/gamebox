import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { RoomDTO, Seat, DisconnectOption } from '@gamebox/shared-types';
import { SEAT_COLOR_PALETTE, iconPaletteFor, defaultSeatColor } from '@gamebox/shared-types';
import { useSession } from '../auth-client.js';
import { api, type GameTypeInfo } from '../api.js';
import { getSocket, emitAck } from '../socket.js';
import { getGameUi } from '../games/registry.js';
import type { LiveState } from '../games/types.js';
import { seatName, SeatDot } from '../games/common.js';
import { HouseRules } from '../components/HouseRules.js';
import { TableProvider } from '../games/table.js';
import { TableChrome } from '../games/chrome.js';
import { TableSettings } from '../games/table-settings.js';

interface VoteUpdate {
  gameId: string;
  targetSeat: Seat;
  options: DisconnectOption[];
  votes: Record<number, DisconnectOption>;
}

interface TakebackUpdate {
  gameId: string;
  requestedBy: Seat;
  moveType: string | null;
  voters: Seat[];
  ballots: Record<number, boolean>;
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
  const [confirmClose, setConfirmClose] = useState(false);
  const [takeback, setTakeback] = useState<TakebackUpdate | null>(null);
  const [takebackNote, setTakebackNote] = useState('');
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
    const onTakeback = (t: TakebackUpdate) => {
      if (t.gameId === gameId) setTakeback(t);
    };
    const onTakebackResolved = (r: { gameId: string; approved: boolean }) => {
      if (r.gameId !== gameId) return;
      setTakeback(null);
      setTakebackNote(r.approved ? 'Take-back agreed — the move was undone.' : 'The table said no.');
      setTimeout(() => setTakebackNote(''), 4000);
    };
    const onVoteUpdate = (v: VoteUpdate) => v.gameId === gameId && setVote(v);
    const onVoteResolved = () => setVote(null);
    const onVoteEligible = (v: { gameId: string; seat: Seat; options: DisconnectOption[] }) =>
      v.gameId === gameId && setVoteEligible({ seat: v.seat, options: v.options });

    socket.on('game:state', onState);
    socket.on('vote:update', onVoteUpdate);
    socket.on('vote:resolved', onVoteResolved);
    socket.on('vote:eligible', onVoteEligible);
    socket.on('takeback:update', onTakeback);
    socket.on('takeback:resolved', onTakebackResolved);
    socket.on('connect', join);
    join();

    return () => {
      socket.off('game:state', onState);
      socket.off('vote:update', onVoteUpdate);
      socket.off('vote:resolved', onVoteResolved);
      socket.off('vote:eligible', onVoteEligible);
      socket.off('takeback:update', onTakeback);
      socket.off('takeback:resolved', onTakebackResolved);
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
    return <Lobby state={state} isHost={state.summary.createdBy === session?.user.id} yourSeat={yourSeat} />;
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

  if (state.status === 'abandoned') {
    return (
      <div className="page">
        <div className="card center">
          <h3>Game closed</h3>
          <p className="dim">The host ended this game.</p>
          <button onClick={() => navigate('/')}>Back home</button>
        </div>
      </div>
    );
  }

  const isHost = state.summary.createdBy === session?.user.id;
  const ui = getGameUi(state.summary.gameType);
  return (
    <TableProvider state={state} yourSeat={yourSeat}>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {state.status === 'paused' && (
        <div className="card center" style={{ margin: '1rem' }}>
          <h3>Game paused</h3>
          <button onClick={() => emitAck('game:resume', { gameId })}>Resume</button>
        </div>
      )}
      {moveError && <p className="error center">{moveError}</p>}
      {takebackNote && <p className="dim center">{takebackNote}</p>}

      {/* A misclick is permanent in a way a mis-placed counter never is; this
          is the table's own remedy for it, with the same social safeguard. */}
      {state.status === 'active' && !takeback && (
        <div className="center" style={{ padding: '0 1rem' }}>
          <button
            className="ghost"
            style={{ width: 'auto' }}
            onClick={async () => {
              const res = await emitAck<{ ok: boolean; error?: string; applied?: boolean }>(
                'takeback:call',
                { gameId },
              );
              if (!res.ok) {
                setTakebackNote(res.error ?? 'Cannot take that back');
                setTimeout(() => setTakebackNote(''), 4000);
              } else if (!res.applied) {
                setTakebackNote('Asked the table…');
              }
            }}
          >
            ↩ Take back my last move
          </button>
        </div>
      )}
      {ui ? (
        <ui.PlayerView state={state} yourSeat={yourSeat} submitMove={submitMove} />
      ) : (
        <p className="error center">No UI registered for {state.summary.gameType}</p>
      )}

      <div className="row center-h" style={{ padding: '0 1rem 1.2rem' }}>
        {state.status === 'completed' ? (
          <button className="secondary" onClick={() => navigate('/')}>Back home</button>
        ) : isHost ? (
          <button className="ghost small" onClick={() => setConfirmClose(true)}>
            ✕ End this game for everyone
          </button>
        ) : null}
      </div>

      {confirmClose && (
        <div className="overlay" onClick={() => setConfirmClose(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3>End this game?</h3>
            <p className="dim">
              The match ends for everyone and any TV showing it goes back to its idle screen.
              This can't be undone.
            </p>
            <button
              style={{ background: 'var(--danger)' }}
              onClick={() => api.abandonGame(gameId!).then(() => navigate('/'))}
            >
              End game
            </button>
            <button className="ghost" onClick={() => setConfirmClose(false)}>Keep playing</button>
          </div>
        </div>
      )}

      {takeback && takeback.requestedBy !== yourSeat && takeback.voters.includes(yourSeat) && (
        <div className="overlay">
          <div className="card">
            <h3>
              {seatName(state.summary, takeback.requestedBy)} wants to take back their last move
              {takeback.moveType ? ` (${takeback.moveType.toLowerCase().replace(/_/g, ' ')})` : ''}
            </h3>
            <p className="dim">Everyone else has to agree — one “no” is enough.</p>
            <div className="row">
              <button onClick={() => emitAck('takeback:vote', { gameId, approve: true })}>Allow it</button>
              <button
                className="secondary"
                onClick={() => emitAck('takeback:vote', { gameId, approve: false })}
              >
                No, it stands
              </button>
            </div>
            <p className="dim small">
              {Object.values(takeback.ballots).filter(Boolean).length} of {takeback.voters.length} agreed
            </p>
          </div>
        </div>
      )}

      {takeback && takeback.requestedBy === yourSeat && (
        <div className="overlay">
          <div className="card center">
            <h3>Asking the table…</h3>
            <p className="dim">
              {Object.values(takeback.ballots).filter(Boolean).length} of {takeback.voters.length} have agreed
              so far.
            </p>
          </div>
        </div>
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

      <TableChrome />
    </div>
    </TableProvider>
  );
}

function Lobby({ state, isHost, yourSeat }: { state: LiveState; isHost: boolean; yourSeat: Seat | null }) {
  const navigate = useNavigate();
  const gameId = state.gameId;
  const summary = state.summary;
  const [types, setTypes] = useState<GameTypeInfo[]>([]);
  const [rooms, setRooms] = useState<RoomDTO[]>([]);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [appearanceError, setAppearanceError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const me = summary.players.find((p) => p.seat === yourSeat) ?? null;
  const takenColors = new Set(
    summary.players.filter((p) => p.seat !== yourSeat).map((p) => p.color ?? defaultSeatColor(p.seat)),
  );
  const takenIcons = new Set(summary.players.filter((p) => p.seat !== yourSeat && p.icon).map((p) => p.icon));

  const setAppearance = async (color: string | null, icon: string | null) => {
    setAppearanceError('');
    try {
      await api.setAppearance(gameId, color, icon);
    } catch (err) {
      setAppearanceError((err as Error).message);
    }
  };

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
            <span className="row" style={{ gap: 8 }}>
              <SeatDot summary={summary} seat={p.seat} size={20} />
              {p.displayName}
              {p.seat === yourSeat && (
                <button className="ghost small" onClick={() => setPickerOpen((o) => !o)} style={{ padding: '0.2em 0.6em' }}>
                  {pickerOpen ? 'Done' : 'Customize'}
                </button>
              )}
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

      {pickerOpen && me && (
        <div className="card">
          <h3>Your look</h3>
          <p className="dim small">Colors and icons must be unique — taken ones are dimmed.</p>
          <p className="dim small" style={{ marginTop: -6 }}>Color</p>
          <div className="row" style={{ gap: 8 }}>
            {SEAT_COLOR_PALETTE.map((c) => {
              const taken = takenColors.has(c);
              return (
                <div
                  key={c}
                  onClick={taken ? undefined : () => setAppearance(c, me.icon)}
                  title={c}
                  style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: c,
                    boxShadow: 'inset 0 -2px 3px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.4)',
                    border: me.color === c ? '3px solid var(--gold)' : '2px solid transparent',
                    cursor: taken ? 'not-allowed' : 'pointer',
                    opacity: taken ? 0.25 : 1,
                  }}
                />
              );
            })}
          </div>
          <p className="dim small">Icon</p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button
              className={me.icon === null ? '' : 'secondary'}
              onClick={() => setAppearance(me.color, null)}
            >
              No icon
            </button>
            {iconPaletteFor(summary.gameType).map((icon) => {
              const taken = takenIcons.has(icon);
              return (
                <button
                  key={icon}
                  disabled={taken}
                  className={me.icon === icon ? '' : 'secondary'}
                  style={{ fontSize: '1.2rem', padding: '0.4em 0.6em' }}
                  onClick={() => setAppearance(me.color, icon)}
                >
                  {icon}
                </button>
              );
            })}
          </div>
          {appearanceError && <p className="error small">{appearanceError}</p>}
        </div>
      )}

      <HouseRules
        gameId={gameId}
        defs={typeInfo?.options ?? []}
        options={summary.options}
        isHost={isHost}
      />
      <TableSettings gameId={gameId} typeInfo={typeInfo} isHost={isHost} />

      {rooms.length > 0 && (
        <div className="card">
          <h3>Show on TV</h3>
          {rooms.map((r) => (
            <div className="row between" key={r.id}>
              <span>📺 {r.name}</span>
              {r.activeGameId === gameId ? (
                <span className="row" style={{ gap: 6 }}>
                  <span className="badge on">showing this game</span>
                  <button
                    className="ghost"
                    onClick={() => api.assignRoom(r.pairingCode, null).then(() => api.rooms().then(setRooms))}
                  >
                    Disconnect
                  </button>
                </span>
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
