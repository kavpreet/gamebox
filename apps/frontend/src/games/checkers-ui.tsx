import React, { useState } from 'react';
import type { CheckersPublic, CheckersMove } from '@gamebox/game-checkers';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatTokens, WinnerBanner } from './common.js';

const SEAT_COLORS = ['#e94560', '#2ec4b6'];

function Board({
  view,
  flipped,
  selected,
  targets,
  froms,
  onSquare,
}: {
  view: CheckersPublic;
  flipped?: boolean;
  selected?: string | null;
  targets?: Set<string>;
  froms?: Set<string>;
  onSquare?: (name: string) => void;
}) {
  const C = 60;
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
            fill={isSel ? '#f5a623' : isLast ? '#4a5387' : dark ? '#232847' : '#39406e'} />
          {isTarget && <circle cx={x + C / 2} cy={y + C / 2} r={C * 0.16} fill="rgba(46,196,182,0.6)" />}
          {piece && (
            <>
              <circle cx={x + C / 2} cy={y + C / 2} r={C * 0.36}
                fill={SEAT_COLORS[piece.seat % 2]}
                stroke={isFrom ? '#ffffff' : '#0f1220'} strokeWidth={isFrom ? 3 : 2} />
              {piece.king && (
                <text x={x + C / 2} y={y + C / 2 + 7} textAnchor="middle" fontSize={22} fill="#0f1220" fontWeight={900}>♛</text>
              )}
            </>
          )}
        </g>,
      );
    }
  }
  return <svg viewBox={`0 0 ${8 * C} ${8 * C}`} style={{ maxWidth: '100%', maxHeight: '100%', width: '100%' }}>{cells}</svg>;
}

function TvView({ state }: TvViewProps<CheckersPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} />
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
          <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {view.chain ? 'Keep jumping!' : mustCapture ? 'Your turn — a capture is forced' : 'Your turn'}
          </p>
        ) : (
          <p className="dim">Waiting for {state.activeSeats.map((s) => seatName(state.summary, s)).join(', ')}…</p>
        )}
      </div>
      <div className="card">
        <Board view={view} flipped={yourSeat === 1} selected={selected} targets={targets}
          froms={myTurn ? froms : undefined} onSquare={onSquare} />
      </div>
    </div>
  );
}

export const checkersUi: GameUi = { slug: 'checkers', PlayerView, TvView };
