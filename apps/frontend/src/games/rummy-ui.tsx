import React, { useState } from 'react';
import type { RummyPublic, RummyMove, Card, Meld } from '@gamebox/game-rummy';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatDot, WinnerBanner, Prompt, Waiting, EventLine } from './common.js';

type RummyView = RummyPublic & { hand: Card[] | null };

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_COLOR: Record<string, string> = { S: '#22263e', H: '#d22c4c', D: '#d22c4c', C: '#22263e' };
const RANK_LABEL = (r: number) => (r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r));

function PlayingCard({
  card,
  onClick,
  selected,
  small,
  faded,
}: {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  faded?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`hand-card${onClick ? ' clickable' : ''}${selected ? ' lifted' : ''}`}
      style={{
        position: 'relative',
        width: small ? 38 : 52,
        height: small ? 54 : 74,
        background: 'linear-gradient(150deg, #ffffff, #e9ebf5)',
        border: '1px solid #b9bed6',
        fontSize: small ? 13 : 17,
        color: SUIT_COLOR[card.suit],
        opacity: faded ? 0.45 : 1,
      }}
    >
      <span style={{ position: 'absolute', top: 2, left: 4, fontSize: small ? 10 : 12, fontWeight: 900, lineHeight: 1 }}>
        {RANK_LABEL(card.rank)}<br />{SUIT_GLYPH[card.suit]}
      </span>
      <span style={{ fontSize: small ? 18 : 26 }}>{SUIT_GLYPH[card.suit]}</span>
      <span style={{ position: 'absolute', bottom: 2, right: 4, fontSize: small ? 10 : 12, fontWeight: 900, lineHeight: 1, transform: 'rotate(180deg)' }}>
        {RANK_LABEL(card.rank)}<br />{SUIT_GLYPH[card.suit]}
      </span>
    </div>
  );
}

function MeldRow({ melds, onMeldClick, highlight }: { melds: Meld[]; onMeldClick?: (i: number) => void; highlight?: Set<number> }) {
  if (melds.length === 0) return <p className="dim small">No melds on the table yet</p>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {melds.map((meld, i) => (
        <div
          key={i}
          onClick={onMeldClick ? () => onMeldClick(i) : undefined}
          style={{
            display: 'flex',
            gap: 2,
            padding: 4,
            borderRadius: 8,
            border: highlight?.has(i) ? '2px solid #2ec4b6' : '2px solid transparent',
            cursor: onMeldClick && highlight?.has(i) ? 'pointer' : 'default',
          }}
        >
          {meld.cards.map((card, j) => (
            <PlayingCard key={j} card={card} small />
          ))}
        </div>
      ))}
    </div>
  );
}

function TvView({ state }: TvViewProps<RummyView>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ flexDirection: 'column', gap: '2vmin', justifyContent: 'flex-start', padding: '2vmin' }}>
        <div className="row" style={{ gap: '3vmin' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 70, height: 96, borderRadius: 8, border: '3px dashed #444b78', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#69709c', fontSize: 22 }}>
              {view.stockSize}
            </div>
            <p className="dim small">stock</p>
          </div>
          {view.discardTop && (
            <div style={{ textAlign: 'center' }}>
              <PlayingCard card={view.discardTop} />
              <p className="dim small">discard</p>
            </div>
          )}
        </div>
        <div style={{ alignSelf: 'stretch' }}>
          <MeldRow melds={view.melds} />
        </div>
        {view.lastEvent && <p className="dim">{view.lastEvent}</p>}
      </div>
      <div className="tv-sidebar">
        {state.summary.players
          .filter((p) => view.order.includes(p.seat))
          .map((p) => (
            <div key={p.seat} className={`tv-player-chip ${state.activeSeats.includes(p.seat) ? 'active' : ''}`}>
              <SeatDot summary={state.summary} seat={p.seat} />
              <span className="grow">{p.displayName}</span>
              <strong>{view.handCounts[p.seat] ?? 0}</strong>
            </div>
          ))}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<RummyView, RummyMove>) {
  const view = state.view;
  const [selected, setSelected] = useState<number[]>([]);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const legal = (state.legalMoves ?? []) as RummyMove[];
  const drawing = myTurn && view.phase === 'DRAW';
  const acting = myTurn && view.phase === 'ACT';

  const meldable = new Set(
    legal
      .filter((m) => m.kind === 'MELD')
      .map((m) => [...(m as { cards: number[] }).cards].sort((a, b) => a - b).join(',')),
  );
  const selKey = [...selected].sort((a, b) => a - b).join(',');
  const canMeldSelection = meldable.has(selKey) && selected.length >= 3;

  // lay-off targets for a single selected card
  const layoffMelds = new Set(
    selected.length === 1
      ? legal
          .filter((m) => m.kind === 'LAYOFF' && (m as { card: number }).card === selected[0])
          .map((m) => (m as { meld: number }).meld)
      : [],
  );

  const toggle = (i: number) => {
    setSelected((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
  };

  const doMove = async (kind: string, payload: unknown) => {
    setSelected([]);
    await submitMove(kind, payload);
  };

  return (
    <div className="page">
      <div className="card">
        <div className="row" style={{ justifyContent: 'center' }}>
          <button
            className="secondary"
            disabled={!drawing}
            onClick={() => doMove('DRAW', { source: 'stock' })}
          >
            Draw ({view.stockSize})
          </button>
          {view.discardTop && (
            <div onClick={drawing ? () => doMove('DRAW', { source: 'discard' }) : undefined}>
              <PlayingCard card={view.discardTop} onClick={drawing ? () => {} : undefined} />
            </div>
          )}
        </div>
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          <Prompt>{drawing ? 'Draw from stock or take the discard' : 'Meld, lay off, then discard one card'}</Prompt>
        ) : (
          <Waiting state={state} />
        )}
        <EventLine text={view.lastEvent} />
      </div>

      <div className="card">
        <h3>Table</h3>
        <MeldRow
          melds={view.melds}
          highlight={layoffMelds as Set<number>}
          onMeldClick={
            acting && selected.length === 1
              ? (m) => layoffMelds.has(m) && doMove('LAYOFF', { card: selected[0], meld: m })
              : undefined
          }
        />
      </div>

      {view.hand && (
        <div className="card">
          <div className="row between">
            <h3>Your hand ({view.hand.length})</h3>
            <div className="row">
              {acting && canMeldSelection && (
                <button onClick={() => doMove('MELD', { cards: selected })}>Meld</button>
              )}
              {acting && selected.length === 1 && (
                <button className="secondary" onClick={() => doMove('DISCARD', { card: selected[0] })}>
                  Discard
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {view.hand.map((card, i) => (
              <PlayingCard
                key={i}
                card={card}
                selected={selected.includes(i)}
                onClick={acting ? () => toggle(i) : undefined}
              />
            ))}
          </div>
          {acting && selected.length === 1 && layoffMelds.size > 0 && (
            <p className="dim small">Tap a highlighted meld above to lay this card off</p>
          )}
        </div>
      )}
    </div>
  );
}

export const rummyUi: GameUi = { slug: 'rummy', PlayerView, TvView };
