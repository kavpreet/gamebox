import React, { useState } from 'react';
import type { UnoPublic, UnoMove, Face, UnoColor } from '@gamebox/game-uno';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner, Prompt, Waiting, EventLine } from './common.js';

/** Player view additionally carries `hand` (the projection adds it). */
type UnoView = UnoPublic & { hand: Face[] | null };

const COLOR_HEX: Record<string, string> = {
  R: '#e8355c',
  Y: '#f5a623',
  G: '#2ec46f',
  B: '#3f8dff',
  W: '#232847',
};
const COLOR_DARK: Record<string, string> = {
  R: '#b01f42',
  Y: '#c77f12',
  G: '#1d9a52',
  B: '#2a63c4',
  W: '#15182e',
};
const COLOR_NAME: Record<string, string> = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' };

const VALUE_LABEL: Record<string, string> = {
  skip: '⊘',
  reverse: '⇄',
  draw1: '+1',
  draw2: '+2',
  draw5: '+5',
  skipall: '⊘⊘',
  flip: '⟲',
  wild: '★',
  wild4: '+4★',
  wilddraw2: '+2★',
  wilddrawcolor: '+★',
};

function CardFace({
  face,
  big,
  onClick,
  disabled,
  dark,
}: {
  face: Face;
  big?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  dark?: boolean;
}) {
  const label = VALUE_LABEL[face.value] ?? face.value;
  const isWild = face.color === 'W';
  const bg = isWild
    ? 'conic-gradient(from 45deg, #e8355c 0 25%, #f5a623 0 50%, #2ec46f 0 75%, #3f8dff 0)'
    : `linear-gradient(150deg, ${COLOR_HEX[face.color]}, ${COLOR_DARK[face.color]})`;
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`hand-card${onClick && !disabled ? ' clickable' : ''}`}
      style={{
        position: 'relative',
        width: big ? '16vmin' : 54,
        height: big ? '24vmin' : 80,
        minWidth: big ? 90 : undefined,
        minHeight: big ? 135 : undefined,
        background: bg,
        border: dark ? '3px solid #8b6cff' : '3px solid rgba(255,255,255,0.9)',
        fontSize: big ? '5vmin' : 22,
        color: 'white',
        textShadow: '0 2px 3px rgba(0,0,0,0.55)',
        opacity: disabled ? 0.35 : 1,
        overflow: 'hidden',
      }}
    >
      {/* center oval, classic uno style */}
      <div style={{
        position: 'absolute', inset: '12% 8%',
        borderRadius: '50%',
        transform: 'rotate(-28deg)',
        background: 'rgba(255,255,255,0.16)',
        border: '2px solid rgba(255,255,255,0.55)',
      }} />
      <span style={{ position: 'relative', fontWeight: 900 }}>{label}</span>
      <span style={{ position: 'absolute', top: 4, left: 7, fontSize: big ? '2vmin' : 11, fontWeight: 900 }}>{label}</span>
      <span style={{ position: 'absolute', bottom: 4, right: 7, fontSize: big ? '2vmin' : 11, fontWeight: 900, transform: 'rotate(180deg)' }}>{label}</span>
    </div>
  );
}

function TvView({ state }: TvViewProps<UnoView>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ flexDirection: 'column', gap: '3vmin' }}>
        <div style={{ display: 'flex', gap: '4vmin', alignItems: 'center' }}>
          {/* draw pile */}
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '16vmin', height: '24vmin', minWidth: 90, minHeight: 135, borderRadius: 10,
                background: view.side === 'dark' ? '#2d1b4e' : '#1b2038',
                border: '3px dashed #444b78', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '3vmin', color: '#69709c',
              }}
            >
              {view.drawPileSize}
            </div>
            <p className="dim" style={{ fontSize: '1.8vmin' }}>draw pile</p>
          </div>
          {view.discardTop && (
            <div style={{ textAlign: 'center' }}>
              <CardFace face={view.discardTop} big dark={view.side === 'dark'} />
              <p className="dim" style={{ fontSize: '1.8vmin' }}>discard</p>
            </div>
          )}
          <div style={{ fontSize: '5vmin' }}>{view.direction === 1 ? '↻' : '↺'}</div>
        </div>
        {view.currentColor && (
          <div style={{ fontSize: '2.4vmin' }}>
            Color: <span style={{ color: COLOR_HEX[view.currentColor], fontWeight: 800 }}>{COLOR_NAME[view.currentColor]}</span>
            {view.variant === 'uno-flip' && (
              <span className="dim"> · {view.side} side</span>
            )}
          </div>
        )}
        {view.lastEvent && (
          <div className="dim" style={{ fontSize: '2.2vmin' }}>
            {seatName(state.summary, view.order[(view.turnIndex - view.direction + view.order.length) % view.order.length]!)} {view.lastEvent}
          </div>
        )}
      </div>
      <div className="tv-sidebar">
        {state.summary.players
          .filter((p) => view.order.includes(p.seat))
          .map((p) => (
            <div key={p.seat} className={`tv-player-chip ${state.activeSeats.includes(p.seat) ? 'active' : ''}`}>
              <span className={`token seat-color-${p.seat % 6}`} />
              <span className="grow">{p.displayName}</span>
              <strong>{view.handCounts[p.seat] ?? 0}</strong>
              {!p.connected && <span className="dc">⚠</span>}
            </div>
          ))}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<UnoView, UnoMove>) {
  const view = state.view;
  const [wildIdx, setWildIdx] = useState<number | null>(null);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const legal = (state.legalMoves ?? []) as UnoMove[];
  const playableIdx = new Set(legal.filter((m) => m.kind === 'PLAY').map((m) => (m as { card: number }).card));
  const canDraw = legal.some((m) => m.kind === 'DRAW');
  const canPass = legal.some((m) => m.kind === 'PASS');

  const play = (idx: number, face: Face) => {
    if (face.color === 'W') {
      setWildIdx(idx);
    } else {
      submitMove('PLAY', { card: idx });
    }
  };

  return (
    <div className="page">
      <div className="card center">
        <div className="row" style={{ justifyContent: 'center' }}>
          {view.discardTop && <CardFace face={view.discardTop} dark={view.side === 'dark'} />}
          <div>
            {view.currentColor && (
              <p style={{ color: COLOR_HEX[view.currentColor], fontWeight: 800 }}>{COLOR_NAME[view.currentColor]}</p>
            )}
            <p className="dim small">{view.drawPileSize} in pile · {view.direction === 1 ? '↻' : '↺'}</p>
            {view.variant === 'uno-flip' && <p className="dim small">{view.side} side</p>}
          </div>
        </div>
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <Prompt>{view.phase === 'PLAY_DRAWN_OR_PASS' ? 'Play the drawn card or pass' : 'Your turn!'}</Prompt>
        ) : (
          <Waiting state={state} />
        )}
        <EventLine text={view.lastEvent} />
      </div>

      {view.hand && (
        <div className="card">
          <div className="row between">
            <h3>Your hand ({view.hand.length})</h3>
            <div className="row">
              {myTurn && canDraw && (
                <button className="secondary" onClick={() => submitMove('DRAW', {})}>Draw</button>
              )}
              {myTurn && canPass && (
                <button className="secondary" onClick={() => submitMove('PASS', {})}>Pass</button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {view.hand.map((face, idx) => (
              <CardFace
                key={idx}
                face={face}
                dark={view.side === 'dark'}
                onClick={myTurn ? () => play(idx, face) : undefined}
                disabled={myTurn && !playableIdx.has(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {wildIdx !== null && (
        <div className="overlay" onClick={() => setWildIdx(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3>Pick a color</h3>
            <div className="row">
              {(['R', 'Y', 'G', 'B'] as UnoColor[]).map((c) => (
                <button
                  key={c}
                  style={{ background: COLOR_HEX[c], flex: 1 }}
                  onClick={() => {
                    submitMove('PLAY', { card: wildIdx, chooseColor: c });
                    setWildIdx(null);
                  }}
                >
                  {COLOR_NAME[c]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const unoUi: GameUi = { slug: 'uno', PlayerView, TvView };
export const unoFlipUi: GameUi = { slug: 'uno-flip', PlayerView, TvView };
