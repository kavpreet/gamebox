import React, { useState } from 'react';
import type { CheckersPublic, CheckersMove } from '@gamebox/game-checkers';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import type { GameSummary } from '@gamebox/shared-types';
import {
  SeatTokens, SeatToken, WinnerBanner, Prompt, Waiting, useBoardFit,
  useHandMove, HandGlyph, FxDefs, CaptureBlast, useRecentChange, seatColor,
} from './common.js';

function cellXY(name: string, flipped: boolean | undefined, C: number): { x: number; y: number } {
  const [c, r] = name.split(',').map(Number);
  return {
    x: (flipped ? 7 - c! : c!) * C + C / 2,
    y: (flipped ? r! : 7 - r!) * C + C / 2,
  };
}

function Board({
  view,
  summary,
  flipped,
  selected,
  targets,
  froms,
  onSquare,
}: {
  view: CheckersPublic;
  summary: GameSummary;
  flipped?: boolean;
  selected?: string | null;
  targets?: Set<string>;
  froms?: Set<string>;
  onSquare?: (name: string) => void;
}) {
  const C = 60;
  const lm = view.lastMove;
  const moveKey = lm ? `${lm.from}-${lm.to}-${lm.captured ?? ''}` : null;
  const slidePos = useHandMove(
    moveKey,
    lm ? cellXY(lm.from, flipped, C) : null,
    lm ? cellXY(lm.to, flipped, C) : null,
  );
  const slidingPiece = slidePos && lm ? view.board[lm.to] : null;
  // the victim explodes right as the jumping piece lands (grab 220 + drag 480);
  // until then a ghost of it still sits on its square
  const showBlast = useRecentChange(lm?.captured ? moveKey : null, 900, 700);
  const victimSeat = lm && view.board[lm.to] ? ((1 - view.board[lm.to]!.seat) as 0 | 1) : null;
  const showGhost = !!(slidePos && lm?.captured && !showBlast);
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const name = `${c},${r}`;
      const x = (flipped ? 7 - c : c) * C;
      const y = (flipped ? r : 7 - r) * C;
      const dark = (c + r) % 2 === 1;
      const piece = view.board[name];
      const isSel = selected === name;
      const isTarget = targets?.has(name);
      const isFrom = froms?.has(name);
      const isLast = view.lastMove && (view.lastMove.from === name || view.lastMove.to === name);
      cells.push(
        <g key={name} onClick={onSquare && dark ? () => onSquare(name) : undefined}
          style={onSquare && dark ? { cursor: 'pointer' } : undefined}>
          <rect x={x} y={y} width={C} height={C}
            fill={dark ? '#8a5230' : '#f2debb'} />
          {isLast && <rect x={x} y={y} width={C} height={C} fill="rgba(255,185,48,0.35)" />}
          {isSel && <rect x={x} y={y} width={C} height={C} fill="rgba(255,185,48,0.6)" />}
          {isTarget && <circle cx={x + C / 2} cy={y + C / 2} r={C * 0.16} fill="rgba(46,230,201,0.75)" />}
          {piece && !(slidePos && lm?.to === name) && (
            <>
              <SeatToken summary={summary} seat={piece.seat} cx={x + C / 2} cy={y + C / 2} r={C * 0.37} />
              {isFrom && (
                <circle cx={x + C / 2} cy={y + C / 2} r={C * 0.37} fill="none" stroke="#ffffff" strokeWidth={3} />
              )}
              <circle cx={x + C / 2} cy={y + C / 2} r={C * 0.26} fill="none"
                stroke="rgba(0,0,0,0.25)" strokeWidth={2} />
              {piece.king && (
                <text x={x + C / 2} y={y + C / 2 + 7} textAnchor="middle" fontSize={22} fill="#3c2500" fontWeight={900}>♛</text>
              )}
            </>
          )}
        </g>,
      );
    }
  }
  const M = 10;
  const fit = useBoardFit();
  return (
    <svg viewBox={`${-M} ${-M} ${8 * C + M * 2} ${8 * C + M * 2}`} preserveAspectRatio={fit}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
      <FxDefs />
      <rect x={-M} y={-M} width={8 * C + M * 2} height={8 * C + M * 2} rx={10} fill="#2e2115" />
      {cells}
      <rect x={0} y={0} width={8 * C} height={8 * C} fill="url(#gb-boardlight)" style={{ pointerEvents: 'none' }} />
      <rect x={0} y={0} width={8 * C} height={8 * C} fill="url(#gb-vignette)" style={{ pointerEvents: 'none' }} />
      {showGhost && lm?.captured && victimSeat !== null && (
        <g style={{ pointerEvents: 'none' }}>
          <SeatToken summary={summary} seat={victimSeat} cx={cellXY(lm.captured, flipped, C).x} cy={cellXY(lm.captured, flipped, C).y} r={C * 0.37} />
        </g>
      )}
      {showBlast && lm?.captured && victimSeat !== null && (
        <CaptureBlast x={cellXY(lm.captured, flipped, C).x} y={cellXY(lm.captured, flipped, C).y}
          color={seatColor(summary, victimSeat)} r={C * 0.42} />
      )}
      {slidePos && slidingPiece && (
        <g style={{ filter: 'drop-shadow(0 5px 6px rgba(0,0,0,0.55))', pointerEvents: 'none' }}>
          <SeatToken summary={summary} seat={slidingPiece.seat} cx={slidePos.x} cy={slidePos.y} r={C * 0.4} />
          {slidingPiece.king && (
            <text x={slidePos.x} y={slidePos.y + 7} textAnchor="middle" fontSize={22} fill="#3c2500" fontWeight={900}>♛</text>
          )}
          <HandGlyph x={slidePos.x} y={slidePos.y} phase={slidePos.phase} t={slidePos.t} size={C * 0.95} />
        </g>
      )}
    </svg>
  );
}

function TvView({ state }: TvViewProps<CheckersPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} summary={state.summary} />
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        {view.chain && <div className="tv-player-chip active">chained capture in progress!</div>}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<CheckersPublic, CheckersMove>) {
  const view = state.view;
  const [selected, setSelected] = useState<string | null>(null);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const legal = (state.legalMoves ?? []) as CheckersMove[];
  const froms = new Set(legal.map((m) => m.from));
  const targets = selected ? new Set(legal.filter((m) => m.from === selected).map((m) => m.to)) : new Set<string>();
  const mustCapture = legal.length > 0 && view.board[legal[0]!.from] !== undefined &&
    Math.abs(Number(legal[0]!.to.split(',')[0]) - Number(legal[0]!.from.split(',')[0])) === 2;

  const onSquare = (name: string) => {
    if (!myTurn) return;
    if (selected && targets.has(name)) {
      submitMove('MOVE', { from: selected, to: name });
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
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <Prompt>
            {view.chain ? 'Keep jumping!' : mustCapture ? 'Your turn — a capture is forced' : 'Your turn'}
          </Prompt>
        ) : (
          <Waiting state={state} />
        )}
      </div>
      <div className="board-frame">
        <Board view={view} summary={state.summary} flipped={yourSeat === 1} selected={selected} targets={targets}
          froms={myTurn ? froms : undefined} onSquare={onSquare} />
      </div>
    </div>
  );
}

export const checkersUi: GameUi = { slug: 'checkers', PlayerView, TvView };
