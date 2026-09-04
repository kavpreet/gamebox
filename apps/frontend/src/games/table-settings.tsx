import { useEffect, useState } from 'react';
import type { ClockMode, GameOptions } from '@gamebox/shared-types';
import { DEFAULT_GAME_OPTIONS } from '@gamebox/shared-types';
import { api, type GameTypeInfo } from '../api.js';

/**
 * Host-only lobby panel for how the table *feels*, as opposed to what the
 * rules are.
 *
 * These are deliberately per-game rather than per-account: the same group
 * wants a slow, hand-played Monopoly on a Sunday and a fast automatic one on a
 * weeknight, and manual mode changes what the other players have to do, so it
 * belongs to the table and not to whoever happens to be looking.
 */
export function TableSettings({
  gameId,
  typeInfo,
  isHost,
}: {
  gameId: string;
  typeInfo: GameTypeInfo | undefined;
  isHost: boolean;
}) {
  const [opts, setOpts] = useState<GameOptions | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api
      .gameOptions(gameId)
      .then(setOpts)
      .catch(() => setOpts({ ...DEFAULT_GAME_OPTIONS }));
  }, [gameId]);

  if (!opts) return null;

  const save = async (patch: Partial<GameOptions>) => {
    const optimistic = { ...opts, ...patch };
    setOpts(optimistic); // the toggles must feel instant; the server reconciles
    try {
      setOpts(await api.setGameOptions(gameId, patch));
      setError('');
    } catch (err) {
      setOpts(opts);
      setError((err as Error).message);
    }
  };

  const manualSupported = typeInfo?.supportsManual ?? false;

  if (!isHost) {
    return (
      <div className="card">
        <h3>Table settings</h3>
        <p className="dim small">
          {opts.manual ? 'Manual — you move your own pieces and confirm your own payments.' : 'Automatic moves.'}
          {opts.clock === 'off'
            ? ' No turn clock.'
            : ` ${opts.clock === 'hard' ? 'Timed' : 'Relaxed'} turns of ${opts.clockSeconds}s.`}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Table settings</h3>
        <button className="ghost" style={{ width: 'auto' }} onClick={() => setOpen(!open)}>
          {open ? 'Done' : 'Adjust'}
        </button>
      </div>

      {!open ? (
        <p className="dim small">
          {opts.manual ? '✋ Manual pieces' : '⚡ Automatic'} ·{' '}
          {opts.clock === 'off' ? 'no clock' : `${opts.clockSeconds}s ${opts.clock}`} ·{' '}
          {opts.animate ? `${opts.speed}× animation` : 'no animation'}
          {opts.perspective && ' · 3D'}
          {opts.sound && ' · sound'}
        </p>
      ) : (
        <>
          <label className="row between">
            <span>
              ✋ Manual pieces{' '}
              <span className="dim small">
                {manualSupported
                  ? 'move your own token, hand over your own money'
                  : 'not available for this game yet'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={opts.manual}
              disabled={!manualSupported}
              onChange={(e) => save({ manual: e.target.checked })}
            />
          </label>

          <label className="row between">
            <span>
              ⏱ Turn clock <span className="dim small">soft just shows the time; hard passes the turn</span>
            </span>
            <select
              style={{ width: 'auto' }}
              value={opts.clock}
              onChange={(e) => save({ clock: e.target.value as ClockMode })}
            >
              <option value="off">Off</option>
              <option value="soft">Soft</option>
              <option value="hard">Hard</option>
            </select>
          </label>

          {opts.clock !== 'off' && (
            <label className="row between">
              <span>Seconds per turn</span>
              <select
                style={{ width: 'auto' }}
                value={opts.clockSeconds}
                onChange={(e) => save({ clockSeconds: Number(e.target.value) })}
              >
                {[30, 45, 60, 90, 120, 180, 300].map((s) => (
                  <option key={s} value={s}>
                    {s}s
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="row between">
            <span>
              🎬 Play out moves <span className="dim small">walk tokens, narrate each step</span>
            </span>
            <input type="checkbox" checked={opts.animate} onChange={(e) => save({ animate: e.target.checked })} />
          </label>

          {opts.animate && (
            <label className="row between">
              <span>Pace</span>
              <select
                style={{ width: 'auto' }}
                value={opts.speed}
                onChange={(e) => save({ speed: Number(e.target.value) })}
              >
                <option value={0.5}>Slow</option>
                <option value={1}>Normal</option>
                <option value={1.5}>Brisk</option>
                <option value={2.5}>Fast</option>
              </select>
            </label>
          )}

          <label className="row between">
            <span>
              🎥 3D table <span className="dim small">tilt the board and turn it to whoever is up</span>
            </span>
            <input
              type="checkbox"
              checked={opts.perspective}
              onChange={(e) => save({ perspective: e.target.checked })}
            />
          </label>

          <label className="row between">
            <span>🔊 Sound</span>
            <input type="checkbox" checked={opts.sound} onChange={(e) => save({ sound: e.target.checked })} />
          </label>

          {error && <p className="error small">{error}</p>}
        </>
      )}
    </div>
  );
}
