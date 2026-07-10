import React, { useState } from 'react';
import type { ChessPublic, ChessMove } from '@gamebox/game-chess';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatTokens, WinnerBanner } from './common.js';

const PIECES: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

interface Square {
  file: number; // 0..7 = a..h
  rank: number; // 0..7 = 1..8
  name: string; // 'e4'
  piece: string | null; // 'wp', 'bk', ...
}

function parseFen(fen: string): Square[] {
  const board: Square[] = [];
  const placement = fen.split(' ')[0]!;
  const rows = placement.split('/'); // rank 8 first
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let k = 0; k < Number(ch); k++) {
          board.push({ file, rank, name: sq(file, rank), piece: null });
          file++;
        }
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        board.push({ file, rank, name: sq(file, rank), piece: color + ch.toLowerCase() });
        file++;
      }
    }
  });
  return board;
}

function sq(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + String(rank + 1);
}

function Board({
  view,
  flipped,
  selected,
  targets,
  onSquare,
}: {
  view: ChessPublic;
  flipped?: boolean;
  selected?: string | null;
  targets?: Set<string>;
  onSquare?: (name: string) => void;
}) {
  const squares = parseFen(view.fen);
  const C = 60;
  return (
    <svg viewBox={`0 0 ${8 * C} ${8 * C}`} style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>
      {squares.map((s) => {
        const x = (flipped ? 7 - s.file : s.file) * C;
        const y = (flipped ? s.rank : 7 - s.rank) * C;
        const light = (s.file + s.rank) % 2 === 1;
        const isLast = view.lastMove && (view.lastMove.from === s.name || view.lastMove.to === s.name);
        const isSel = selected === s.name;
        const isTarget = targets?.has(s.name);
        return (
          <g key={s.name} onClick={onSquare ? () => onSquare(s.name) : undefined} style={onSquare ? { cursor: 'pointer' } : undefined}>
            <rect x={x} y={y} width={C} height={C}
              fill={isSel ? '#f5a623' : isLast ? '#4a5387' : light ? '#39406e' : '#232847'} />
            {isTarget && <circle cx={x + C / 2} cy={y + C / 2} r={s.piece ? C * 0.44 : C * 0.16}
              fill={s.piece ? 'none' : 'rgba(46,196,182,0.55)'} stroke={s.piece ? 'rgba(46,196,182,0.8)' : 'none'} strokeWidth={4} />}
            {s.piece && (
              <text x={x + C / 2} y={y + C * 0.72} textAnchor="middle" fontSize={C * 0.72}
                fill={s.piece[0] === 'w' ? '#f4f6ff' : '#0c0e1c'}
                stroke={s.piece[0] === 'w' ? '#0c0e1c' : '#4a5387'} strokeWidth={0.8}>
                {PIECES[s.piece]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function TvView({ state }: TvViewProps<ChessPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} />
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        <div className="tv-player-chip">{view.turn === 'w' ? '⬜ White' : '⬛ Black'} to move{view.inCheck ? ' — check!' : ''}</div>
        {view.history.length > 0 && (
          <div className="tv-player-chip dim" style={{ flexWrap: 'wrap', maxHeight: '30vh', overflow: 'hidden' }}>
            {view.history.slice(-12).join(' ')}
          </div>
        )}
        {view.result === 'draw' && <div className="tv-player-chip active">Draw — {view.resultReason}</div>}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<ChessPublic, ChessMove>) {
  const view = state.view;
  const [selected, setSelected] = useState<string | null>(null);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const legal = (state.legalMoves ?? []) as ChessMove[];
  const targets = selected
    ? new Set(legal.filter((m) => m.from === selected).map((m) => m.to))
    : new Set<string>();
  const froms = new Set(legal.map((m) => m.from));

  const onSquare = (name: string) => {
    if (!myTurn) return;
    if (selected && targets.has(name)) {
      const move = legal.find((m) => m.from === selected && m.to === name)!;
      submitMove('MOVE', { from: move.from, to: name, promotion: move.promotion ?? 'q' });
      setSelected(null);
    } else if (froms.has(name)) {
      setSelected(name === selected ? null : name);
    } else {
      setSelected(null);
    }
  };

  return (
    <div className="page">
      <div className="card center">
        {state.status === 'completed' ? (
          <>
            {view.result === 'draw' && <p>Draw — {view.resultReason}</p>}
            <WinnerBanner state={state} />
          </>
        ) : myTurn ? (
          <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
            Your move ({yourSeat === 0 ? 'White' : 'Black'}){view.inCheck ? ' — you are in check!' : ''}
          </p>
        ) : (
          <p className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</p>
        )}
      </div>
      <div className="card">
        <Board
          view={view}
          flipped={yourSeat === 1}
          selected={selected}
          targets={targets}
          onSquare={onSquare}
        />
      </div>
      {view.history.length > 0 && (
        <p className="dim small center">{view.history.slice(-10).join(' ')}</p>
      )}
    </div>
  );
}

export const chessUi: GameUi = { slug: 'chess', PlayerView, TvView };
