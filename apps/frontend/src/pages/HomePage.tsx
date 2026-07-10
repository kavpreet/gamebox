import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GameSummary, RoomDTO } from '@gamebox/shared-types';
import { api, type GameTypeInfo } from '../api.js';

const STATUS_LABELS: Record<string, string> = {
  lobby: 'waiting to start',
  active: 'in progress',
  paused: 'paused',
  completed: 'finished',
};

export function HomePage() {
  const navigate = useNavigate();
  const [types, setTypes] = useState<GameTypeInfo[]>([]);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [rooms, setRooms] = useState<RoomDTO[]>([]);
  const [selectedType, setSelectedType] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.gameTypes().then((t) => {
      setTypes(t);
      if (t.length > 0) setSelectedType(t[0]!.slug);
    });
    api.myGames().then(setGames).catch(() => {});
    api.rooms().then(setRooms).catch(() => {});
  }, []);

  const createGame = async () => {
    setBusy(true);
    setError('');
    try {
      const game = await api.createGame(selectedType);
      navigate(`/game/${game.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const joinGame = async () => {
    setBusy(true);
    setError('');
    try {
      const game = await api.joinByPin(pin.trim());
      navigate(`/game/${game.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="card">
        <h2>Join a game</h2>
        <div className="row">
          <input
            className="grow"
            inputMode="numeric"
            placeholder="Enter PIN from the TV"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && pin && joinGame()}
          />
          <button onClick={joinGame} disabled={busy || !pin.trim()}>
            Join
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Start a new game</h2>
        <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
          {types.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.displayName} ({t.minPlayers}–{t.maxPlayers} players)
            </option>
          ))}
        </select>
        <button onClick={createGame} disabled={busy || !selectedType}>
          Create game
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {games.length > 0 && (
        <div className="card">
          <h2>My games</h2>
          {games.map((g) => (
            <Link key={g.id} to={`/game/${g.id}`}>
              <div className="row between" style={{ padding: '0.35rem 0' }}>
                <span>
                  {types.find((t) => t.slug === g.gameType)?.displayName ?? g.gameType}
                  <span className="dim small"> · {g.players.length} players</span>
                </span>
                <span className={`badge ${g.status === 'active' ? 'on' : ''}`}>
                  {STATUS_LABELS[g.status] ?? g.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {rooms.length > 0 && (
        <div className="card">
          <h2 className="small dim">TVs seen on this server</h2>
          {rooms.map((r) => (
            <div className="row between" key={r.id}>
              <span>
                📺 {r.name} <span className="dim small">({r.pairingCode})</span>
              </span>
              {r.activeGameId ? <Link to={`/game/${r.activeGameId}`}>showing a game</Link> : <span className="dim small">idle</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
