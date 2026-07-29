import React, { useEffect, useRef, useState } from 'react';
import type { GameSummary } from '@gamebox/shared-types';
import type { LudoPublic, LudoMove } from '@gamebox/game-ludo';
import { HOME, SAFE_GLOBALS, globalSquare, destinationOf } from '@gamebox/game-ludo';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import {
  seatColor, SeatToken, SeatTokens, WinnerBanner, Prompt, Waiting, Die, EventLine, useBoardFit,
  FxDefs, HandGlyph, CaptureBlast, RebirthPulse, type HandPhase,
} from './common.js';

const C = 40; // cell size

/** The 52 main-track cells of the classic 15×15 board, in travel order. */
const TRACK: [number, number][] = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7], [0, 6],
];

/** Home-column cells per entry index (order position), progress 51–55. */
const HOME_COLUMNS: [number, number][][] = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],   // entry 0 (left arm)
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],   // entry 13 (top arm)
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], // entry 26 (right arm)
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], // entry 39 (bottom arm)
];

/** Yard token spots per order position (TL, TR, BR, BL corners). */
const YARDS: [number, number][][] = [
  [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],
  [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
  [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
  [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
];
const YARD_BOXES: [number, number][] = [[0, 0], [9, 0], [9, 9], [0, 9]];

function center(cell: [number, number]): { x: number; y: number } {
  return { x: cell[0] * C + C / 2, y: cell[1] * C + C / 2 };
}

function orderPosOf(view: LudoPublic, seat: number): number {
  return Math.round((view.entries[seat] ?? 0) / 13) % 4;
}

/** Board coordinates for one token at an arbitrary progress value (yard, track, home column, or finished). */
function progressXY(view: LudoPublic, seat: number, progress: number, token: number): { x: number; y: number } {
  const orderPos = orderPosOf(view, seat);
  if (progress === -1) {
    const [gx, gy] = YARDS[orderPos]![token]!;
    return { x: gx * C + C / 2, y: gy * C + C / 2 };
  }
  if (progress === HOME) {
    const homeEntry = HOME_COLUMNS[orderPos]![4]!;
    const cx = (homeEntry[0]! * 0.4 + 7 * 0.6) * C + C / 2;
    const cy = (homeEntry[1]! * 0.4 + 7 * 0.6) * C + C / 2;
    return { x: cx + token * 5 - 8, y: cy };
  }
  if (progress > 50) {
    return center(HOME_COLUMNS[orderPos]![progress - 51]!);
  }
  const g = globalSquare(view, seat, progress);
  return center(TRACK[g ?? 0]!);
}

interface TokenSpot {
  seat: number;
  token: number;
  x: number;
  y: number;
}

function tokenSpots(view: LudoPublic): TokenSpot[] {
  const spots: TokenSpot[] = [];
  for (const seat of view.order) {
    (view.tokens[seat] ?? []).forEach((progress, token) => {
      const { x, y } = progressXY(view, seat, progress, token);
      spots.push({ seat, token, x, y });
    });
  }
  // fan out shared cells
  const byXY = new Map<string, TokenSpot[]>();
  for (const s of spots) {
    const k = `${Math.round(s.x)},${Math.round(s.y)}`;
    (byXY.get(k) ?? byXY.set(k, []).get(k)!).push(s);
  }
  for (const group of byXY.values()) {
    if (group.length > 1) {
      group.forEach((s, i) => {
        s.x += (i - (group.length - 1) / 2) * 10;
      });
    }
  }
  return spots;
}

interface LudoAnim {
  seat: number;
  token: number;
  x: number;
  y: number;
  phase: HandPhase;
  t: number;
}

interface LudoCaptureFx {
  seat: number;
  token: number;
  oldXY: { x: number; y: number };
  yardXY: { x: number; y: number };
  stage: 'ghost' | 'blast' | 'rebirth';
}

function cloneTokens(tokens: Record<number, number[]>): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const [seat, arr] of Object.entries(tokens)) out[Number(seat)] = [...arr];
  return out;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

const GRAB = 220;
const DROP = 260;

/**
 * Diffs token progress between renders and drives the drama: a hand grabs
 * the advancing token, hops (or glides, out of the yard) it to its square,
 * and sets it down. Any token sent home stays as a "ghost" on its square
 * until the mover lands, explodes, then pops back in at its yard spot.
 */
function useLudoAnimation(view: LudoPublic): { anim: LudoAnim | null; captures: LudoCaptureFx[] } {
  const [anim, setAnim] = useState<LudoAnim | null>(null);
  const [captures, setCaptures] = useState<LudoCaptureFx[]>([]);
  const prevRef = useRef<Record<number, number[]> | null>(null);
  const moveKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (!prev) {
      prevRef.current = cloneTokens(view.tokens);
      return;
    }

    let found: { seat: number; token: number; oldP: number; newP: number } | null = null;
    const sentHome: { seat: number; token: number; oldP: number }[] = [];
    for (const seat of view.order) {
      const oldArr = prev[seat] ?? [];
      const newArr = view.tokens[seat] ?? [];
      for (let i = 0; i < newArr.length; i++) {
        const oldP = oldArr[i] ?? -1;
        const newP = newArr[i]!;
        if (newP === oldP) continue;
        if (newP === -1) {
          if (oldP >= 0) sentHome.push({ seat, token: i, oldP });
          continue;
        }
        const advanced = oldP === -1 || newP > oldP;
        if (!advanced) continue;
        const jump = newP - (oldP === -1 ? 0 : oldP);
        if (!found || jump > found.newP - found.oldP) found = { seat, token: i, oldP, newP };
      }
    }
    prevRef.current = cloneTokens(view.tokens);
    if (!found && sentHome.length === 0) return;

    const moveKey = `${found?.seat}-${found?.token}-${found?.oldP}-${found?.newP}-${sentHome.map((c) => `${c.seat}.${c.token}`).join('+')}`;
    if (moveKeyRef.current === moveKey) return;
    moveKeyRef.current = moveKey;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let arriveMs = 0;

    if (found) {
      const { seat, token, oldP, newP } = found;
      const pts: { x: number; y: number }[] = [];
      let segMs: number;
      if (oldP === -1) {
        pts.push(progressXY(view, seat, -1, token), progressXY(view, seat, newP, token));
        segMs = 420;
      } else {
        for (let p = oldP; p <= newP; p++) pts.push(progressXY(view, seat, p, token));
        segMs = 135;
      }
      const moveMs = (pts.length - 1) * segMs;
      arriveMs = GRAB + moveMs;
      const total = GRAB + moveMs + DROP;
      const start = performance.now();
      const frame = (now: number) => {
        if (cancelled) return;
        const el = now - start;
        if (el >= total) {
          setAnim(null);
          return;
        }
        if (el < GRAB) {
          setAnim({ seat, token, ...pts[0]!, phase: 'grab', t: el / GRAB });
        } else if (el < GRAB + moveMs) {
          const k = (el - GRAB) / segMs;
          const i = Math.min(Math.floor(k), pts.length - 2);
          const e = easeInOutQuad(k - i);
          const a = pts[i]!, b = pts[i + 1]!;
          const lift = Math.sin((k - i) * Math.PI) * (pts.length > 2 ? 5 : 8);
          setAnim({
            seat, token,
            x: a.x + (b.x - a.x) * e,
            y: a.y + (b.y - a.y) * e - lift,
            phase: 'drag',
            t: (el - GRAB) / moveMs,
          });
        } else {
          setAnim({ seat, token, ...pts[pts.length - 1]!, phase: 'drop', t: (el - GRAB - moveMs) / DROP });
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    if (sentHome.length > 0) {
      const fx = sentHome.map((c) => ({
        seat: c.seat,
        token: c.token,
        oldXY: progressXY(view, c.seat, c.oldP, c.token),
        yardXY: progressXY(view, c.seat, -1, c.token),
        stage: 'ghost' as const,
      }));
      setCaptures(fx);
      timers.push(setTimeout(() => !cancelled && setCaptures(fx.map((f) => ({ ...f, stage: 'blast' }))), arriveMs));
      timers.push(setTimeout(() => !cancelled && setCaptures(fx.map((f) => ({ ...f, stage: 'rebirth' }))), arriveMs + 420));
      timers.push(setTimeout(() => !cancelled && setCaptures([]), arriveMs + 1500));
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(view.tokens)]);

  return { anim, captures };
}

function Board({
  view,
  summary,
  yourSeat,
  movable,
  onMoveToken,
}: {
  view: LudoPublic;
  summary: GameSummary;
  yourSeat?: number;
  movable?: number[];
  onMoveToken?: (token: number) => void;
}) {
  const W = 15 * C;
  const { anim, captures } = useLudoAnimation(view);
  const fit = useBoardFit();
  const hiddenByFx = new Set(captures.map((c) => `${c.seat}-${c.token}`));

  return (
    <svg viewBox={`0 0 ${W} ${W}`} preserveAspectRatio={fit}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
      <FxDefs />
      <defs>
        <radialGradient id="ludo-bg" cx="50%" cy="35%" r="90%">
          <stop offset="0%" stopColor="#1c2350" />
          <stop offset="60%" stopColor="#131737" />
          <stop offset="100%" stopColor="#0c0f24" />
        </radialGradient>
      </defs>
      <rect width={W} height={W} fill="url(#ludo-bg)" rx={12} />
      {/* yards */}
      {YARD_BOXES.map(([bx, by], i) => {
        const seat = view.order.find((s) => orderPosOf(view, s) === i);
        return (
          <g key={i}>
            <rect x={bx * C + 4} y={by * C + 4} width={6 * C - 8} height={6 * C - 8} rx={10}
              fill={seat !== undefined ? seatColor(summary, seat) : '#1b2038'} opacity={seat !== undefined ? 0.25 : 1} />
            {seat !== undefined && YARDS[i]!.map(([gx, gy], j) => (
              <circle key={j} cx={gx * C + C / 2} cy={gy * C + C / 2} r={C * 0.42} fill="#0f1220" />
            ))}
          </g>
        );
      })}
      {/* main track */}
      {TRACK.map(([cx, cy], i) => {
        const entrySeat = view.order.find((s) => (view.entries[s] ?? -1) === i);
        return (
          <rect
            key={i}
            x={cx * C + 1}
            y={cy * C + 1}
            width={C - 2}
            height={C - 2}
            rx={5}
            fill={entrySeat !== undefined ? seatColor(summary, entrySeat) : SAFE_GLOBALS.has(i) ? '#39406e' : '#262c52'}
            opacity={entrySeat !== undefined ? 0.75 : 1}
            stroke="rgba(0,0,0,0.45)"
          />
        );
      })}
      {/* track cell bevels */}
      {TRACK.map(([cx, cy], i) => (
        <rect key={`b${i}`} x={cx * C + 1} y={cy * C + 1} width={C - 2} height={C - 2} rx={5}
          fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={1}
          style={{ pointerEvents: 'none' }} />
      ))}
      {/* safe stars */}
      {[...SAFE_GLOBALS].map((g) => {
        const { x, y } = center(TRACK[g]!);
        return (
          <text key={g} x={x} y={y + 6} textAnchor="middle" fontSize={18} fill="#ffcf5c" opacity={0.85}>★</text>
        );
      })}
      {/* home columns */}
      {HOME_COLUMNS.map((cells, i) => {
        const seat = view.order.find((s) => orderPosOf(view, s) === i);
        return cells.map(([cx, cy], j) => (
          <rect key={`${i}-${j}`} x={cx * C + 1} y={cy * C + 1} width={C - 2} height={C - 2} rx={5}
            fill={seat !== undefined ? seatColor(summary, seat) : '#1b2038'} opacity={seat !== undefined ? 0.5 : 1}
            stroke="rgba(0,0,0,0.35)" />
        ));
      })}
      {/* center */}
      <rect x={6 * C} y={6 * C} width={3 * C} height={3 * C} fill="#2b3159" rx={8} stroke="rgba(255,255,255,0.12)" />
      <text x={7.5 * C} y={7.5 * C + 8} textAnchor="middle" fontSize={26} fill="#9aa3d8">🏠</text>
      {/* board depth */}
      <rect width={W} height={W} rx={12} fill="url(#gb-boardlight)" style={{ pointerEvents: 'none' }} />
      <rect width={W} height={W} rx={12} fill="url(#gb-vignette)" style={{ pointerEvents: 'none' }} />
      {/* tokens */}
      {tokenSpots(view)
        .filter((s) => !anim || s.seat !== anim.seat || s.token !== anim.token)
        .filter((s) => !hiddenByFx.has(`${s.seat}-${s.token}`))
        .map((s) => {
          const clickable = yourSeat === s.seat && movable?.includes(s.token) && onMoveToken;
          return (
            <g key={`${s.seat}-${s.token}`}
              style={clickable ? { cursor: 'pointer' } : undefined}
              onClick={clickable ? () => onMoveToken(s.token) : undefined}>
              <SeatToken summary={summary} seat={s.seat} cx={s.x} cy={s.y} r={C * 0.36} />
              {clickable && (
                <circle cx={s.x} cy={s.y} r={C * 0.36} fill="none" stroke="#ffffff" strokeWidth={3.5}>
                  <animate attributeName="r" values={`${C * 0.34};${C * 0.44};${C * 0.34}`} dur="0.9s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
      {/* capture drama: ghost on the square → 💥 → ✨ rebirth in the yard */}
      {captures.map((c) => (
        <g key={`fx-${c.seat}-${c.token}`} style={{ pointerEvents: 'none' }}>
          {c.stage === 'ghost' && (
            <SeatToken summary={summary} seat={c.seat} cx={c.oldXY.x} cy={c.oldXY.y} r={C * 0.36} />
          )}
          {c.stage === 'blast' && (
            <CaptureBlast x={c.oldXY.x} y={c.oldXY.y} color={seatColor(summary, c.seat)} r={C * 0.45} />
          )}
          {c.stage === 'rebirth' && (
            <>
              <RebirthPulse x={c.yardXY.x} y={c.yardXY.y} color={seatColor(summary, c.seat)} r={C * 0.45} />
              <g className="gb-pop">
                <SeatToken summary={summary} seat={c.seat} cx={c.yardXY.x} cy={c.yardXY.y} r={C * 0.36} />
              </g>
            </>
          )}
        </g>
      ))}
      {anim && (
        <g style={{ filter: 'drop-shadow(0 5px 6px rgba(0,0,0,0.55))', pointerEvents: 'none' }}>
          <SeatToken summary={summary} seat={anim.seat} cx={anim.x} cy={anim.y} r={C * 0.4} />
          <HandGlyph x={anim.x} y={anim.y} phase={anim.phase} t={anim.t} size={C * 1.05} />
        </g>
      )}
    </svg>
  );
}

function TvView({ state }: TvViewProps<LudoPublic>) {
  const view = state.view;
  if (!view) return null;
  return (
    <div className="tv-main">
      <div className="tv-board">
        <Board view={view} summary={state.summary} />
      </div>
      <div className="tv-sidebar">
        <SeatTokens summary={state.summary} activeSeats={state.activeSeats} />
        {view.die !== null && (
          <div className="tv-player-chip">🎲 {view.die}</div>
        )}
        {view.lastEvent && <div className="tv-player-chip dim">{view.lastEvent}</div>}
        <WinnerBanner state={state} />
      </div>
    </div>
  );
}

/** What tapping "move token i" will do — enough context to choose without the board. */
function describeMove(view: LudoPublic, seat: number, token: number): { label: string; capture: boolean } {
  const die = view.die ?? 0;
  const p = view.tokens[seat]?.[token] ?? -1;
  if (p === -1) return { label: `Token ${token + 1} — 🏁 leave the yard`, capture: false };
  const dest = destinationOf(view, p, die) ?? p + die;
  if (dest === HOME) return { label: `Token ${token + 1} — 🏠 reach home!`, capture: false };
  if (dest > 50) return { label: `Token ${token + 1} — climb the home column`, capture: false };
  const destGlobal = globalSquare(view, seat, dest);
  let capture = false;
  if (destGlobal !== null && !SAFE_GLOBALS.has(destGlobal)) {
    for (const other of view.order) {
      if (other === seat) continue;
      capture ||= (view.tokens[other] ?? []).some((op) => op >= 0 && op <= 50 && globalSquare(view, other, op) === destGlobal);
    }
  }
  return { label: `Token ${token + 1} — ${p + 1} → ${dest + 1}${capture ? ' ⚔️ CAPTURE!' : ''}`, capture };
}

/**
 * Phones are action-first: roll + big move buttons, so the drama plays out
 * on the TV instead of everyone staring at their own board. The full board
 * stays available behind a toggle.
 */
function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<LudoPublic, LudoMove>) {
  const view = state.view;
  const [showBoard, setShowBoard] = useState(false);
  if (!view) return null;
  const myTurn = state.activeSeats.includes(yourSeat) && state.status === 'active';
  const legal = (state.legalMoves ?? []) as LudoMove[];
  const canRoll = myTurn && legal.some((m) => m.kind === 'ROLL');
  const movable = legal.filter((m) => m.kind === 'MOVE').map((m) => (m as { token: number }).token);

  return (
    <div className="page">
      <div className="card center">
        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : myTurn ? (
          canRoll ? (
            <button className="big" onClick={() => submitMove('ROLL', {})}>
              🎲 Roll the die
            </button>
          ) : (
            <>
              <div className="action-bar">{view.die !== null && <Die value={view.die} />}</div>
              <Prompt>Pick a token — watch it move on the TV</Prompt>
              {movable.map((token) => {
                const d = describeMove(view, yourSeat, token);
                return (
                  <button key={token} className={d.capture ? 'gold' : 'secondary'} style={{ width: '100%' }}
                    onClick={() => submitMove('MOVE', { token })}>
                    {d.label}
                  </button>
                );
              })}
            </>
          )
        ) : (
          <Waiting state={state} />
        )}
        <EventLine text={view.lastEvent} />
        <button className="ghost" onClick={() => setShowBoard((s) => !s)}>
          {showBoard ? 'Hide board' : 'Show board'}
        </button>
      </div>
      {showBoard && (
        <div className="board-frame">
          <Board
            view={view}
            summary={state.summary}
            yourSeat={yourSeat}
            movable={movable}
            onMoveToken={(token) => submitMove('MOVE', { token })}
          />
        </div>
      )}
    </div>
  );
}

export const ludoUi: GameUi = {
  slug: 'ludo',
  PlayerView,
  TvView,
};
