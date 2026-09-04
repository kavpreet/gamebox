import React, { useState } from 'react';
import type { ScattergoriesPublic, ScattergoriesMove } from '@gamebox/game-scattergories';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import { seatName, SeatDot, WinnerBanner } from './common.js';

type ScatView = ScattergoriesPublic & { yourAnswers: string[] | null };

function Scoreboard({ view, state }: { view: ScatView; state: { summary: TvViewProps['state']['summary']; activeSeats: number[] } }) {
  return (
    <>
      {view.order.map((s) => (
        <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}>
          <SeatDot summary={state.summary} seat={s} />
          <span className="grow">
            {seatName(state.summary, s)}
            {view.phase !== 'DONE' && view.submitted.includes(s) && <span className="dim small"> ✓</span>}
          </span>
          <strong>{view.scores[s] ?? 0}</strong>
        </div>
      ))}
    </>
  );
}

function TvView({ state }: TvViewProps<ScatView>) {
  const view = state.view;
  if (!view) return null;
  const waiting = view.order.filter((s) => !view.submitted.includes(s));
  const lastRound = view.history[view.history.length - 1];
  return (
    <div className="tv-main">
      <div className="tv-board" style={{ flexDirection: 'column', gap: '2vmin', padding: '3vmin', justifyContent: 'flex-start', overflow: 'auto' }}>
        <h2 style={{ margin: 0 }}>
          Round {view.round}/{view.totalRounds} — letter{' '}
          <span style={{
            color: 'var(--gold)', fontSize: '1.8em', fontWeight: 900,
            textShadow: '0 0 24px rgba(255,185,48,0.5)',
          }}>{view.letter}</span>
        </h2>
        {view.phase === 'ANSWER' && (
          <>
            <ol style={{ columns: 2, fontSize: '2.4vmin', lineHeight: 1.8, alignSelf: 'stretch', paddingLeft: '4vmin' }}>
              {view.categories.map((c, i) => <li key={i}>{c}</li>)}
            </ol>
            <p className="dim">Waiting on: {waiting.map((s) => seatName(state.summary, s)).join(', ') || '—'}</p>
          </>
        )}
        {view.phase === 'VOTE' && view.answers && (
          <div style={{ alignSelf: 'stretch', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '1.8vmin', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 4 }}>Category</th>
                  {view.order.map((s) => <th key={s} style={{ padding: 4 }}>{seatName(state.summary, s)}</th>)}
                </tr>
              </thead>
              <tbody>
                {view.categories.map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #333a63' }}>
                    <td style={{ padding: 4 }} className="dim">{c}</td>
                    {view.order.map((s) => (
                      <td key={s} style={{ padding: 4, textAlign: 'center' }}>
                        {view.answers![s]?.[i] || <span className="dim">—</span>}
                        {(view.vetoCounts?.[s]?.[i] ?? 0) > 0 && <span style={{ color: '#e94560' }}> ✗{view.vetoCounts![s]![i]}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dim">Players are reviewing answers… waiting on {waiting.map((s) => seatName(state.summary, s)).join(', ')}</p>
          </div>
        )}
        {view.phase === 'DONE' && lastRound && (
          <p style={{ fontSize: '3vmin' }}>Final scores are in! 🎉</p>
        )}
        {view.lastEvent && <p className="dim small">{view.lastEvent}</p>}
      </div>
      <div className="tv-sidebar">
        <Scoreboard view={view} state={state} />
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

function AnswerForm({ view, submitMove }: { view: ScatView; submitMove: PlayerViewProps['submitMove'] }) {
  const [answers, setAnswers] = useState<string[]>(() => view.yourAnswers ?? Array(view.categories.length).fill(''));
  const set = (i: number, v: string) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)));
  return (
    <div className="card">
      <h3>Things starting with “{view.letter}”</h3>
      {view.categories.map((c, i) => (
        <label key={i} style={{ display: 'block', marginBottom: 8 }}>
          <span className="dim small">{i + 1}. {c}</span>
          <input
            value={answers[i] ?? ''}
            onChange={(e) => set(i, e.target.value)}
            maxLength={60}
            style={{ width: '100%' }}
            placeholder={`${view.letter}…`}
          />
        </label>
      ))}
      <button onClick={() => void submitMove('SUBMIT', { answers })} style={{ width: '100%' }}>
        Submit answers
      </button>
    </div>
  );
}

function VoteForm({ view, yourSeat, summary, submitMove }: {
  view: ScatView;
  yourSeat: number;
  summary: TvViewProps['state']['summary'];
  submitMove: PlayerViewProps['submitMove'];
}) {
  const [vetoes, setVetoes] = useState<Set<string>>(new Set());
  const toggle = (seat: number, index: number) => {
    const k = `${seat}:${index}`;
    setVetoes((v) => {
      const next = new Set(v);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  return (
    <div className="card">
      <h3>Challenge answers</h3>
      <p className="dim small">Tap an opponent's answer to veto it (doesn't start with {view.letter} / isn't a real thing). A majority veto disallows it.</p>
      {view.categories.map((c, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <span className="dim small">{i + 1}. {c}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {view.order.map((s) => {
              const a = view.answers?.[s]?.[i] ?? '';
              if (!a) return null;
              const mine = s === yourSeat;
              const vetoed = vetoes.has(`${s}:${i}`);
              return (
                <span
                  key={s}
                  onClick={mine ? undefined : () => toggle(s, i)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 14,
                    background: vetoed ? '#8c2438' : '#232847',
                    border: mine ? '1px solid var(--gold)' : '1px solid #333a63',
                    textDecoration: vetoed ? 'line-through' : 'none',
                    cursor: mine ? 'default' : 'pointer',
                  }}
                >
                  {seatName(summary, s)}: {a}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <button
        style={{ width: '100%' }}
        onClick={() => {
          const list = [...vetoes].map((k) => {
            const [seat, index] = k.split(':');
            return { seat: Number(seat), index: Number(index) };
          });
          void submitMove('VOTE', { vetoes: list });
        }}
      >
        {vetoes.size > 0 ? `Confirm ${vetoes.size} veto${vetoes.size > 1 ? 'es' : ''}` : 'Looks good — no vetoes'}
      </button>
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<ScatView, ScattergoriesMove>) {
  const view = state.view;
  if (!view) return null;
  const submitted = view.submitted.includes(yourSeat);
  const lastRound = view.history[view.history.length - 1];

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <strong>Round {view.round}/{view.totalRounds}</strong>
          <strong>Letter: <span style={{ color: 'var(--gold)' }}>{view.letter}</span></strong>
          <strong>You: {view.scores[yourSeat] ?? 0} pts</strong>
        </div>
        {state.status === 'completed' && <WinnerBanner state={state} />}
      </div>

      {state.status === 'active' && view.phase === 'ANSWER' && !submitted && (
        <AnswerForm key={`${view.round}-answer`} view={view} submitMove={submitMove} />
      )}
      {state.status === 'active' && view.phase === 'VOTE' && !submitted && (
        <VoteForm key={`${view.round}-vote`} view={view} yourSeat={yourSeat} summary={state.summary} submitMove={submitMove} />
      )}
      {state.status === 'active' && submitted && (
        <div className="card">
          <p className="waiting">
            ✓ Submitted — waiting for {view.order.filter((s) => !view.submitted.includes(s)).map((s) => seatName(state.summary, s)).join(', ')}
          </p>
        </div>
      )}

      {lastRound && (view.phase === 'DONE' || view.phase === 'ANSWER') && view.history.length > 0 && (
        <div className="card">
          <h3>Last round ({lastRound.letter})</h3>
          {view.order.map((s) => (
            <p key={s} className="small">
              <strong>{seatName(state.summary, s)}</strong>: +{lastRound.points[s] ?? 0} pts
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export const scattergoriesUi: GameUi = { slug: 'scattergories', PlayerView, TvView };
