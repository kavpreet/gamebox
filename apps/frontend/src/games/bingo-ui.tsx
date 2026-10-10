import { useEffect, useRef, useState } from 'react';
import {
  PRESETS,
  PRIZES,
  FREE,
  ballLabel,
  type BingoConfig,
  type BingoMove,
  type BingoView,
  type Card,
  type LogEntry,
} from '@gamebox/game-bingo';
import type { GameSummary } from '@gamebox/shared-types';
import type { PlayerViewProps, TvViewProps, GameUi, LiveState } from './types.js';
import { seatName, WinnerBanner } from './common.js';

const LETTER_COLORS = ['#4a7cf7', '#e94560', '#eef0ff', '#2ec4b6', '#f5a623'];
const DAB = '#7c5cff';

function ballColor(balls: 75 | 90, n: number): string {
  if (balls === 90) return ['#4a7cf7', '#e94560', '#2ec4b6', '#f5a623', '#a06cd5'][Math.floor(((n - 1) / 90) * 5)]!;
  return LETTER_COLORS[Math.min(4, Math.floor((n - 1) / 15))]!;
}

// ── shared bits ──────────────────────────────────────────────────────────────

/** Local deadline for the next auto call, re-anchored whenever a fresh view arrives. */
function useCountdown(view: BingoView | null): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    setDeadline(view?.msUntilNext != null ? Date.now() + view.msUntilNext : null);
  }, [view?.msUntilNext, view?.calls.length, view?.autoPaused, view?.nextCallAt]);
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - Date.now());
}

/** Optional voice caller (needs a tap first — browsers block unprompted speech). */
function useAnnouncer(view: BingoView | null, enabled: boolean) {
  const lastSpoken = useRef<number>(view?.calls.length ?? 0);
  useEffect(() => {
    if (!view) return;
    const count = view.calls.length;
    if (enabled && count > lastSpoken.current && 'speechSynthesis' in window) {
      const n = view.calls[count - 1]!;
      const digits = n >= 10 ? `, ${String(n).split('').join(' ')}` : '';
      const text = view.config.balls === 75 ? `${ballLabel(75, n)}` : `${n}${digits}`;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
    lastSpoken.current = count;
  }, [view?.calls.length, enabled]);
}

function Ball({ balls, n, size = 44 }: { balls: 75 | 90; n: number; size?: number }) {
  const label = balls === 75 ? ballLabel(75, n).split(' ') : [String(n)];
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: `radial-gradient(circle at 35% 30%, #fff 0 18%, ${ballColor(balls, n)} 60%)`,
        color: '#11131f', fontWeight: 800, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', lineHeight: 1,
        boxShadow: '0 2px 6px rgba(0,0,0,.4)',
      }}
    >
      {label.length === 2 && <span style={{ fontSize: size * 0.22 }}>{label[0]}</span>}
      <span style={{ fontSize: size * (label.length === 2 ? 0.38 : 0.42) }}>{label.at(-1)}</span>
    </div>
  );
}

function RecentBalls({ view, size, count = 6 }: { view: BingoView; size: number; count?: number }) {
  const calls = view.calls;
  if (calls.length === 0) return <p className="dim center">No balls yet…</p>;
  const recent = calls.slice(-count).reverse();
  return (
    <div className="row" style={{ justifyContent: 'center', alignItems: 'center' }}>
      {recent.map((n, i) => (
        <div key={calls.length - i} style={{ opacity: i === 0 ? 1 : 0.55 }}>
          <Ball balls={view.config.balls} n={n} size={i === 0 ? size : size * 0.55} />
        </div>
      ))}
    </div>
  );
}

/** Caller's board: every number, called ones lit. */
function CalledBoard({ view, cellSize }: { view: BingoView; cellSize: string }) {
  const called = new Set(view.calls);
  const last = view.calls.at(-1);
  const balls = view.config.balls;
  const rows: { label?: string; nums: number[] }[] =
    balls === 75
      ? ['B', 'I', 'N', 'G', 'O'].map((label, r) => ({ label, nums: Array.from({ length: 15 }, (_, i) => r * 15 + i + 1) }))
      : Array.from({ length: 9 }, (_, r) => ({ nums: Array.from({ length: 10 }, (_, i) => r * 10 + i + 1) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: 'flex', gap: 3 }}>
          {row.label && (
            <div style={{ width: cellSize, height: cellSize, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: LETTER_COLORS[r] }}>
              {row.label}
            </div>
          )}
          {row.nums.map((n) => (
            <div
              key={n}
              style={{
                width: cellSize, height: cellSize, borderRadius: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: `calc(${cellSize} * 0.45)`, fontWeight: called.has(n) ? 800 : 400,
                background: n === last ? 'var(--gold)' : called.has(n) ? ballColor(balls, n) : 'var(--bg-raised)',
                color: called.has(n) ? '#11131f' : 'var(--text-dim)',
              }}
            >
              {n}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function LogFeed({ log, summary, limit }: { log: LogEntry[]; summary: GameSummary; limit: number }) {
  const items = log.filter((e) => e.kind !== 'call').slice(-limit).reverse();
  if (items.length === 0) return null;
  const color = { win: '#2ec4b6', bogey: '#ff5470', info: undefined, call: undefined } as const;
  return (
    <div>
      {items.map((e, i) => (
        <p key={i} className="small" style={{ margin: '2px 0', color: color[e.kind] }}>
          {e.seat !== undefined && <strong>{seatName(summary, e.seat)} </strong>}
          {e.text}
        </p>
      ))}
    </div>
  );
}

function PrizeBoard({ view, summary }: { view: BingoView; summary: GameSummary }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {view.prizes.map((p) => (
        <div key={p.id} className="row between small" style={{ opacity: p.wonAtCall !== null ? 0.75 : 1 }}>
          <span>
            {p.wonAtCall !== null ? '🏅' : '⬜'} <strong>{p.name}</strong> <span className="dim">· {p.points}</span>
          </span>
          <span className="dim">{p.winners.map((w) => seatName(summary, w.seat)).join(' & ')}</span>
        </div>
      ))}
    </div>
  );
}

function Scoreboard({ view, summary, big }: { view: BingoView; summary: GameSummary; big?: boolean }) {
  const players = summary.players.filter((p) => view.order.includes(p.seat));
  const sorted = [...players].sort((a, b) => (view.scores[b.seat] ?? 0) - (view.scores[a.seat] ?? 0));
  return (
    <>
      {sorted.map((p) => (
        <div key={p.seat} className={big ? `tv-player-chip ${view.caller === p.seat ? 'active' : ''}` : 'row between small'}>
          {big && <span className={`token seat-color-${p.seat % 6}`} />}
          <span className="grow">
            {p.displayName}
            {view.caller === p.seat && ' 🎤'}
            {(view.bogeys[p.seat] ?? 0) > 0 && <span className="dim small"> · {view.bogeys[p.seat]} bogey</span>}
          </span>
          <strong>{view.scores[p.seat] ?? 0}</strong>
        </div>
      ))}
    </>
  );
}

function configSummary(c: BingoConfig): string {
  const mode = c.callMode === 'auto' ? `auto every ${c.intervalSec}s` : 'round-robin calling';
  return `${c.balls}-ball · ${mode} · ${c.cardsPerPlayer} card${c.cardsPerPlayer > 1 ? 's' : ''} each · bogey −${c.penalty}`;
}

// ── setup (host) ─────────────────────────────────────────────────────────────

function SetupPanel({ view, isHost, submitMove, summary }: {
  view: BingoView;
  isHost: boolean;
  submitMove: PlayerViewProps['submitMove'];
  summary: GameSummary;
}) {
  const cfg = view.config;
  const send = (next: BingoConfig) => void submitMove('CONFIGURE', { config: next });
  const enabled = new Map(cfg.prizes.map((p) => [p.id, p.points]));

  if (!isHost) {
    return (
      <div className="card">
        <h3>Waiting for {seatName(summary, view.host)} to start…</h3>
        <p className="dim small">{configSummary(cfg)}</p>
        <PrizeBoard view={{ ...view, prizes: cfg.prizes.map((p) => ({ id: p.id, name: PRIZES.find((d) => d.id === p.id)!.name, points: p.points, winners: [], wonAtCall: null })) }} summary={summary} />
      </div>
    );
  }

  const setBalls = (balls: 75 | 90) => {
    if (balls === cfg.balls) return;
    const preset = PRESETS.find((p) => p.balls === balls)!;
    send({ ...cfg, balls, prizes: preset.prizes.map((id) => ({ id, points: PRIZES.find((d) => d.id === id)!.defaultPoints })) });
  };
  const togglePrize = (id: string) => {
    const def = PRIZES.find((d) => d.id === id)!;
    const has = enabled.has(id);
    let prizes = has ? cfg.prizes.filter((p) => p.id !== id) : [...cfg.prizes, { id, points: def.defaultPoints }];
    if (id === 'house' && has) prizes = prizes.filter((p) => p.id !== 'house2');
    if (id === 'house2' && !has && !enabled.has('house')) prizes = [...prizes, { id: 'house', points: 50 }];
    // keep the catalogue order so the prize board reads naturally
    const order = PRIZES.map((d) => d.id);
    send({ ...cfg, prizes: prizes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) });
  };
  const setPoints = (id: string, points: number) =>
    send({ ...cfg, prizes: cfg.prizes.map((p) => (p.id === id ? { ...p, points } : p)) });
  const clampInt = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

  return (
    <div className="card">
      <h3>Set up the game</h3>

      <div className="row">
        <span className="grow">Balls</span>
        {([75, 90] as const).map((b) => (
          <button key={b} className={cfg.balls === b ? '' : 'secondary'} onClick={() => setBalls(b)}>
            {b === 75 ? '1–75 (5×5)' : '1–90 (tambola)'}
          </button>
        ))}
      </div>

      <div className="row">
        <span className="grow">Calling</span>
        <button className={cfg.callMode === 'auto' ? '' : 'secondary'} onClick={() => send({ ...cfg, callMode: 'auto' })}>Auto</button>
        <button className={cfg.callMode === 'roundRobin' ? '' : 'secondary'} onClick={() => send({ ...cfg, callMode: 'roundRobin' })}>Take turns</button>
      </div>

      {cfg.callMode === 'auto' && (
        <div className="row">
          <span className="grow">Seconds between balls</span>
          <select value={cfg.intervalSec} onChange={(e) => send({ ...cfg, intervalSec: Number(e.target.value) })}>
            {[3, 4, 5, 6, 8, 10, 12, 15, 20, 30].map((s) => <option key={s} value={s}>{s}s</option>)}
          </select>
        </div>
      )}

      <div className="row">
        <span className="grow">Cards per player</span>
        <select value={cfg.cardsPerPlayer} onChange={(e) => send({ ...cfg, cardsPerPlayer: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="row">
        <span className="grow">Bogey penalty (false claim)</span>
        <input
          type="number" min={0} max={1000} defaultValue={cfg.penalty} key={`pen-${cfg.penalty}`} style={{ width: 80 }}
          onBlur={(e) => { const v = clampInt(e.target.value, 0, 1000); if (v !== cfg.penalty) send({ ...cfg, penalty: v }); }}
        />
      </div>

      <div className="row small">
        <span className="dim">Presets:</span>
        {PRESETS.filter((p) => p.balls === cfg.balls).map((p) => (
          <button key={p.name} className="secondary" onClick={() => send({ ...cfg, prizes: p.prizes.map((id) => ({ id, points: PRIZES.find((d) => d.id === id)!.defaultPoints })) })}>
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {PRIZES.filter((d) => d.balls === cfg.balls).map((d) => (
          <div key={d.id} className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={enabled.has(d.id)} onChange={() => togglePrize(d.id)} style={{ width: 'auto' }} />
            <span className="grow" onClick={() => togglePrize(d.id)} style={{ cursor: 'pointer' }}>
              <strong>{d.name}</strong> <span className="dim small">— {d.description}</span>
            </span>
            {enabled.has(d.id) && (
              <input
                type="number" min={0} max={1000} style={{ width: 70 }}
                defaultValue={enabled.get(d.id)} key={`${d.id}-${enabled.get(d.id)}`}
                onBlur={(e) => { const v = clampInt(e.target.value, 0, 1000); if (v !== enabled.get(d.id)) setPoints(d.id, v); }}
              />
            )}
          </div>
        ))}
      </div>

      <button disabled={cfg.prizes.length === 0} onClick={() => void submitMove('START', {})}>Start — eyes down!</button>
    </div>
  );
}

// ── player's card ────────────────────────────────────────────────────────────

function CardGrid({ card, marks, balls, called, hints, onTap }: {
  card: Card;
  marks: number[];
  balls: 75 | 90;
  called: Set<number>;
  hints: boolean;
  onTap: (n: number) => void;
}) {
  const marked = new Set(marks);
  const cols = card.cells[0]!.length;
  return (
    <div>
      {balls === 75 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, marginBottom: 4 }}>
          {['B', 'I', 'N', 'G', 'O'].map((l, i) => (
            <div key={l} className="center" style={{ fontWeight: 800, color: LETTER_COLORS[i] }}>{l}</div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: balls === 75 ? 4 : 3 }}>
        {card.cells.flat().map((n, i) => {
          if (n === null) return <div key={i} style={{ background: '#141830', borderRadius: 6, aspectRatio: '1' }} />;
          const free = n === FREE;
          const isMarked = free || marked.has(n);
          const hinted = hints && !isMarked && called.has(n);
          return (
            <button
              key={i}
              disabled={free}
              onClick={() => onTap(n)}
              style={{
                aspectRatio: '1', padding: 0, minWidth: 0, borderRadius: 6,
                fontSize: balls === 75 ? '1.15rem' : '0.95rem', fontWeight: 700,
                background: isMarked ? DAB : '#f7f3e8',
                color: isMarked ? '#fff' : '#11131f',
                outline: hinted ? '3px solid var(--gold)' : undefined,
                outlineOffset: -3,
                position: 'relative',
              }}
            >
              {free ? '★' : n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Auto mode has no server clock: one connected phone submits DRAW when due (others back it up). */
function useAutoDriver(state: LiveState<BingoView, BingoMove>, yourSeat: number, submitMove: PlayerViewProps['submitMove']) {
  const view = state.view;
  const callCount = view?.calls.length ?? 0;
  useEffect(() => {
    if (!view || state.status !== 'active' || view.phase !== 'playing') return;
    if (view.config.callMode !== 'auto' || view.autoPaused || view.msUntilNext === null) return;
    const connected = state.summary.players.filter((p) => p.connected && view.order.includes(p.seat)).map((p) => p.seat);
    const rank = connected.indexOf(yourSeat);
    if (rank === -1) return;
    const delay = view.msUntilNext + 150 + rank * 2500; // backups wait a little longer
    const t = setTimeout(() => void submitMove('DRAW', { at: callCount }), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callCount, view?.nextCallAt, view?.autoPaused, state.status, yourSeat]);
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<BingoView, BingoMove>) {
  const view = state.view;
  const remaining = useCountdown(view);
  const [voice, setVoice] = useState(false);
  const [hints, setHints] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  useAnnouncer(view, voice);
  useAutoDriver(state, yourSeat, submitMove);
  if (!view) return null;

  const isHost = view.host === yourSeat;
  if (view.phase === 'setup') {
    return (
      <div className="page">
        <SetupPanel view={view} isHost={isHost} submitMove={submitMove} summary={state.summary} />
      </div>
    );
  }

  const called = new Set(view.calls);
  const mine = view.yourCards;
  const playing = view.phase === 'playing' && state.status === 'active';
  const myTurnToCall = view.config.callMode === 'roundRobin' && view.caller === yourSeat;

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <strong>Ball {view.calls.length}/{view.config.balls}</strong>
          <span className="row small">
            <button className="ghost" onClick={() => setVoice((v) => !v)} title="Read numbers aloud">{voice ? '🔊' : '🔇'}</button>
            <strong>You: {view.scores[yourSeat] ?? 0}</strong>
          </span>
        </div>
        {state.status === 'completed' && <WinnerBanner state={state} />}
        <RecentBalls view={view} size={72} />
        {playing && view.config.callMode === 'auto' && (
          <p className="dim small center">
            {view.autoPaused ? '⏸ Calling paused' : remaining !== null ? `Next ball in ${Math.ceil(remaining / 1000)}s` : ''}
          </p>
        )}
        {playing && view.config.callMode === 'roundRobin' && (
          myTurnToCall ? (
            <button onClick={() => void submitMove('DRAW', { at: view.calls.length })}>🎱 Your turn — draw a ball</button>
          ) : (
            <p className="dim small center">{seatName(state.summary, view.caller!)} is calling…</p>
          )
        )}
        {playing && isHost && (
          <div className="row small" style={{ justifyContent: 'center' }}>
            {view.config.callMode === 'auto' && (
              <>
                <button className="secondary" onClick={() => void submitMove(view.autoPaused ? 'RESUME' : 'PAUSE', {})}>
                  {view.autoPaused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <select value={view.config.intervalSec} onChange={(e) => void submitMove('SET_INTERVAL', { sec: Number(e.target.value) })}>
                  {[3, 4, 5, 6, 8, 10, 12, 15, 20, 30].map((s) => <option key={s} value={s}>{s}s</option>)}
                </select>
              </>
            )}
            <button className="ghost" onClick={() => { if (confirm('End the game now?')) void submitMove('END', {}); }}>End game</button>
          </div>
        )}
      </div>

      {mine?.cards.map((card, ci) => (
        <div className="card" key={ci}>
          {mine.cards.length > 1 && <strong className="small">Card {ci + 1}</strong>}
          <CardGrid
            card={card}
            marks={mine.marks[ci]!}
            balls={view.config.balls}
            called={called}
            hints={hints}
            onTap={(n) => playing && void submitMove('MARK', { card: ci, n })}
          />
          {playing && (
            <div className="row small">
              {view.prizes.filter((p) => {
                if (p.id === 'house2') {
                  const first = view.prizes.find((x) => x.id === 'house');
                  if (!first || first.wonAtCall === null || first.wonAtCall === view.calls.length) return false;
                }
                return p.wonAtCall === null || p.wonAtCall === view.calls.length;
              }).map((p) => (
                <button
                  key={p.id}
                  disabled={p.winners.some((w) => w.seat === yourSeat)}
                  onClick={() => void submitMove('CLAIM', { prize: p.id, card: ci })}
                >
                  {p.wonAtCall === null ? `Claim ${p.name}` : `Share ${p.name}`}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <div className="row between">
          <h3>Prizes</h3>
          <label className="row small dim" style={{ gap: 4 }}>
            <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} style={{ width: 'auto' }} />
            highlight called numbers
          </label>
        </div>
        <PrizeBoard view={view} summary={state.summary} />
        <p className="dim small">False claims cost {view.config.penalty} points.</p>
      </div>

      <div className="card">
        <h3>Scores</h3>
        <Scoreboard view={view} summary={state.summary} />
        <LogFeed log={view.log} summary={state.summary} limit={8} />
      </div>

      <div className="card">
        <button className="secondary" onClick={() => setShowBoard((v) => !v)}>
          {showBoard ? 'Hide' : 'Show'} all called numbers ({view.calls.length})
        </button>
        {showBoard && (
          <div style={{ overflowX: 'auto' }}>
            <CalledBoard view={view} cellSize={view.config.balls === 75 ? '5.4vw' : '8.2vw'} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── TV ───────────────────────────────────────────────────────────────────────

function TvView({ state }: TvViewProps<BingoView>) {
  const view = state.view;
  const remaining = useCountdown(view);
  const [voice, setVoice] = useState(false);
  useAnnouncer(view, voice);
  if (!view) return null;

  if (view.phase === 'setup') {
    return (
      <div className="tv-main">
        <div className="tv-board" style={{ flexDirection: 'column', gap: '2vmin' }}>
          <h1 style={{ fontSize: '6vmin' }}>Bingo 🎱</h1>
          <p className="dim" style={{ fontSize: '2.6vmin' }}>{seatName(state.summary, view.host)} is setting up…</p>
          <p style={{ fontSize: '2.4vmin' }}>{configSummary(view.config)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-main">
      <div className="tv-board" style={{ flexDirection: 'column', gap: '2.5vmin', justifyContent: 'flex-start', paddingTop: '1vmin' }}>
        <div className="row" style={{ gap: '3vmin', alignItems: 'center' }}>
          <RecentBalls view={view} size={Math.round(window.innerHeight * 0.2)} count={5} />
        </div>
        <div className="row" style={{ gap: '3vmin', fontSize: '2.4vmin' }}>
          <span>Ball <strong>{view.calls.length}</strong> of {view.config.balls}</span>
          {view.phase === 'playing' && view.config.callMode === 'auto' && (
            <span className="dim">{view.autoPaused ? '⏸ paused' : remaining !== null ? `next in ${Math.ceil(remaining / 1000)}s` : ''}</span>
          )}
          {view.phase === 'playing' && view.config.callMode === 'roundRobin' && view.caller !== null && (
            <span className="dim">🎤 {seatName(state.summary, view.caller)} draws next</span>
          )}
          <button className="ghost" onClick={() => setVoice((v) => !v)} style={{ fontSize: '2.2vmin' }}>
            {voice ? '🔊 voice on' : '🔇 tap for voice'}
          </button>
        </div>
        <CalledBoard view={view} cellSize={view.config.balls === 75 ? '4.1vmin' : '4.6vmin'} />
      </div>
      <div className="tv-sidebar" style={{ width: '32vmin' }}>
        <WinnerBanner state={state} />
        <div className="card" style={{ fontSize: '2vmin' }}>
          <PrizeBoard view={view} summary={state.summary} />
        </div>
        <Scoreboard view={view} summary={state.summary} big />
        <div style={{ fontSize: '1.8vmin' }}>
          <LogFeed log={view.log} summary={state.summary} limit={7} />
        </div>
      </div>
    </div>
  );
}

export const bingoUi: GameUi = { slug: 'bingo', PlayerView, TvView };
