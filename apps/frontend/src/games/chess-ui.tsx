import React, { useState } from 'react';
import type { ChessPublic, ChessMove } from '@gamebox/game-chess';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { SeatTokens, WinnerBanner, Prompt, Waiting, useSlideAnim, useBoardFit } from './common.js';

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

function squareXY(name: string, flipped: boolean | undefined, C: number, M: number): { x: number; y: number } {
  const file = name.charCodeAt(0) - 97;
  const rank = Number(name[1]) - 1;
  return {
    x: (flipped ? 7 - file : file) * C + M + C / 2,
    y: (flipped ? rank : 7 - rank) * C + M + C / 2,
  };
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
  const M = 22; // margin for coordinates
  const W = 8 * C + M * 2;

  const moveKey = view.lastMove ? `${view.lastMove.from}-${view.lastMove.to}-${view.history.length}` : null;
  const slideFrom = view.lastMove ? squareXY(view.lastMove.from, flipped, C, M) : null;
  const slideTo = view.lastMove ? squareXY(view.lastMove.to, flipped, C, M) : null;
  const slidePos = useSlideAnim(moveKey, slideFrom, slideTo);
  const slidingPiece = slidePos && view.lastMove ? squares.find((s) => s.name === view.lastMove!.to)?.piece : null;

  const fit = useBoardFit();
  return (
    <svg viewBox={`0 0 ${W} ${W}`} preserveAspectRatio={fit}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
      <rect width={W} height={W} rx={10} fill="#241a12" />
      {Array.from({ length: 8 }, (_, i) => {
        const fileCh = String.fromCharCode(97 + (flipped ? 7 - i : i));
        const rankCh = String(flipped ? i + 1 : 8 - i);
        return (
          <g key={i} fill="#8a7358" fontSize={11.5} fontWeight={700}>
            <text x={M + i * C + C / 2} y={W - 7} textAnchor="middle">{fileCh}</text>
            <text x={10} y={M + i * C + C / 2 + 4} textAnchor="middle">{rankCh}</text>
          </g>
        );
      })}
      {squares.map((s) => {
        const x = (flipped ? 7 - s.file : s.file) * C + M;
        const y = (flipped ? s.rank : 7 - s.rank) * C + M;
        const light = (s.file + s.rank) % 2 === 1;
        const isLast = view.lastMove && (view.lastMove.from === s.name || view.lastMove.to === s.name);
        const isSel = selected === s.name;
        const isTarget = targets?.has(s.name);
        return (
          <g key={s.name} onClick={onSquare ? () => onSquare(s.name) : undefined} style={onSquare ? { cursor: 'pointer' } : undefined}>
            <rect x={x} y={y} width={C} height={C}
              fill={light ? '#e8d3ae' : '#9d6b43'} />
            {isLast && <rect x={x} y={y} width={C} height={C} fill="rgba(255,185,48,0.4)" />}
            {isSel && <rect x={x} y={y} width={C} height={C} fill="rgba(255,185,48,0.65)" />}
            {isTarget && <circle cx={x + C / 2} cy={y + C / 2} r={s.piece ? C * 0.44 : C * 0.15}
              fill={s.piece ? 'none' : 'rgba(38,120,100,0.6)'} stroke={s.piece ? 'rgba(38,120,100,0.8)' : 'none'} strokeWidth={4.5} />}
            {s.piece && !(slidePos && view.lastMove?.to === s.name) && (
              <text x={x + C / 2} y={y + C * 0.74} textAnchor="middle" fontSize={C * 0.76}
                fill={s.piece[0] === 'w' ? '#fdfdf8' : '#1c1512'}
                stroke={s.piece[0] === 'w' ? '#3a2c20' : '#00000055'} strokeWidth={1}
                style={{ filter: 'drop-shadow(0 2px 1.5px rgba(0,0,0,0.35))' }}>
                {PIECES[s.piece]}
              </text>
            )}
          </g>
        );
      })}
      {slidePos && slidingPiece && (
        <text x={slidePos.x} y={slidePos.y + C * 0.24} textAnchor="middle" fontSize={C * 0.76}
          fill={slidingPiece[0] === 'w' ? '#fdfdf8' : '#1c1512'}
          stroke={slidingPiece[0] === 'w' ? '#3a2c20' : '#00000055'} strokeWidth={1}
          style={{ filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.5))', pointerEvents: 'none' }}>
          {PIECES[slidingPiece]}
        </text>
      )}
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
          <Prompt danger={view.inCheck}>
            Your move ({yourSeat === 0 ? '♔ White' : '♚ Black'}){view.inCheck ? ' — you are in check!' : ''}
          </Prompt>
        ) : (
          <Waiting state={state} />
        )}
      </div>
      <div className="board-frame">
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
