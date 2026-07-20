import React, { useState } from 'react';
import type { ScrabblePublic, ScrabbleMove, BoardCell } from '@gamebox/game-scrabble';
import { premiumAt, LETTER_VALUES, BOARD_SIZE, CENTER } from '@gamebox/game-scrabble';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { SeatDot, WinnerBanner, Prompt, Waiting, EventLine } from './common.js';

type ScrabbleView = ScrabblePublic & { rack: string[] | null };

const PREMIUM_BG: Record<string, string> = {
  TW: '#a3243f', DW: '#c2607f', TL: '#2b5ac2', DL: '#5a8fe8',
};
const PREMIUM_LABEL: Record<string, string> = { TW: '3W', DW: '2W', TL: '3L', DL: '2L' };

interface Pending {
  row: number;
  col: number;
  rackIndex: number;
  letter: string; // resolved (blank already assigned)
  isBlank: boolean;
}

function Square({ cell, pending, row, col, size, highlight, onClick }: {
  cell: BoardCell | null;
  pending?: Pending;
  row: number;
  col: number;
  size: number;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const prem = premiumAt(row, col);
  const letter = pending?.letter ?? cell?.letter;
  const isBlank = pending?.isBlank ?? cell?.isBlank ?? false;
  return (
    <div
      onClick={onClick}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.55,
        fontWeight: 800,
        borderRadius: 2,
        userSelect: 'none',
        cursor: onClick ? 'pointer' : 'default',
        background: letter
          ? (pending ? 'linear-gradient(150deg, #ffcf7d, #f5a623)' : 'linear-gradient(150deg, #f2e3bb, #e0c88f)')
          : prem
            ? PREMIUM_BG[prem]
            : '#20264a',
        color: letter ? (isBlank ? '#a3243f' : '#241a12') : '#dfe3ff',
        boxShadow: letter ? 'inset 0 -2px 0 rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.4)' : undefined,
        outline: highlight ? '2px solid var(--gold)' : 'none',
        boxSizing: 'border-box',
      }}
    >
      {letter ?? (row === CENTER && col === CENTER ? '★' : prem ? PREMIUM_LABEL[prem] : '')}
    </div>
  );
}

function Board({ view, pending = [], squareSize, onSquare }: {
  view: ScrabbleView;
  pending?: Pending[];
  squareSize: number;
  onSquare?: (row: number, col: number) => void;
}) {
  const lastSet = new Set(view.lastPlacement.map((p) => `${p.row},${p.col}`));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD_SIZE}, ${squareSize}px)`, gap: 1, justifyContent: 'center' }}>
      {Array.from({ length: BOARD_SIZE }, (_, r) =>
        Array.from({ length: BOARD_SIZE }, (_, c) => {
          const p = pending.find((x) => x.row === r && x.col === c);
          return (
            <Square
              key={`${r},${c}`}
              row={r}
              col={c}
              size={squareSize}
              cell={view.board[r]![c] ?? null}
              pending={p}
              highlight={lastSet.has(`${r},${c}`)}
              onClick={onSquare && !view.board[r]![c] ? () => onSquare(r, c) : undefined}
            />
          );
        }),
      )}
    </div>
  );
}

function RackTile({ tile, selected, faded, onClick }: {
  tile: string;
  selected?: boolean;
  faded?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 40, height: 44, borderRadius: 7,
        background: faded ? '#33302a' : 'linear-gradient(150deg, #f2e3bb, #e0c88f)',
        color: '#241a12',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 20,
        border: selected ? '3px solid #f5a623' : '1px solid #8a7358',
        boxShadow: faded ? 'none' : 'inset 0 -3px 0 rgba(0,0,0,0.22), 0 2px 5px rgba(0,0,0,0.45)',
        transform: selected ? 'translateY(-5px)' : 'none',
        transition: 'transform 0.1s',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        opacity: faded ? 0.4 : 1,
      }}
    >
      <span>{tile === '?' ? '​' : tile}</span>
      <span style={{ fontSize: 9, fontWeight: 600 }}>{tile === '?' ? 'blank' : LETTER_VALUES[tile]}</span>
    </div>
  );
}

function TvView({ state }: TvViewProps<ScrabbleView>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ padding: '1vmin' }}>
        <Board view={view} squareSize={Math.floor(Math.min(window.innerWidth * 0.55, window.innerHeight * 0.9) / 16)} />
      </div>
      <div className="tv-sidebar">
        {state.summary.players.filter((p) => view.order.includes(p.seat)).map((p) => (
          <div key={p.seat} className={`tv-player-chip ${state.activeSeats.includes(p.seat) ? 'active' : ''}`}>
            <SeatDot summary={state.summary} seat={p.seat} />
            <span className="grow">{p.displayName} <span className="dim small">({view.rackCounts[p.seat] ?? 0} tiles)</span></span>
            <strong>{view.scores[p.seat] ?? 0}</strong>
          </div>
        ))}
        <p className="dim small">Bag: {view.bagSize} tiles</p>
        {view.lastEvent && <p className="dim small">{view.lastEvent}</p>}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<ScrabbleView, ScrabbleMove>) {
  const view = state.view;
  const [selectedRack, setSelectedRack] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [exchanging, setExchanging] = useState<number[]>([]);
  const [mode, setMode] = useState<'place' | 'exchange'>('place');
  if (!view || !view.rack) return null;
  const rack = view.rack;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const usedRack = new Set(pending.map((p) => p.rackIndex));

  const clear = () => {
    setPending([]);
    setSelectedRack(null);
    setExchanging([]);
  };

  const tapSquare = (row: number, col: number) => {
    const existing = pending.find((p) => p.row === row && p.col === col);
    if (existing) {
      setPending((ps) => ps.filter((p) => p !== existing));
      return;
    }
    if (selectedRack === null) return;
    const tile = rack[selectedRack]!;
    let letter = tile;
    let isBlank = false;
    if (tile === '?') {
      const as = window.prompt('Blank tile — which letter? (A–Z)')?.trim().toUpperCase() ?? '';
      if (!/^[A-Z]$/.test(as)) return;
      letter = as;
      isBlank = true;
    }
    setPending((ps) => [...ps, { row, col, rackIndex: selectedRack, letter, isBlank }]);
    setSelectedRack(null);
  };

  const submit = async () => {
    const move = {
      kind: 'PLACE' as const,
      tiles: pending.map((p) => ({ row: p.row, col: p.col, rackIndex: p.rackIndex, ...(p.isBlank ? { blankAs: p.letter } : {}) })),
    };
    const err = await submitMove('PLACE', move);
    if (!err) clear();
  };

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <strong>You: {view.scores[yourSeat] ?? 0}</strong>
          <span className="dim small">bag {view.bagSize}</span>
        </div>
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <Prompt>Your turn — tap a rack tile, then a square. Your table is the dictionary!</Prompt>
        ) : (
          <Waiting state={state} />
        )}
        <EventLine text={view.lastEvent} />
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <Board
          view={view}
          pending={pending}
          squareSize={22}
          onSquare={myTurn && mode === 'place' ? tapSquare : undefined}
        />
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          {rack.map((t, i) => (
            <RackTile
              key={i}
              tile={t}
              selected={mode === 'place' ? selectedRack === i : exchanging.includes(i)}
              faded={usedRack.has(i)}
              onClick={
                !myTurn || usedRack.has(i)
                  ? undefined
                  : mode === 'place'
                    ? () => setSelectedRack((s) => (s === i ? null : i))
                    : () => setExchanging((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))
              }
            />
          ))}
        </div>
        {myTurn && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {mode === 'place' ? (
              <>
                <button disabled={pending.length === 0} onClick={() => void submit()}>
                  Play word
                </button>
                <button className="secondary" disabled={pending.length === 0} onClick={clear}>
                  Clear
                </button>
                <button className="secondary" onClick={() => { clear(); setMode('exchange'); }}>
                  Exchange…
                </button>
                <button className="secondary" onClick={() => void submitMove('PASS', {})}>
                  Pass
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={exchanging.length === 0}
                  onClick={async () => {
                    const err = await submitMove('EXCHANGE', { rackIndexes: exchanging });
                    if (!err) { clear(); setMode('place'); }
                  }}
                >
                  Exchange {exchanging.length || ''}
                </button>
                <button className="secondary" onClick={() => { clear(); setMode('place'); }}>
                  Back
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const scrabbleUi: GameUi = { slug: 'scrabble', PlayerView, TvView };
