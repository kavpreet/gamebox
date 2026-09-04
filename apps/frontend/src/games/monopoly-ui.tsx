import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MonopolyPublic, MonopolyMove } from '@gamebox/game-monopoly';
import { BOARD, rentFor, CHEST_CARDS } from '@gamebox/game-monopoly';
import type { PlayerViewProps, TvViewProps, GameUi } from './types.js';
import type { GameSummary } from '@gamebox/shared-types';
import {
  seatName, seatColor, SeatDot, SeatToken, WinnerBanner, Prompt, Waiting, Die, EventLine, useBoardFit,
  FxDefs, HandGlyph, CaptureBlast, type HandPhase, useDiceRoll, useCashDeltas, type CashDelta,
} from './common.js';

const GROUP_HEX: Record<string, string> = {
  brown: '#96603a', 'light-blue': '#7fd4f5', pink: '#e177c1', orange: '#f19b4c',
  red: '#e23f44', yellow: '#f2e14c', green: '#3fa864', 'dark-blue': '#4a6fe0',
};

const CORNER_ART: Record<string, { emoji: string; label: string }> = {
  go: { emoji: '➡️', label: 'GO' },
  jail: { emoji: '🔒', label: 'JAIL' },
  'free-parking': { emoji: '🅿️', label: 'FREE' },
  'go-to-jail': { emoji: '👮', label: 'GO TO JAIL' },
};
const TYPE_EMOJI: Record<string, string> = {
  chance: '❓', chest: '📦', railroad: '🚂', utility: '💡', tax: '💰',
};

/** position 0..39 → cell coords on an 11×11 ring (GO bottom-right, counter-clockwise). */
function cellOf(pos: number): [number, number] {
  if (pos <= 10) return [10 - pos, 10];
  if (pos <= 20) return [0, 10 - (pos - 10)];
  if (pos <= 30) return [pos - 20, 0];
  return [10, pos - 30];
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** first token slot inside a cell — where the hand sets the mover down */
function tokenXY(pos: number, C: number): { x: number; y: number } {
  const [cx, cy] = cellOf(pos);
  return { x: cx * C + 13, y: cy * C + 42 };
}

interface MonoAnim {
  seat: number;
  x: number;
  y: number;
  phase: HandPhase;
  t: number;
}

/**
 * Diffs player positions between renders: normal rolls hop the token cell
 * by cell around the ring under a hand; teleports (cards, go-to-jail) are a
 * single glide, with a blast when you're slammed into jail.
 */
/** dice tumble length — token movement waits this long after a roll */
const DICE_MS = 750;

function useMonopolyAnim(view: MonopolyPublic, C: number): { anim: MonoAnim | null; jailFx: number | null } {
  const [anim, setAnim] = useState<MonoAnim | null>(null);
  const [jailFx, setJailFx] = useState<number | null>(null);
  const prevRef = useRef<Record<number, number> | null>(null);
  const rollRef = useRef<string | null>(null);
  const rollKey = view.lastRoll ? `${view.lastRoll.d1},${view.lastRoll.d2},${view.turnIndex}` : '';

  useEffect(() => {
    const cur: Record<number, number> = {};
    for (const s of view.order) cur[s] = view.players[s]!.position;
    const prev = prevRef.current;
    prevRef.current = cur;
    if (!prev) return;

    let mover: { seat: number; from: number; to: number } | null = null;
    for (const s of view.order) {
      if (prev[s] !== undefined && prev[s] !== cur[s] && !view.players[s]!.bankrupt) {
        mover = { seat: s, from: prev[s]!, to: cur[s]! };
        break;
      }
    }
    if (!mover) return;

    const { seat, from, to } = mover;
    const steps = (to - from + 40) % 40;
    const pts: { x: number; y: number }[] = [];
    let segMs: number;
    if (steps >= 1 && steps <= 12) {
      for (let i = 0; i <= steps; i++) pts.push(tokenXY((from + i) % 40, C));
      segMs = 120;
    } else {
      pts.push(tokenXY(from, C), tokenXY(to, C));
      segMs = 520;
    }
    const slammedToJail = to === 10 && view.players[seat]!.inJail;

    // if this move came with a fresh roll, hold the token while the dice tumble
    const rolled = rollRef.current !== null && rollRef.current !== rollKey;
    const GRAB = 200 + (rolled ? DICE_MS : 0), DROP = 240;
    const moveMs = (pts.length - 1) * segMs;
    const total = GRAB + moveMs + DROP;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const start = performance.now();
    const frame = (now: number) => {
      if (cancelled) return;
      const el = now - start;
      if (el >= total) {
        setAnim(null);
        if (slammedToJail) {
          setJailFx(seat);
          timers.push(setTimeout(() => !cancelled && setJailFx(null), 900));
        }
        return;
      }
      if (el < GRAB) {
        setAnim({ seat, ...pts[0]!, phase: 'grab', t: el / GRAB });
      } else if (el < GRAB + moveMs) {
        const k = (el - GRAB) / segMs;
        const i = Math.min(Math.floor(k), pts.length - 2);
        const e = easeInOutQuad(k - i);
        const a = pts[i]!, b = pts[i + 1]!;
        const lift = Math.sin((k - i) * Math.PI) * (pts.length > 2 ? 5 : 10);
        setAnim({ seat, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - lift, phase: 'drag', t: (el - GRAB) / moveMs });
      } else {
        setAnim({ seat, ...pts[pts.length - 1]!, phase: 'drop', t: (el - GRAB - moveMs) / DROP });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.order.map((s) => view.players[s]!.position).join(',')]);

  // runs after the anim effect above, so it sees the pre-roll value first
  useEffect(() => {
    rollRef.current = rollKey;
  }, [rollKey]);

  return { anim, jailFx };
}

/** Mounts children after `ms` — lets card reveals wait for dice + token motion. */
function Delayed({ ms, children }: { ms: number; children: ReactNode }) {
  const [show, setShow] = useState(ms <= 0);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}

/**
 * Classic title-deed card. Streets get the color band + rent ladder
 * (current rent row highlighted), railroads/utilities their own tables.
 */
function DeedCard({ pos, view, summary, width = 220 }: {
  pos: number;
  view: MonopolyPublic;
  summary?: GameSummary;
  width?: number;
}) {
  const sp = BOARD[pos]!;
  const prop = view.properties[pos];
  const groupColor = sp.group ? GROUP_HEX[sp.group] : null;
  const ownsGroup = prop != null && sp.group != null &&
    BOARD.every((s, i) => s.group !== sp.group || view.properties[i]?.owner === prop.owner);

  const row = (label: string, value: string, active: boolean, key: string) => (
    <div key={key} className="row between" style={{
      fontSize: width * 0.052,
      padding: `${width * 0.008}px ${width * 0.03}px`,
      borderRadius: 4,
      background: active ? '#ffe9a8' : 'transparent',
      fontWeight: active ? 900 : 600,
      color: '#2b2416',
    }}>
      <span>{label}</span><strong>{value}</strong>
    </div>
  );

  let rows: React.ReactElement[] = [];
  if (sp.type === 'street') {
    const h = prop?.houses ?? -1;
    rows = [
      row('Rent', `$${sp.rent![0]}`, h === 0 && !ownsGroup, 'r0'),
      row('— with full set', `$${sp.rent![0]! * 2}`, h === 0 && ownsGroup, 'rset'),
      ...[1, 2, 3, 4].map((n) => row(`With ${n} house${n > 1 ? 's' : ''}`, `$${sp.rent![n]}`, h === n, `r${n}`)),
      row('With HOTEL', `$${sp.rent![5]}`, h === 5, 'r5'),
      row('House cost', `$${sp.houseCost} each`, false, 'hc'),
    ];
  } else if (sp.type === 'railroad') {
    const n = prop ? BOARD.filter((s, i) => s.type === 'railroad' && view.properties[i]?.owner === prop.owner).length : 0;
    rows = [1, 2, 3, 4].map((k) => row(`${k} railroad${k > 1 ? 's' : ''} owned`, `$${25 * Math.pow(2, k - 1)}`, n === k, `rr${k}`));
  } else if (sp.type === 'utility') {
    const n = prop ? BOARD.filter((s, i) => s.type === 'utility' && view.properties[i]?.owner === prop.owner).length : 0;
    rows = [
      row('One utility', '4 × dice roll', n === 1, 'u1'),
      row('Both utilities', '10 × dice roll', n === 2, 'u2'),
    ];
  }

  return (
    <div style={{
      width,
      background: 'linear-gradient(160deg, #fdfaef, #efe7cf)',
      border: '2px solid #23283f',
      borderRadius: width * 0.045,
      overflow: 'hidden',
      color: '#2b2416',
      boxShadow: '0 6px 18px rgba(3,5,16,0.35)',
      textAlign: 'center',
      flexShrink: 0,
    }}>
      <div style={{
        background: groupColor ?? '#3b4160',
        color: groupColor === '#f2e14c' || groupColor === '#7fd4f5' ? '#23283f' : '#ffffff',
        padding: `${width * 0.04}px ${width * 0.03}px`,
      }}>
        <div style={{ fontSize: width * 0.042, fontWeight: 800, letterSpacing: 1.5, opacity: 0.85 }}>
          {sp.type === 'street' ? 'TITLE DEED' : sp.type === 'railroad' ? '🚂 RAILROAD' : '💡 UTILITY'}
        </div>
        <div style={{ fontSize: width * 0.068, fontWeight: 900, lineHeight: 1.15 }}>{sp.name}</div>
      </div>
      <div style={{ padding: `${width * 0.03}px ${width * 0.04}px` }}>
        {rows}
        <div className="row between" style={{
          fontSize: width * 0.05, marginTop: width * 0.02, paddingTop: width * 0.02,
          borderTop: '1px dashed #a89a77', fontWeight: 800, color: '#2b2416',
        }}>
          <span>Price ${sp.price}</span>
          <span>Mortgage ${Math.floor(sp.price! / 2)}</span>
        </div>
        {prop && summary && (
          <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: width * 0.02, fontSize: width * 0.05, fontWeight: 800, color: '#2b2416' }}>
            <span style={{
              width: width * 0.06, height: width * 0.06, borderRadius: '50%', flexShrink: 0,
              background: seatColor(summary, prop.owner), border: '2px solid #23283f',
            }} />
            <span>{prop.mortgaged ? '🚫 mortgaged · ' : ''}{seatName(summary, prop.owner)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** A drawn Chance / Community Chest card, styled per deck. */
function DrawnCard({ text, width = 240 }: { text: string; width?: number }) {
  const isChest = CHEST_CARDS.some((c) => c.text === text);
  const deck = isChest ? { name: 'COMMUNITY CHEST', emoji: '📦', bg: 'linear-gradient(160deg, #7cc6f2, #3f9bd8)', fg: '#0c2b45' }
    : { name: 'CHANCE', emoji: '❓', bg: 'linear-gradient(160deg, #ffbe6b, #f5891f)', fg: '#4a2800' };
  return (
    <div style={{
      width,
      background: deck.bg,
      border: '2px solid #23283f',
      borderRadius: width * 0.05,
      padding: `${width * 0.05}px ${width * 0.06}px`,
      color: deck.fg,
      textAlign: 'center',
      boxShadow: '0 6px 18px rgba(3,5,16,0.35)',
      flexShrink: 0,
    }}>
      <div style={{ fontSize: width * 0.16 }}>{deck.emoji}</div>
      <div style={{ fontSize: width * 0.05, fontWeight: 900, letterSpacing: 2 }}>{deck.name}</div>
      <div style={{ fontSize: width * 0.062, fontWeight: 800, marginTop: width * 0.03, lineHeight: 1.3 }}>{text}</div>
    </div>
  );
}

/** Break a space name into at most two short lines that fit a cell. */
function splitName(name: string): string[] {
  if (name.length <= 10) return [name];
  const words = name.split(' ');
  if (words.length === 1) return [name.length > 11 ? name.slice(0, 10) + '…' : name];
  let l1 = words[0]!;
  let i = 1;
  while (i < words.length && (l1 + ' ' + words[i]!).length <= 10) {
    l1 += ' ' + words[i]!;
    i++;
  }
  let l2 = words.slice(i).join(' ');
  if (l2.length > 11) l2 = l2.slice(0, 10) + '…';
  return l2 ? [l1, l2] : [l1];
}

function Board({ view, summary }: { view: MonopolyPublic; summary: GameSummary }) {
  const C = 62;
  const { anim, jailFx } = useMonopolyAnim(view, C);
  const diceKey = view.lastRoll
    ? `${view.lastRoll.d1},${view.lastRoll.d2},${view.turnIndex},${view.order.map((s) => view.players[s]!.position).join('.')}`
    : null;
  const { faces: diceFaces, rolling } = useDiceRoll(
    diceKey, view.lastRoll ? [view.lastRoll.d1, view.lastRoll.d2] : [], DICE_MS,
  );
  const cells: React.ReactElement[] = [];
  BOARD.forEach((sp, pos) => {
    const [cx, cy] = cellOf(pos);
    const x = cx * C;
    const y = cy * C;
    const prop = view.properties[pos];
    const groupColor = sp.group ? GROUP_HEX[sp.group] : null;
    const corner = CORNER_ART[sp.type];
    // which cell edge the color band sits on (inner edge, facing the center)
    const bandEdge = !groupColor ? null : cy === 10 ? 'top' : cy === 0 ? 'bottom' : cx === 0 ? 'right' : 'left';
    const band =
      bandEdge === 'top' ? <rect x={x + 2} y={y + 2} width={C - 4} height={12} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : bandEdge === 'bottom' ? <rect x={x + 2} y={y + C - 14} width={C - 4} height={12} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : bandEdge === 'right' ? <rect x={x + C - 14} y={y + 2} width={12} height={C - 4} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : bandEdge === 'left' ? <rect x={x + 2} y={y + 2} width={12} height={C - 4} rx={2} fill={groupColor!} stroke="rgba(0,0,0,0.25)" />
      : null;

    // content area (the part of the cell not covered by the band)
    const ctX = x + C / 2 + (bandEdge === 'left' ? 6 : bandEdge === 'right' ? -6 : 0);
    const ctY = bandEdge === 'top' ? y + 13 : y;
    const nameLines = splitName(sp.name);

    // owner marker goes in the corner farthest from the band; double ring
    // (white + dark) keeps it readable on any cell or band color
    const ownX = bandEdge === 'left' ? x + C - 9 : x + 9;
    const ownY = bandEdge === 'top' ? y + C - 9 : bandEdge === 'bottom' ? y + 9 : y + C - 9;

    // houses sit on the color band, classic-style
    const housePips: React.ReactElement[] = [];
    if (prop && prop.houses > 0 && bandEdge) {
      const horiz = bandEdge === 'top' || bandEdge === 'bottom';
      const bandCx = horiz ? 0 : bandEdge === 'left' ? x + 8 : x + C - 8;
      const bandCy = horiz ? (bandEdge === 'top' ? y + 8 : y + C - 8) : 0;
      if (prop.houses === 5) {
        housePips.push(
          horiz
            ? <rect key="h" x={x + C / 2 - 7} y={bandCy - 4.5} width={14} height={9} rx={2} fill="#e23f44" stroke="#ffffff" strokeWidth={1.2} />
            : <rect key="h" x={bandCx - 4.5} y={y + C / 2 - 7} width={9} height={14} rx={2} fill="#e23f44" stroke="#ffffff" strokeWidth={1.2} />,
        );
      } else {
        for (let i = 0; i < prop.houses; i++) {
          const off = (i - (prop.houses - 1) / 2) * 11;
          housePips.push(
            <rect key={i}
              x={(horiz ? x + C / 2 + off : bandCx) - 3.75}
              y={(horiz ? bandCy : y + C / 2 + off) - 3.75}
              width={7.5} height={7.5} rx={1.5} fill="#2f9e44" stroke="#ffffff" strokeWidth={1.2} />,
          );
        }
      }
    }

    cells.push(
      <g key={pos}>
        <rect x={x + 1} y={y + 1} width={C - 2} height={C - 2} rx={3}
          fill={corner ? '#ece4cc' : '#f4eedb'} stroke="#23283f" strokeWidth={1.4} />
        {band}
        {corner ? (
          <>
            <text x={x + C / 2} y={y + C / 2 + 4} textAnchor="middle" fontSize={22}>{corner.emoji}</text>
            <text x={x + C / 2} y={y + C - 7} textAnchor="middle" fontSize={8.5} fontWeight={900}
              fill="#3b4160" letterSpacing={0.5}>{corner.label}</text>
          </>
        ) : (
          <>
            {nameLines.map((ln, i) => (
              <text key={i} x={ctX} y={ctY + 12 + i * 9} textAnchor="middle"
                fontSize={7.6} fontWeight={800} fill="#2b2f45">
                {ln}
              </text>
            ))}
            {TYPE_EMOJI[sp.type] && (
              <text x={ctX} y={ctY + 36} textAnchor="middle" fontSize={14} opacity={0.95}>
                {TYPE_EMOJI[sp.type]}
              </text>
            )}
            {sp.price !== undefined && !prop && (
              <text x={ctX} y={ctY + 47} textAnchor="middle" fontSize={8} fill="#6b7090" fontWeight={800}>
                ${sp.price}
              </text>
            )}
          </>
        )}
        {housePips.length > 0 && (
          <g key={`hp${pos}-${prop!.houses}`} className="gb-pop">{housePips}</g>
        )}
        {prop && (
          <g opacity={prop.mortgaged ? 0.55 : 1}>
            <circle cx={ownX} cy={ownY} r={7} fill="#ffffff" />
            <circle cx={ownX} cy={ownY} r={5.5} fill={seatColor(summary, prop.owner)} stroke="#23283f" strokeWidth={1.4} />
            {prop.mortgaged && (
              <line x1={ownX - 6} y1={ownY + 6} x2={ownX + 6} y2={ownY - 6} stroke="#c92a2a" strokeWidth={2.2} />
            )}
          </g>
        )}
      </g>,
    );
  });

  // tokens
  const bySpace = new Map<number, number[]>();
  for (const s of view.order) {
    const p = view.players[s]!;
    if (p.bankrupt || s === anim?.seat) continue;
    (bySpace.get(p.position) ?? bySpace.set(p.position, []).get(p.position)!).push(s);
  }
  const tokens: React.ReactElement[] = [];
  for (const [pos, seats] of bySpace) {
    const [cx, cy] = cellOf(pos);
    seats.forEach((s, i) => {
      const tx = cx * C + 13 + (i % 3) * 13;
      const ty = cy * C + 42 + Math.floor(i / 3) * 6;
      tokens.push(
        <g key={s} className="board-token" data-pos={pos}>
          <SeatToken summary={summary} seat={s} cx={tx} cy={ty} r={8.5} />
        </g>,
      );
    });
  }
  if (anim) {
    tokens.push(
      <g key={`anim${anim.seat}`} style={{ filter: 'drop-shadow(0 4px 5px rgba(0,0,0,0.55))', pointerEvents: 'none' }}>
        <SeatToken summary={summary} seat={anim.seat} cx={anim.x} cy={anim.y} r={10} />
        <HandGlyph x={anim.x} y={anim.y} phase={anim.phase} t={anim.t} size={C * 0.62} />
      </g>,
    );
  }
  if (jailFx !== null) {
    const jail = tokenXY(10, C);
    tokens.push(<CaptureBlast key="jailfx" x={jail.x} y={jail.y} color="#45a6ff" r={C * 0.38} />);
  }

  const W = 11 * C;
  const fit = useBoardFit();
  return (
    <svg viewBox={`0 0 ${W} ${W}`} preserveAspectRatio={fit}
      style={{ maxWidth: '100%', maxHeight: '100%', width: '100%', height: '100%' }}>
      <FxDefs />
      <defs>
        <radialGradient id="mono-center" cx="50%" cy="42%" r="80%">
          <stop offset="0%" stopColor="#d8ecd4" />
          <stop offset="100%" stopColor="#bcd9b8" />
        </radialGradient>
      </defs>
      <rect width={W} height={W} rx={14} fill="#23283f" />
      <rect x={C} y={C} width={9 * C} height={9 * C} rx={6} fill="url(#mono-center)" stroke="#23283f" strokeWidth={2} />
      {cells}
      <g transform={`rotate(-45 ${W / 2} ${W / 2})`}>
        <rect x={W / 2 - 3.6 * C} y={W / 2 - 0.55 * C} width={7.2 * C} height={1.1 * C} rx={8}
          fill="#e23f44" stroke="#ffffff" strokeWidth={3} />
        <text x={W / 2} y={W / 2 + 13} textAnchor="middle" fontSize={40} fontWeight={900}
          fill="#ffffff" letterSpacing={6} style={{ fontFamily: 'Nunito, sans-serif' }}>
          MONOPOLY
        </text>
      </g>
      {view.lastRoll && (
        <g>
          {diceFaces.map((d, i) => {
            const dx = W / 2 - 42 + i * 48;
            const dy = 6.55 * C;
            const pips: Record<number, [number, number][]> = {
              1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
              4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
              5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
              6: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.5], [0.75, 0.5], [0.25, 0.75], [0.75, 0.75]],
            };
            // tumbling dice bounce and twist a little; settled dice pop in place
            const rot = rolling ? ((d * 47 + i * 29) % 21) - 10 : 0;
            const dyJit = rolling ? ((d * 31 + i * 17) % 7) - 3 : 0;
            return (
              <g key={rolling ? `t${i}` : `s${i}-${d}`}
                transform={`rotate(${rot} ${dx + 18} ${dy + 18}) translate(0 ${dyJit})`}
                className={rolling ? undefined : 'gb-pop'}>
                <rect x={dx} y={dy} width={36} height={36} rx={8} fill="#f2f4ff" stroke="#0b0e1d" strokeWidth={1.5} />
                {(pips[d] ?? []).map(([px, py], j) => (
                  <circle key={j} cx={dx + px * 36} cy={dy + py * 36} r={3.4} fill="#1a1e38" />
                ))}
              </g>
            );
          })}
        </g>
      )}
      {view.freeParkingPot > 0 && (
        <text x={W / 2} y={7.45 * C} textAnchor="middle" fontSize={16} fill="#b8860b" fontWeight={900}>
          🅿️ Free Parking jackpot: ${view.freeParkingPot}
        </text>
      )}
      {view.lastCard && (
        <text x={W / 2} y={7.9 * C} textAnchor="middle" fontSize={15} fill="#8a5200" fontWeight={800}>
          {view.lastCard}
        </text>
      )}
      {view.lastEvent && (
        <text x={W / 2} y={8.35 * C} textAnchor="middle" fontSize={13.5} fill="#3b4160" fontWeight={600}>{view.lastEvent}</text>
      )}
      <rect width={W} height={W} rx={14} fill="url(#gb-boardlight)" style={{ pointerEvents: 'none' }} />
      {tokens}
    </svg>
  );
}

/** Pair payers with payees (bank when unmatched) and fly 💸 between their chips. */
function useCashFlyers(
  deltas: CashDelta[],
  mainRef: React.RefObject<HTMLDivElement | null>,
  boardRef: React.RefObject<HTMLDivElement | null>,
  chipRefs: React.MutableRefObject<Map<number, HTMLElement>>,
) {
  const [flyers, setFlyers] = useState<{ id: number; fx: number; fy: number; tx: number; ty: number }[]>([]);
  useEffect(() => {
    if (deltas.length === 0) {
      setFlyers([]);
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    const mRect = main.getBoundingClientRect();
    const center = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - mRect.left, y: r.top + r.height / 2 - mRect.top };
    };
    const bank = center(boardRef.current) ?? { x: mRect.width / 2, y: mRect.height / 2 };
    const payers = deltas.filter((d) => d.delta < 0);
    const payees = deltas.filter((d) => d.delta > 0);
    const seatPt = (s: number) => center(chipRefs.current.get(s)) ?? bank;
    const fl: { id: number; fx: number; fy: number; tx: number; ty: number }[] = [];
    for (let i = 0; i < Math.max(payers.length, payees.length); i++) {
      const from = payers.length > 0 ? seatPt(payers[Math.min(i, payers.length - 1)]!.seat) : bank;
      const to = payees.length > 0 ? seatPt(payees[Math.min(i, payees.length - 1)]!.seat) : bank;
      fl.push({ id: i, fx: from.x, fy: from.y, tx: to.x, ty: to.y });
    }
    setFlyers(fl);
    const t = setTimeout(() => setFlyers([]), 1000);
    return () => clearTimeout(t);
  }, [deltas, mainRef, boardRef, chipRefs]);
  return flyers;
}

function TvView({ state }: TvViewProps<MonopolyPublic>) {
  const view = state.view;
  const mainRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<number, HTMLElement>>(new Map());

  const cashRecord: Record<number, number> = {};
  if (view) for (const s of view.order) cashRecord[s] = view.players[s]!.cash;
  const deltas = useCashDeltas(cashRecord);
  const flyers = useCashFlyers(deltas, mainRef, boardRef, chipRefs);

  // drawn chance/chest card: reveal after the dice + hop, hold a few seconds
  const [drawn, setDrawn] = useState<string | null>(null);
  const seenCard = useRef<string | null>(null);
  const lastCard = view?.lastCard ?? null;
  useEffect(() => {
    if (seenCard.current === null) {
      seenCard.current = lastCard ?? '';
      return;
    }
    if (!lastCard) {
      seenCard.current = '';
      return;
    }
    if (lastCard === seenCard.current) return;
    seenCard.current = lastCard;
    const show = setTimeout(() => setDrawn(lastCard), DICE_MS + 1200);
    const hide = setTimeout(() => setDrawn(null), DICE_MS + 1200 + 5000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
      setDrawn(null);
    };
  }, [lastCard]);

  if (!view) return null;
  const decider = view.order[view.turnIndex % view.order.length]!;

  return (
    <div className="tv-main" ref={mainRef} style={{ position: 'relative' }}>
      <div className="tv-board" ref={boardRef} style={{ position: 'relative' }}>
        <Board view={view} summary={state.summary} />
        {view.pendingBuy !== null && (
          <Delayed key={`buy${view.pendingBuy}`} ms={DICE_MS + 1500}>
            <div className="board-overlay">
              <div className="overlay-card">
                <DeedCard pos={view.pendingBuy} view={view} summary={state.summary} width={280} />
              </div>
              <div className="overlay-caption">
                🏠 {seatName(state.summary, decider)} — buy or send to auction?
              </div>
            </div>
          </Delayed>
        )}
        {view.pendingBuy === null && drawn && (
          <div className="board-overlay" key={drawn}>
            <div className="overlay-card">
              <DrawnCard text={drawn} width={300} />
            </div>
          </div>
        )}
        {view.phase === 'AUCTION' && view.auction && (
          <div className="board-overlay" key={`auction${view.auction.position}`}>
            <div className="overlay-card">
              <DeedCard pos={view.auction.position} view={view} summary={state.summary} width={280} />
            </div>
            <div className="overlay-caption">
              🔨 Sealed-bid auction — {Object.keys(view.auction.bids).length}/{view.order.filter((s) => !view.players[s]!.bankrupt).length} bids in
            </div>
          </div>
        )}
      </div>
      <div className="tv-sidebar">
        {view.order.map((s) => {
          const p = view.players[s]!;
          const owned = Object.values(view.properties).filter((pr) => pr.owner === s).length;
          return (
            <div key={s} className={`tv-player-chip ${state.activeSeats.includes(s) ? 'active' : ''}`}
              ref={(el) => {
                if (el) chipRefs.current.set(s, el);
                else chipRefs.current.delete(s);
              }}
              style={p.bankrupt ? { opacity: 0.4 } : undefined}>
              <SeatDot summary={state.summary} seat={s} />
              <span className="grow">
                {seatName(state.summary, s)}
                {p.inJail && ' 🔒'}
                {p.bankrupt && ' 💀'}
                <div className="dim small">{owned} deeds</div>
              </span>
              <strong style={{ color: 'var(--green)' }}>${p.cash}</strong>
              {deltas.filter((d) => d.seat === s).map((d) => (
                <span key={d.id} className={`cash-float ${d.delta > 0 ? 'gain' : 'loss'}`}>
                  {d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)}
                </span>
              ))}
            </div>
          );
        })}
        {view.phase === 'AUCTION' && view.auction && (
          <div className="tv-player-chip active">
            🔨 Auction: {BOARD[view.auction.position]!.name}
          </div>
        )}
        {view.pendingTrade && <div className="tv-player-chip">🤝 trade pending…</div>}
        <WinnerBanner state={state} />
      </div>
      {flyers.map((f) => (
        <span key={f.id} className="cash-fly" style={{
          ['--fx' as string]: `${f.fx}px`,
          ['--fy' as string]: `${f.fy}px`,
          ['--tx' as string]: `${f.tx}px`,
          ['--ty' as string]: `${f.ty}px`,
        }}>💸</span>
      ))}
    </div>
  );
}

function PlayerView({ state, yourSeat, submitMove }: PlayerViewProps<MonopolyPublic, MonopolyMove>) {
  const view = state.view;
  const [bid, setBid] = useState('');
  const [showTrade, setShowTrade] = useState(false);
  const [tradeTo, setTradeTo] = useState<number | null>(null);
  const [giveProps, setGiveProps] = useState<number[]>([]);
  const [getProps, setGetProps] = useState<number[]>([]);
  const [giveCash, setGiveCash] = useState('0');
  const [getCash, setGetCash] = useState('0');
  const [openDeed, setOpenDeed] = useState<number | null>(null);
  const cashRecord: Record<number, number> = {};
  if (view) for (const s of view.order) cashRecord[s] = view.players[s]!.cash;
  const deltas = useCashDeltas(cashRecord);
  if (!view) return null;
  const me = view.players[yourSeat]!;
  const legal = (state.legalMoves ?? []) as MonopolyMove[];
  const kinds = new Set(legal.map((m) => m.kind));
  const myTurnish = state.activeSeats.includes(yourSeat) && state.status === 'active';
  // Manual mode: while a token is mid-walk or a charge is unpaid, that act is
  // the only thing this seat may do.
  const myWalk = myTurnish && view.pendingWalk?.seat === yourSeat ? view.pendingWalk : null;
  const owed = myTurnish && view.pendingPayment?.seat === yourSeat ? view.pendingPayment : null;
  const here = BOARD[me.position]!;

  const myProps = Object.entries(view.properties)
    .filter(([, p]) => p.owner === yourSeat)
    .map(([pos]) => Number(pos));

  const toggle = (list: number[], set: (v: number[]) => void, pos: number) =>
    set(list.includes(pos) ? list.filter((x) => x !== pos) : [...list, pos]);

  const legalFor = (kind: string, pos: number) =>
    legal.some((m) => m.kind === kind && (m as { position?: number }).position === pos);

  return (
    <div className="page">
      {/* status header — the full board lives on the TV */}
      <div className="card">
        <div className="row between">
          <div style={{ position: 'relative' }}>
            <div className="dim small">your cash</div>
            <div style={{ fontSize: '1.9rem', fontWeight: 900, color: 'var(--green)' }}>${me.cash}</div>
            {deltas.filter((d) => d.seat === yourSeat).map((d) => (
              <span key={d.id} className={`cash-float ${d.delta > 0 ? 'gain' : 'loss'}`}
                style={{ right: 'auto', left: '100%', marginLeft: 8, top: '40%' }}>
                {d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)}
              </span>
            ))}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="dim small">you are on</div>
            <div style={{ fontWeight: 800 }}>
              {here.group && <span style={{ color: GROUP_HEX[here.group] }}>● </span>}
              {here.name}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
              {me.inJail && <span className="badge">🔒 in jail</span>}
              {me.bankrupt && <span className="badge">💀 bankrupt</span>}
            </div>
          </div>
        </div>
        {view.lastRoll && myTurnish && (
          <div className="action-bar">
            <Die value={view.lastRoll.d1} size={44} rollKey={`a${view.lastRoll.d1},${view.lastRoll.d2},${view.turnIndex}`} />
            <Die value={view.lastRoll.d2} size={44} rollKey={`b${view.lastRoll.d1},${view.lastRoll.d2},${view.turnIndex}`} />
          </div>
        )}

        {state.status === 'completed' ? (
          <WinnerBanner state={state} />
        ) : !myTurnish ? (
          <Waiting state={state} />
        ) : myWalk ? (
          <>
            {/* Manual mode: the throw only committed the distance. The server
                holds the remaining count, so a step can never travel further
                than the dice said. */}
            <button className="big" onClick={() => submitMove('STEP_TOKEN', {})}>
              👣 Step to {BOARD[(me.position + 1) % BOARD.length]!.name}
            </button>
            <p className="manual-hint">
              {myWalk.remaining} of {myWalk.total} squares left — tap to walk your token.
            </p>
          </>
        ) : owed ? (
          <>
            <button className="big pay-button" onClick={() => submitMove('PAY', {})}>
              💸 Pay ${owed.amount}
              {owed.to !== null ? ` to ${seatName(state.summary, owed.to)}` : ' to the bank'}
            </button>
            <p className="manual-hint">
              {owed.reason} · you have ${me.cash}, leaving ${me.cash - owed.amount}
            </p>
          </>
        ) : view.debt?.seat === yourSeat ? (
          <>
            <Prompt danger>You owe ${view.debt.amount}! Sell or mortgage below, then settle.</Prompt>
            <div className="action-bar">
              {kinds.has('RESOLVE_DEBT') && <button onClick={() => submitMove('RESOLVE_DEBT', {})}>Pay ${view.debt.amount}</button>}
              <button style={{ background: 'var(--danger)' }} onClick={() => submitMove('DECLARE_BANKRUPTCY', {})}>
                Declare bankruptcy
              </button>
            </div>
          </>
        ) : view.phase === 'AUCTION' && view.auction ? (
          <>
            <Prompt>🔨 Sealed bid for {BOARD[view.auction.position]!.name} (list ${BOARD[view.auction.position]!.price})</Prompt>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
              <div className="pop-in">
                <DeedCard pos={view.auction.position} view={view} summary={state.summary} width={210} />
              </div>
            </div>
            <div className="action-bar">
              <input style={{ width: 120 }} inputMode="numeric" placeholder="0" value={bid} onChange={(e) => setBid(e.target.value)} />
              <button onClick={() => { submitMove('BID', { amount: Number(bid) || 0 }); setBid(''); }}>Bid</button>
              <button className="secondary" onClick={() => submitMove('BID', { amount: 0 })}>Pass</button>
            </div>
          </>
        ) : view.pendingTrade && view.pendingTrade.to === yourSeat ? (
          <>
            <Prompt>
              🤝 {seatName(state.summary, view.pendingTrade.from)} offers:{' '}
              {view.pendingTrade.giveProps.map((p) => BOARD[p]!.name).join(', ') || 'nothing'}
              {view.pendingTrade.giveCash > 0 && ` + $${view.pendingTrade.giveCash}`}
              {' for your '}
              {view.pendingTrade.getProps.map((p) => BOARD[p]!.name).join(', ') || 'nothing'}
              {view.pendingTrade.getCash > 0 && ` + $${view.pendingTrade.getCash}`}
            </Prompt>
            <div className="action-bar">
              <button onClick={() => submitMove('RESPOND_TRADE', { accept: true })}>Accept</button>
              <button className="secondary" onClick={() => submitMove('RESPOND_TRADE', { accept: false })}>Reject</button>
            </div>
          </>
        ) : (
          <>
            {view.pendingBuy !== null && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
                <div className="pop-in">
                  <DeedCard pos={view.pendingBuy} view={view} summary={state.summary} width={230} />
                </div>
              </div>
            )}
            <div className="action-bar">
              {kinds.has('ROLL') && <button className="big" style={{ width: 'auto' }} onClick={() => submitMove('ROLL', {})}>🎲 Roll</button>}
            {kinds.has('PAY_JAIL') && <button className="secondary" onClick={() => submitMove('PAY_JAIL', {})}>Pay $50 fine</button>}
            {kinds.has('BUY') && view.pendingBuy !== null && (
              <button className="gold" onClick={() => submitMove('BUY', {})}>
                Buy {BOARD[view.pendingBuy]!.name} (${BOARD[view.pendingBuy]!.price})
              </button>
            )}
            {kinds.has('DECLINE_BUY') && <button className="secondary" onClick={() => submitMove('DECLINE_BUY', {})}>Auction it</button>}
            {kinds.has('END_TURN') && <button className="secondary" onClick={() => submitMove('END_TURN', {})}>End turn</button>}
            {kinds.has('CANCEL_TRADE') && <button className="ghost" onClick={() => submitMove('CANCEL_TRADE', {})}>Withdraw trade</button>}
              {(view.phase === 'ROLL' || view.phase === 'ACT') && !view.pendingTrade && (
                <button className="ghost" onClick={() => setShowTrade(!showTrade)}>🤝 Trade…</button>
              )}
            </div>
          </>
        )}
        {view.lastCard ? (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }} key={view.lastCard}>
            <div className="pop-in">
              <DrawnCard text={view.lastCard} width={210} />
            </div>
          </div>
        ) : null}
        <EventLine text={view.lastEvent} />
      </div>

      {/* everyone's standing at a glance */}
      <div className="card">
        <h3>Standings</h3>
        {view.order.map((s) => {
          const p = view.players[s]!;
          return (
            <div key={s} className="row between" style={{ position: 'relative', ...(p.bankrupt ? { opacity: 0.4 } : null) }}>
              <span className="row" style={{ gap: 6 }}>
                <SeatDot summary={state.summary} seat={s} size={13} />
                {seatName(state.summary, s)}{s === yourSeat && ' (you)'}
                {p.inJail && ' 🔒'}{p.bankrupt && ' 💀'}
                {state.activeSeats.includes(s) && <span className="badge gold-badge">turn</span>}
              </span>
              <strong style={{ color: 'var(--green)' }}>${p.cash}</strong>
              {deltas.filter((d) => d.seat === s).map((d) => (
                <span key={d.id} className={`cash-float ${d.delta > 0 ? 'gain' : 'loss'}`}>
                  {d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)}
                </span>
              ))}
            </div>
          );
        })}
      </div>

      {myProps.length > 0 && (
        <div className="card">
          <h3>Your properties</h3>
          <p className="dim small">Tap a property to see its deed card.</p>
          {myProps.map((pos) => {
            const sp = BOARD[pos]!;
            const prop = view.properties[pos]!;
            return (
              <React.Fragment key={pos}>
                <div className="row between">
                  <span onClick={() => setOpenDeed(openDeed === pos ? null : pos)} style={{ cursor: 'pointer' }}>
                    {sp.group && <span style={{ color: GROUP_HEX[sp.group] }}>■ </span>}
                    {sp.name}
                    {prop.mortgaged && <span className="dim small"> (mortgaged)</span>}
                    {prop.houses > 0 && <span className="small"> {prop.houses === 5 ? '🏨' : '🏠'.repeat(prop.houses)}</span>}
                    <span className="dim small"> rent ${rentFor(view, pos, 7)}</span>
                  </span>
                  <span className="row">
                    {legalFor('BUILD', pos) && <button className="secondary" onClick={() => submitMove('BUILD', { position: pos })}>+🏠 ${sp.houseCost}</button>}
                    {legalFor('SELL_HOUSE', pos) && <button className="ghost" onClick={() => submitMove('SELL_HOUSE', { position: pos })}>-🏠</button>}
                    {legalFor('MORTGAGE', pos) && <button className="ghost" onClick={() => submitMove('MORTGAGE', { position: pos })}>Mortgage +${Math.floor(sp.price! / 2)}</button>}
                    {legalFor('UNMORTGAGE', pos) && <button className="ghost" onClick={() => submitMove('UNMORTGAGE', { position: pos })}>Unmortgage ${Math.ceil(sp.price! * 0.55)}</button>}
                  </span>
                </div>
                {openDeed === pos && (
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}
                    onClick={() => setOpenDeed(null)}>
                    <div className="pop-in">
                      <DeedCard pos={pos} view={view} summary={state.summary} width={230} />
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {showTrade && (
        <div className="card">
          <h3>Propose a trade</h3>
          <select value={tradeTo ?? ''} onChange={(e) => { setTradeTo(e.target.value === '' ? null : Number(e.target.value)); setGetProps([]); }}>
            <option value="">Pick a player…</option>
            {view.order.filter((s) => s !== yourSeat && !view.players[s]!.bankrupt).map((s) => (
              <option key={s} value={s}>{seatName(state.summary, s)}</option>
            ))}
          </select>
          {tradeTo !== null && (
            <>
              <p className="small dim">You give:</p>
              <div className="row">
                {myProps.filter((p) => view.properties[p]!.houses === 0).map((pos) => (
                  <button key={pos} className={giveProps.includes(pos) ? '' : 'secondary'}
                    onClick={() => toggle(giveProps, setGiveProps, pos)}>
                    {BOARD[pos]!.name}
                  </button>
                ))}
                <input style={{ width: 100 }} inputMode="numeric" value={giveCash} onChange={(e) => setGiveCash(e.target.value)} placeholder="$" />
              </div>
              <p className="small dim">You get:</p>
              <div className="row">
                {Object.entries(view.properties)
                  .filter(([, p]) => p.owner === tradeTo && p.houses === 0)
                  .map(([pos]) => Number(pos))
                  .map((pos) => (
                    <button key={pos} className={getProps.includes(pos) ? '' : 'secondary'}
                      onClick={() => toggle(getProps, setGetProps, pos)}>
                      {BOARD[pos]!.name}
                    </button>
                  ))}
                <input style={{ width: 100 }} inputMode="numeric" value={getCash} onChange={(e) => setGetCash(e.target.value)} placeholder="$" />
              </div>
              <button onClick={async () => {
                const err = await submitMove('PROPOSE_TRADE', {
                  to: tradeTo,
                  giveProps,
                  giveCash: Number(giveCash) || 0,
                  getProps,
                  getCash: Number(getCash) || 0,
                });
                if (!err) {
                  setShowTrade(false);
                  setGiveProps([]); setGetProps([]); setGiveCash('0'); setGetCash('0');
                }
              }}>
                Send offer
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const monopolyUi: GameUi = { slug: 'monopoly', PlayerView, TvView };
