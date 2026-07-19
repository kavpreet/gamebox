import React, { useState } from 'react';
import type { AzulPublic, AzulMove, PlayerBoard, TileColor } from '@gamebox/game-azul';
import { wallColor } from '@gamebox/game-azul';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner, Prompt, Waiting } from './common.js';

const TILE_COLORS = ['#4a7cf7', '#f5d547', '#e94560', '#2b2b35', '#3ec8c0'];
const TILE_NAMES = ['blue', 'yellow', 'red', 'black', 'teal'];

function Tile({ color, size = 24, dim, onClick, selected }: {
  color: TileColor | 'first';
  size?: number;
  dim?: boolean;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: color === 'first'
          ? 'linear-gradient(150deg, #ffffff, #d8dcf0)'
          : `linear-gradient(150deg, ${TILE_COLORS[color]}, ${TILE_COLORS[color]}bb)`,
        border: selected ? '3px solid #ffb930' : '1px solid rgba(0,0,0,0.55)',
        boxShadow: dim ? 'none' : 'inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.25), 0 1px 3px rgba(3,5,16,0.5)',
        opacity: dim ? 0.22 : 1,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.5,
        fontWeight: 900,
        color: '#22263e',
        flexShrink: 0,
        transition: 'transform 0.1s',
      }}
    >
      {color === 'first' ? '1' : ''}
    </div>
  );
}

function BoardView({ board, name, tileSize = 22, onLine, selectableLines }: {
  board: PlayerBoard;
  name: string;
  tileSize?: number;
  onLine?: (line: number | 'floor') => void;
  selectableLines?: Set<number | 'floor'>;
}) {
  return (
    <div style={{ background: '#1a1e38', borderRadius: 10, padding: 10 }}>
      <div className="row between">
        <strong>{name}</strong>
        <strong style={{ color: 'var(--gold)' }}>{board.score}</strong>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        {/* pattern lines (right-aligned) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {board.lines.map((l, r) => {
            const clickable = Boolean(onLine && selectableLines?.has(r));
            return (
              <div
                key={r}
                onClick={clickable ? () => onLine!(r) : undefined}
                style={{
                  display: 'flex',
                  gap: 3,
                  justifyContent: 'flex-end',
                  width: (tileSize + 3) * 5,
                  padding: 2,
                  borderRadius: 6,
                  border: clickable ? '2px dashed #f5a623' : '2px solid transparent',
                  cursor: clickable ? 'pointer' : 'default',
                }}
              >
                {Array.from({ length: r + 1 }, (_, i) => {
                  const filled = i >= r + 1 - l.count;
                  return filled && l.color !== null
                    ? <Tile key={i} color={l.color} size={tileSize} />
                    : <div key={i} style={{ width: tileSize, height: tileSize, borderRadius: 5, border: '1px dashed #333a63' }} />;
                })}
              </div>
            );
          })}
        </div>
        {/* wall */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {Array.from({ length: 5 }, (_, r) => (
            <div key={r} style={{ display: 'flex', gap: 3, padding: 2 }}>
              {Array.from({ length: 5 }, (_, c) => (
                <Tile key={c} color={wallColor(r, c)} size={tileSize} dim={!board.wall[r]![c]} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* floor line */}
      <div
        onClick={onLine && selectableLines?.has('floor') ? () => onLine('floor') : undefined}
        style={{
          display: 'flex',
          gap: 3,
          marginTop: 6,
          minHeight: tileSize + 8,
          padding: 3,
          borderRadius: 6,
          border: onLine && selectableLines?.has('floor') ? '2px dashed #e94560' : '2px solid transparent',
          cursor: onLine && selectableLines?.has('floor') ? 'pointer' : 'default',
          alignItems: 'center',
        }}
      >
        <span className="dim small" style={{ marginRight: 4 }}>floor</span>
        {board.floor.map((t, i) => <Tile key={i} color={t} size={tileSize - 4} />)}
      </div>
    </div>
  );
}

function Factories({ view, selected, onPick }: {
  view: AzulPublic;
  selected?: { source: number | 'center'; color: TileColor } | null;
  onPick?: (source: number | 'center', color: TileColor) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
      {view.factories.map((f, i) => (
        <div key={i} style={{
          width: 74, height: 74, borderRadius: '50%', background: '#232847',
          display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center',
          justifyContent: 'center', padding: 8, border: '2px solid #333a63',
        }}>
          {f.map((t, j) => (
            <Tile
              key={j}
              color={t}
              onClick={onPick ? () => onPick(i, t) : undefined}
              selected={selected?.source === i && selected?.color === t}
            />
          ))}
        </div>
      ))}
      <div style={{
        minWidth: 90, minHeight: 74, borderRadius: 12, background: '#1a1e38',
        display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center',
        justifyContent: 'center', padding: 8, border: '2px dashed #333a63', maxWidth: 240,
      }}>
        {view.firstMarkerInCenter && <Tile color="first" />}
        {view.center.map((t, j) => (
          <Tile
            key={j}
            color={t}
            onClick={onPick ? () => onPick('center', t) : undefined}
            selected={selected?.source === 'center' && selected?.color === t}
          />
        ))}
        {view.center.length === 0 && !view.firstMarkerInCenter && <span className="dim small">center</span>}
      </div>
    </div>
  );
}

function TvView({ state }: TvViewProps<AzulPublic>) {
  const view = state.view;
  if (!view) return null;
  const current = view.order[view.turnIndex];
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ flexDirection: 'column', gap: '2vmin', padding: '2vmin', justifyContent: 'flex-start', overflow: 'auto' }}>
        <p className="dim">Round {view.round} · bag {view.bagSize}</p>
        <Factories view={view} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          {view.order.map((s) => (
            <div key={s} style={{ outline: s === current ? '2px solid var(--gold)' : 'none', borderRadius: 10 }}>
              <BoardView board={view.boards[s]!} name={seatName(state.summary, s)} tileSize={18} />
            </div>
          ))}
        </div>
        {view.lastEvent && <p className="dim">{view.lastEvent}</p>}
      </div>
      <div className="tv-sidebar">
        {state.summary.players.filter((p) => view.order.includes(p.seat)).map((p) => (
          <div key={p.seat} className={`tv-player-chip ${state.activeSeats.includes(p.seat) ? 'active' : ''}`}>
            <span className={`token seat-color-${p.seat % 6}`} />
            <span className="grow">{p.displayName}</span>
            <strong>{view.boards[p.seat]?.score ?? 0}</strong>
          </div>
        ))}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<AzulPublic, AzulMove>) {
  const view = state.view;
  const [sel, setSel] = useState<{ source: number | 'center'; color: TileColor } | null>(null);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const legal = (state.legalMoves ?? []) as AzulMove[];

  const selectableLines = new Set<number | 'floor'>(
    sel
      ? legal.filter((m) => m.source === sel.source && m.color === sel.color).map((m) => m.line)
      : [],
  );

  const place = async (line: number | 'floor') => {
    if (!sel) return;
    const move = { kind: 'DRAFT' as const, source: sel.source, color: sel.color, line };
    setSel(null);
    await submitMove('DRAFT', move);
  };

  return (
    <div className="page">
      <div className="card">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <Prompt>
            {sel ? `Now tap a pattern line (or the floor) for the ${TILE_NAMES[sel.color]} tiles` : 'Your turn — tap a tile to pick a color'}
          </Prompt>
        ) : (
          <Waiting state={state} />
        )}
        <Factories view={view} selected={sel} onPick={myTurn ? (source, color) => setSel({ source, color }) : undefined} />
      </div>

      <div className="card">
        <BoardView
          board={view.boards[yourSeat]!}
          name="Your board"
          tileSize={26}
          onLine={myTurn && sel ? place : undefined}
          selectableLines={selectableLines}
        />
      </div>

      <div className="card">
        <h3>Opponents</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {view.order.filter((s) => s !== yourSeat).map((s) => (
            <BoardView key={s} board={view.boards[s]!} name={seatName(state.summary, s)} tileSize={14} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const azulUi: GameUi = { slug: 'azul', PlayerView, TvView };
