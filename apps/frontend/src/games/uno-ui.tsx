import React, { useRef, useState } from 'react';
import type { UnoPublic, UnoMove, Face, UnoColor } from '@gamebox/game-uno';
import type { Seat } from '@gamebox/shared-types';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner, Prompt } from './common.js';

/** Player view carries `hand`; Flip also carries every hand's inactive faces. */
type UnoView = UnoPublic & {
  hand: Face[] | null;
  backsides: Record<Seat, Face[]> | null;
};

/** Light side: classic bright cards. Dark side (Flip): neon-on-black. */
const LIGHT_HEX: Record<string, string> = {
  R: '#e8355c', Y: '#f5a623', G: '#2ec46f', B: '#3f8dff', W: '#232847',
};
const LIGHT_DARKER: Record<string, string> = {
  R: '#b01f42', Y: '#c77f12', G: '#1d9a52', B: '#2a63c4', W: '#15182e',
};
const DARK_HEX: Record<string, string> = {
  R: '#ff2d8f', Y: '#ff8a00', G: '#00d6b0', B: '#8f4bff', W: '#0d0818',
};
const COLOR_NAME: Record<string, string> = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' };
const DARK_NAME: Record<string, string> = { R: 'Pink', Y: 'Orange', G: 'Teal', B: 'Purple' };

const VALUE_LABEL: Record<string, string> = {
  skip: '⊘', reverse: '⇄', draw1: '+1', draw2: '+2', draw5: '+5',
  skipall: '⊘⊘', flip: '⟲', wild: '★', wild4: '+4★', wilddraw2: '+2★', wilddrawcolor: '+★',
};

function hexFor(face: Face, side: 'light' | 'dark'): string {
  return (side === 'dark' ? DARK_HEX : LIGHT_HEX)[face.color] ?? '#232847';
}

function CardFace({ face, side, big, mini, dealIn, onClick, disabled }: {
  face: Face;
  side: 'light' | 'dark';
  big?: boolean;
  mini?: boolean;
  dealIn?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const label = VALUE_LABEL[face.value] ?? face.value;
  const isWild = face.color === 'W';
  const dark = side === 'dark';
  const hex = hexFor(face, side);
  const bg = isWild
    ? (dark
      ? 'conic-gradient(from 45deg, #ff2d8f 0 25%, #ff8a00 0 50%, #00d6b0 0 75%, #8f4bff 0)'
      : 'conic-gradient(from 45deg, #e8355c 0 25%, #f5a623 0 50%, #2ec46f 0 75%, #3f8dff 0)')
    : dark
      ? `linear-gradient(150deg, #1a1128, #0c0716)` // black card, neon accents
      : `linear-gradient(150deg, ${LIGHT_HEX[face.color]}, ${LIGHT_DARKER[face.color]})`;
  const w = mini ? 22 : big ? '16vmin' : 54;
  const h = mini ? 32 : big ? '24vmin' : 80;
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`hand-card${onClick && !disabled ? ' clickable' : ''}${dealIn ? ' deal-in' : ''}`}
      style={{
        position: 'relative',
        width: w, height: h,
        minWidth: big ? 90 : undefined, minHeight: big ? 135 : undefined,
        background: bg,
        border: dark
          ? `${mini ? 1.5 : 2.5}px solid ${isWild ? '#8f4bff' : hex}`
          : `${mini ? 1.5 : 3}px solid rgba(255,255,255,0.9)`,
        boxShadow: dark && !mini ? `0 0 12px ${isWild ? '#8f4bff55' : hex + '55'}, 0 3px 8px rgba(0,0,0,0.5)` : undefined,
        fontSize: mini ? 12 : big ? '5vmin' : 22,
        color: dark && !isWild ? hex : 'white',
        textShadow: dark ? `0 0 8px ${hex}` : '0 2px 3px rgba(0,0,0,0.55)',
        opacity: disabled ? 0.35 : 1,
        overflow: 'hidden',
      }}
    >
      {!mini && (
        <div style={{
          position: 'absolute', inset: '12% 8%',
          borderRadius: '50%',
          transform: 'rotate(-28deg)',
          background: dark ? `${hex}22` : 'rgba(255,255,255,0.16)',
          border: `2px solid ${dark ? hex : 'rgba(255,255,255,0.55)'}`,
        }} />
      )}
      <span style={{ position: 'relative', fontWeight: 900 }}>{label}</span>
      {!mini && (
        <>
          <span style={{ position: 'absolute', top: 4, left: 7, fontSize: big ? '2vmin' : 11, fontWeight: 900 }}>{label}</span>
          <span style={{ position: 'absolute', bottom: 4, right: 7, fontSize: big ? '2vmin' : 11, fontWeight: 900, transform: 'rotate(180deg)' }}>{label}</span>
        </>
      )}
    </div>
  );
}

/** Tiny row of a player's INACTIVE faces — Flip's shared information. */
function BacksideRow({ faces, side }: { faces: Face[]; side: 'light' | 'dark' }) {
  const off = side === 'light' ? 'dark' : 'light';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {faces.map((f, i) => <CardFace key={i} face={f} side={off} mini />)}
    </div>
  );
}

function eventText(view: UnoView, summary: TvViewProps['state']['summary']): string | null {
  if (!view.lastEvent) return null;
  const who = view.lastEventSeat !== null ? seatName(summary as never, view.lastEventSeat) : '';
  if (view.lastEvent === 'CAUGHT_UNO' && view.lastEventTarget !== null) {
    return `🚨 ${who} caught ${seatName(summary as never, view.lastEventTarget)} without UNO — +2 cards!`;
  }
  return `${who} ${view.lastEvent}`;
}

function turnSeatOf(view: UnoView): Seat {
  return view.order[view.turnIndex]!;
}

function catchTargets(view: UnoView, me?: Seat): Seat[] {
  return view.order.filter(
    (s) => s !== me && view.handCounts[s] === 1 && !view.unoDeclared.includes(s),
  );
}

function TvView({ state }: TvViewProps<UnoView>) {
  const view = state.view;
  if (!view) return null;
  const dark = view.side === 'dark';
  const turnSeat = turnSeatOf(view);
  const isFlip = view.variant === 'uno-flip';
  return (
    <div className="tv-main" style={dark ? {
      background: 'radial-gradient(700px 500px at 50% 40%, rgba(143,75,255,0.16), transparent 70%)',
      borderRadius: '2vmin',
    } : undefined}>
      <div className="tv-board" style={{ flexDirection: 'column', gap: '3vmin' }}>
        {isFlip && (
          <div className={`badge ${dark ? '' : 'on'}`} style={dark ? {
            background: 'linear-gradient(135deg, #8f4bff, #ff2d8f)', color: 'white', fontSize: '2vmin',
          } : { fontSize: '2vmin' }}>
            {dark ? '🌙 DARK SIDE' : '☀️ LIGHT SIDE'}
          </div>
        )}
        <div style={{ display: 'flex', gap: '4vmin', alignItems: 'center' }}>
          {/* draw pile */}
          <div style={{ textAlign: 'center' }}>
            <div
              key={view.drawPileSize}
              className="count-bump"
              style={{
                width: '16vmin', height: '24vmin', minWidth: 90, minHeight: 135, borderRadius: 10,
                background: dark
                  ? 'repeating-linear-gradient(135deg, #2d1b4e, #2d1b4e 8px, #1c1030 8px, #1c1030 16px)'
                  : 'repeating-linear-gradient(135deg, #1b2038, #1b2038 8px, #232847 8px, #232847 16px)',
                border: `3px dashed ${dark ? '#8f4bff' : '#444b78'}`, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '3vmin', fontWeight: 800, color: dark ? '#b79aff' : '#69709c',
              }}
            >
              {view.drawPileSize}
            </div>
            <p className="dim" style={{ fontSize: '1.8vmin' }}>draw pile</p>
          </div>
          {view.discardTop && (
            <div style={{ textAlign: 'center' }} key={view.discardCount} className="pop-in">
              <CardFace face={view.discardTop} big side={view.side} />
              <p className="dim" style={{ fontSize: '1.8vmin' }}>discard</p>
            </div>
          )}
          <div style={{ fontSize: '5vmin' }}>{view.direction === 1 ? '↻' : '↺'}</div>
        </div>
        {view.currentColor && (
          <div style={{ fontSize: '2.4vmin' }}>
            Color:{' '}
            <span style={{ color: (dark ? DARK_HEX : LIGHT_HEX)[view.currentColor], fontWeight: 800 }}>
              {(dark ? DARK_NAME : COLOR_NAME)[view.currentColor]}
            </span>
          </div>
        )}
        {view.lastEvent && (
          <div className="dim" style={{ fontSize: '2.2vmin' }} key={`${view.lastEvent}-${view.discardCount}-${view.drawPileSize}`}>
            {eventText(view, state.summary)}
          </div>
        )}
      </div>
      <div className="tv-sidebar">
        {state.summary.players
          .filter((p) => view.order.includes(p.seat))
          .map((p) => {
            const count = view.handCounts[p.seat] ?? 0;
            const declared = view.unoDeclared.includes(p.seat);
            const onOne = count === 1;
            return (
              <div key={p.seat}
                className={`tv-player-chip ${p.seat === turnSeat ? 'active' : ''}`}
                style={{ flexWrap: 'wrap' }}>
                <span className={`token seat-color-${p.seat % 6}`} />
                <span className="grow">
                  {p.displayName}
                  {declared && <span className="badge gold-badge" style={{ marginLeft: 6 }}>UNO! 🔔</span>}
                  {onOne && !declared && <span className="badge" style={{ marginLeft: 6, color: 'var(--danger)' }}>1 card</span>}
                </span>
                <strong key={count} className="count-bump">{count}</strong>
                {!p.connected && <span className="dc">⚠</span>}
                {isFlip && view.backsides?.[p.seat] && view.backsides[p.seat]!.length > 0 && (
                  <div style={{ width: '100%' }}>
                    <BacksideRow faces={view.backsides[p.seat]!} side={view.side} />
                  </div>
                )}
              </div>
            );
          })}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<UnoView, UnoMove>) {
  const view = state.view;
  const [wildIdx, setWildIdx] = useState<number | null>(null);
  const prevHandLen = useRef<number>(view?.hand?.length ?? 0);
  if (!view) return null;
  const dark = view.side === 'dark';
  const isFlip = view.variant === 'uno-flip';
  const turnSeat = turnSeatOf(view);
  const myTurn = turnSeat === yourSeat && state.status === 'active';
  const legal = (state.legalMoves ?? []) as UnoMove[];
  const playableIdx = new Set(legal.filter((m) => m.kind === 'PLAY').map((m) => (m as { card: number }).card));
  const canDraw = legal.some((m) => m.kind === 'DRAW');
  const canPass = legal.some((m) => m.kind === 'PASS');
  const canDeclare = legal.some((m) => m.kind === 'DECLARE_UNO');
  const targets = catchTargets(view, yourSeat);

  // deal-in animation: cards appended since the last render fly in
  const handLen = view.hand?.length ?? 0;
  const dealtFrom = handLen > prevHandLen.current ? prevHandLen.current : handLen;
  prevHandLen.current = handLen;

  const play = (idx: number, face: Face) => {
    if (face.color === 'W') {
      setWildIdx(idx);
    } else {
      submitMove('PLAY', { card: idx });
    }
  };

  const colorHex = dark ? DARK_HEX : LIGHT_HEX;
  const colorName = dark ? DARK_NAME : COLOR_NAME;

  return (
    <div className="page">
      {isFlip && (
        <div className="row center-h">
          <span className="badge" style={dark ? {
            background: 'linear-gradient(135deg, #8f4bff, #ff2d8f)', color: 'white',
          } : undefined}>
            {dark ? '🌙 DARK SIDE' : '☀️ LIGHT SIDE'}
          </span>
        </div>
      )}
      <div className="card center">
        <div className="row" style={{ justifyContent: 'center' }}>
          {view.discardTop && (
            <span key={view.discardCount} className="pop-in" style={{ display: 'inline-block' }}>
              <CardFace face={view.discardTop} side={view.side} />
            </span>
          )}
          <div>
            {view.currentColor && (
              <p style={{ color: colorHex[view.currentColor], fontWeight: 800 }}>{colorName[view.currentColor]}</p>
            )}
            <p className="dim small">{view.drawPileSize} in pile · {view.direction === 1 ? '↻' : '↺'}</p>
          </div>
        </div>

        {(canDeclare || targets.length > 0) && state.status === 'active' && (
          <div className="action-bar">
            {canDeclare && (
              <button className="gold big" style={{ width: 'auto' }} onClick={() => submitMove('DECLARE_UNO', {})}>
                🔔 UNO!
              </button>
            )}
            {targets.map((t) => (
              <button key={t} style={{ background: 'var(--danger)' }}
                onClick={() => submitMove('CATCH_UNO', { target: t })}>
                🚨 Catch {seatName(state.summary, t)}!
              </button>
            ))}
          </div>
        )}

        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <Prompt>{view.phase === 'PLAY_DRAWN_OR_PASS' ? 'Play the drawn card or pass' : 'Your turn!'}</Prompt>
        ) : (
          <p className="waiting">Waiting for {seatName(state.summary, turnSeat)}</p>
        )}
        {view.lastEvent && <p className="event-line" key={`${view.lastEvent}-${view.discardCount}-${view.drawPileSize}`}>{eventText(view, state.summary)}</p>}
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
                side={view.side}
                dealIn={idx >= dealtFrom}
                onClick={myTurn ? () => play(idx, face) : undefined}
                disabled={myTurn && !playableIdx.has(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {isFlip && view.backsides && (
        <div className="card">
          <h3>Everyone's {dark ? 'light' : 'dark'} sides (visible to all)</h3>
          {view.order.filter((s) => s !== yourSeat).map((s) => (
            <div key={s} className="row" style={{ alignItems: 'flex-start' }}>
              <span className="dim small" style={{ minWidth: 80 }}>{seatName(state.summary, s)}</span>
              <BacksideRow faces={view.backsides![s] ?? []} side={view.side} />
            </div>
          ))}
          <p className="dim small">These are the flip sides of the cards they hold — plan your ⟲ flips!</p>
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
                  style={{ background: colorHex[c], flex: 1 }}
                  onClick={() => {
                    submitMove('PLAY', { card: wildIdx, chooseColor: c });
                    setWildIdx(null);
                  }}
                >
                  {colorName[c]}
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
