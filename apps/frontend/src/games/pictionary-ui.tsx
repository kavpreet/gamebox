import React, { useEffect, useRef, useState } from 'react';
import type { PictionaryPublic, PictionaryMove, Stroke } from '@gamebox/game-pictionary';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner } from './common.js';

type PictionaryView = PictionaryPublic & { word: string | null };

const PALETTE = ['#eef0ff', '#e94560', '#f5a623', '#2ec4b6', '#4a7cf7', '#a06cd5', '#11131f'];

function drawStrokes(canvas: HTMLCanvasElement, strokes: Stroke[], live?: number[] | null, liveColor?: string, liveWidth?: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#f7f3e8';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const paint = (points: number[], color: string, width: number) => {
    if (points.length < 4) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, width * w);
    ctx.beginPath();
    ctx.moveTo(points[0]! * w, points[1]! * h);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]! * w, points[i + 1]! * h);
    ctx.stroke();
  };
  for (const s of strokes) paint(s.points, s.color, s.width);
  if (live && live.length >= 4) paint(live, liveColor ?? '#11131f', liveWidth ?? 0.008);
}

/** Read-only replay canvas (guessers + TV). */
function ReplayCanvas({ strokes, height = 320 }: { strokes: Stroke[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = height;
    drawStrokes(canvas, strokes);
  }, [strokes, height]);
  return (
    <div style={{ width: '100%' }}>
      <canvas ref={ref} style={{ width: '100%', height, borderRadius: 10, display: 'block' }} />
    </div>
  );
}

/** Interactive canvas for the drawer — batches one pointer-drag into one STROKE move. */
function DrawCanvas({ strokes, color, width, onStroke }: {
  strokes: Stroke[];
  color: string;
  width: number;
  onStroke: (points: number[]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef<number[] | null>(null);

  const repaint = () => {
    const canvas = ref.current;
    if (canvas) drawStrokes(canvas, strokes, live.current, color, width);
  };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = Math.min(rect.width, 360);
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  const point = (e: React.PointerEvent): [number, number] => {
    const rect = ref.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  };

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', borderRadius: 10, display: 'block', touchAction: 'none' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        live.current = [...point(e)];
      }}
      onPointerMove={(e) => {
        if (!live.current) return;
        const [x, y] = point(e);
        const pts = live.current;
        // thin out points: skip if closer than ~3px equivalent
        const lx = pts[pts.length - 2]!, ly = pts[pts.length - 1]!;
        if (Math.abs(x - lx) + Math.abs(y - ly) < 0.006) return;
        pts.push(x, y);
        if (pts.length >= 1900) { // stay under the server cap: flush and continue
          onStroke(pts);
          live.current = [x, y];
        }
        repaint();
      }}
      onPointerUp={() => {
        if (live.current && live.current.length >= 4) onStroke(live.current);
        live.current = null;
      }}
      onPointerCancel={() => { live.current = null; repaint(); }}
    />
  );
}

function GuessFeed({ view, summary, limit = 8 }: {
  view: PictionaryView;
  summary: TvViewProps['state']['summary'];
  limit?: number;
}) {
  const recent = view.guesses.slice(-limit);
  if (recent.length === 0) return null;
  return (
    <div>
      {recent.map((g, i) => (
        <p key={i} className="small" style={{ margin: '2px 0', color: g.correct ? '#2ec4b6' : undefined }}>
          <strong>{seatName(summary, g.seat)}</strong>: {g.text} {g.correct && '✓'}
        </p>
      ))}
    </div>
  );
}

function TvView({ state }: TvViewProps<PictionaryView>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ flexDirection: 'column', gap: '1.5vmin', padding: '2vmin', justifyContent: 'flex-start' }}>
        <div className="row between" style={{ alignSelf: 'stretch' }}>
          <strong>Round {view.round}/{view.totalRounds} — {seatName(state.summary, view.drawer)} is drawing</strong>
          <span style={{ fontFamily: 'monospace', fontSize: '2.5vmin', letterSpacing: 2 }}>{view.wordHint}</span>
        </div>
        <ReplayCanvas strokes={view.strokes} height={Math.floor(window.innerHeight * 0.62)} />
        {view.revealedWord && <p className="dim">Last word: <strong>{view.revealedWord}</strong> {view.lastEvent && `— ${view.lastEvent}`}</p>}
      </div>
      <div className="tv-sidebar">
        {state.summary.players.filter((p) => view.order.includes(p.seat)).map((p) => (
          <div key={p.seat} className={`tv-player-chip ${p.seat === view.drawer ? 'active' : ''}`}>
            <span className={`token seat-color-${p.seat % 6}`} />
            <span className="grow">{p.displayName} {p.seat === view.drawer && '🖌️'}</span>
            <strong>{view.scores[p.seat] ?? 0}</strong>
          </div>
        ))}
        <GuessFeed view={view} summary={state.summary} limit={10} />
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<PictionaryView, PictionaryMove>) {
  const view = state.view;
  const [color, setColor] = useState(PALETTE[6]!);
  const [width, setWidth] = useState(0.008);
  const [guess, setGuess] = useState('');
  if (!view) return null;
  const drawing = view.drawer === yourSeat && state.status === 'active';

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <strong>Round {view.round}/{view.totalRounds}</strong>
          <strong>You: {view.scores[yourSeat] ?? 0} pts</strong>
        </div>
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : drawing ? (
          <p className="center" style={{ color: 'var(--gold)', fontWeight: 700 }}>
            Draw: <span style={{ fontSize: '1.3em' }}>{view.word}</span>
          </p>
        ) : (
          <p className="center">
            {seatName(state.summary, view.drawer)} is drawing —{' '}
            <span style={{ fontFamily: 'monospace', letterSpacing: 2 }}>{view.wordHint}</span>
          </p>
        )}
        {view.revealedWord && <p className="dim small center">Last word: {view.revealedWord}</p>}
      </div>

      <div className="card">
        {drawing ? (
          <>
            <DrawCanvas
              strokes={view.strokes}
              color={color}
              width={width}
              onStroke={(points) => void submitMove('STROKE', { color, width, points })}
            />
            <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {PALETTE.map((c) => (
                <div
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', background: c,
                    border: color === c ? '3px solid var(--gold)' : '1px solid #333a63',
                    cursor: 'pointer',
                  }}
                />
              ))}
              <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                <option value={0.004}>thin</option>
                <option value={0.008}>normal</option>
                <option value={0.02}>thick</option>
              </select>
              <button className="secondary" onClick={() => void submitMove('UNDO', {})}>Undo</button>
              <button className="secondary" onClick={() => void submitMove('CLEAR', {})}>Clear</button>
              <button className="secondary" onClick={() => void submitMove('SKIP', {})}>Skip word</button>
            </div>
          </>
        ) : (
          <>
            <ReplayCanvas strokes={view.strokes} height={280} />
            {state.status === 'active' && (
              <form
                className="row"
                style={{ marginTop: 8 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!guess.trim()) return;
                  const err = await submitMove('GUESS', { text: guess.trim() });
                  if (!err) setGuess('');
                }}
              >
                <input
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  placeholder="your guess…"
                  maxLength={60}
                  style={{ flex: 1 }}
                />
                <button type="submit" disabled={!guess.trim()}>Guess</button>
              </form>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3>Guesses</h3>
        <GuessFeed view={view} summary={state.summary} />
      </div>
    </div>
  );
}

export const pictionaryUi: GameUi = { slug: 'pictionary', PlayerView, TvView };
