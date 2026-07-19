import React, { useState } from 'react';
import type { CodenamesPublic, CodenamesMove, CardKind } from '@gamebox/game-codenames';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, WinnerBanner } from './common.js';

type CodenamesView = CodenamesPublic & { key: CardKind[] | null };

const TEAM_NAME = ['Red', 'Blue'];
const TEAM_COLOR = ['#ff4d6d', '#5a8fe8'];

const KIND_BG: Record<CardKind, string> = {
  team0: '#c22d4a',
  team1: '#2b5ac2',
  neutral: '#8a7f68',
  assassin: '#08080e',
};

function cardStyle(revealed: CardKind | null, keyKind: CardKind | null, clickable: boolean): React.CSSProperties {
  return {
    borderRadius: 10,
    padding: '2.2vmin 0.5vmin',
    textAlign: 'center',
    fontWeight: 800,
    fontSize: 'clamp(10px, 1.8vmin, 18px)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    background: revealed
      ? `linear-gradient(150deg, ${KIND_BG[revealed]}, ${KIND_BG[revealed]}cc)`
      : 'linear-gradient(150deg, #efe6cd, #ddcda6)',
    color: revealed ? '#fff' : '#3c3423',
    border: keyKind && !revealed ? `3px solid ${KIND_BG[keyKind]}` : '2px solid rgba(0,0,0,0.35)',
    boxShadow: revealed ? 'inset 0 2px 8px rgba(0,0,0,0.35)' : '0 2px 6px rgba(3,5,16,0.4), inset 0 1px 0 rgba(255,255,255,0.5)',
    cursor: clickable ? 'pointer' : 'default',
    transition: 'transform 0.1s',
    userSelect: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

function Board({
  view,
  onGuess,
}: {
  view: CodenamesView;
  onGuess?: (i: number) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1vmin', width: '100%' }}>
      {view.words.map((word, i) => {
        const revealed = view.revealed[i] ?? null;
        const clickable = Boolean(onGuess && !revealed);
        return (
          <div
            key={i}
            style={cardStyle(revealed, view.key ? view.key[i]! : null, clickable)}
            onClick={clickable ? () => onGuess!(i) : undefined}
          >
            {word}
          </div>
        );
      })}
    </div>
  );
}

function StatusLine({ view, summary }: { view: CodenamesView; summary: TvViewProps['state']['summary'] }) {
  const t = view.currentTeam;
  return (
    <p className="center" style={{ color: TEAM_COLOR[t], fontWeight: 700 }}>
      {view.winnerTeam !== null
        ? `${TEAM_NAME[view.winnerTeam]} team wins!`
        : view.phase === 'CLUE'
          ? `${TEAM_NAME[t]} spymaster (${seatName(summary as never, view.spymasters[t]!)}) is thinking of a clue…`
          : `${TEAM_NAME[t]} team guessing — clue: “${view.clue?.word} ${view.clue?.count}” (${view.guessesLeft} guesses left)`}
    </p>
  );
}

function TvView({ state }: TvViewProps<CodenamesView>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ flexDirection: 'column', gap: '1.5vmin', padding: '2vmin' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignSelf: 'stretch' }}>
          <strong style={{ color: TEAM_COLOR[0] }}>Red: {view.remaining[0]} left</strong>
          <StatusLine view={view} summary={state.summary} />
          <strong style={{ color: TEAM_COLOR[1] }}>Blue: {view.remaining[1]} left</strong>
        </div>
        <Board view={view} />
        {view.lastEvent && <p className="dim">{view.lastEvent}</p>}
      </div>
      <div className="tv-sidebar">
        {state.summary.players.map((p) => (
          <div key={p.seat} className={`tv-player-chip ${state.activeSeats.includes(p.seat) ? 'active' : ''}`}>
            <span className="token" style={{ background: TEAM_COLOR[(view.teamOf[p.seat] ?? 0) as number] }} />
            <span className="grow">
              {p.displayName}
              {view.spymasters[view.teamOf[p.seat] as number] === p.seat && <span className="dim small"> · 🕵️</span>}
            </span>
            {!p.connected && <span className="dc">⚠</span>}
          </div>
        ))}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<CodenamesView, CodenamesMove>) {
  const view = state.view;
  const [clueWord, setClueWord] = useState('');
  const [clueCount, setClueCount] = useState(1);
  if (!view) return null;

  const myTeam = view.teamOf[yourSeat] as number;
  const iAmSpymaster = view.spymasters[myTeam] === yourSeat;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const cluing = myTurn && view.phase === 'CLUE' && iAmSpymaster;
  const guessing = myTurn && view.phase === 'GUESS' && !iAmSpymaster;

  return (
    <div className="page">
      <div className="card">
        <p className="center">
          You are on the <strong style={{ color: TEAM_COLOR[myTeam] }}>{TEAM_NAME[myTeam]}</strong> team
          {iAmSpymaster && ' — 🕵️ Spymaster'}
        </p>
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : (
          <StatusLine view={view} summary={state.summary} />
        )}
        {view.lastEvent && <p className="dim small center">{view.lastEvent}</p>}
      </div>

      {cluing && (
        <div className="card">
          <h3>Give a clue</h3>
          <div className="row">
            <input
              value={clueWord}
              onChange={(e) => setClueWord(e.target.value)}
              placeholder="one word"
              maxLength={30}
              style={{ flex: 1 }}
            />
            <select value={clueCount} onChange={(e) => setClueCount(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button
              disabled={!clueWord.trim()}
              onClick={async () => {
                const err = await submitMove('CLUE', { word: clueWord.trim(), count: clueCount });
                if (!err) setClueWord('');
              }}
            >
              Clue
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <Board
          view={view}
          onGuess={guessing ? (i) => void submitMove('GUESS', { index: i }) : undefined}
        />
        {guessing && (
          <button className="secondary" style={{ marginTop: 12 }} onClick={() => void submitMove('PASS', {})}>
            Stop guessing (pass)
          </button>
        )}
        {iAmSpymaster && view.key && (
          <p className="dim small">Borders show the secret key — only you (and the other spymaster) see this.</p>
        )}
      </div>
    </div>
  );
}

export const codenamesUi: GameUi = { slug: 'codenames', PlayerView, TvView };
