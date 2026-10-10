import type { Card } from './cards.js';

/**
 * Winning patterns. Each check receives the card and `ok(n)` — whether the
 * number counts as covered (the caller decides: marked AND called, or for
 * bogey diagnosis, merely marked). FREE (0) is passed through `ok` too, so
 * callers treat it as always covered.
 */
type Ok = (n: number) => boolean;

export interface PrizeDef {
  id: string;
  name: string;
  description: string;
  balls: 75 | 90;
  defaultPoints: number;
  check: (card: Card, ok: Ok) => boolean;
}

// ── 75-ball helpers (5×5) ────────────────────────────────────────────────────
const rows75 = (c: Card) => c.cells.map((r) => r as number[]);
const cols75 = (c: Card) => [0, 1, 2, 3, 4].map((x) => c.cells.map((r) => r[x] as number));
const diags75 = (c: Card) => [
  [0, 1, 2, 3, 4].map((i) => c.cells[i]![i] as number),
  [0, 1, 2, 3, 4].map((i) => c.cells[i]![4 - i] as number),
];
const full = (line: number[], ok: Ok) => line.every(ok);
const countFull = (lines: number[][], ok: Ok) => lines.filter((l) => full(l, ok)).length;
const allLines75 = (c: Card) => [...rows75(c), ...cols75(c), ...diags75(c)];

// ── 90-ball helpers (3×9, blanks null) ───────────────────────────────────────
const rows90 = (c: Card) => c.cells.map((r) => r.filter((n): n is number => n !== null));
const corners90 = (c: Card) => {
  const [top, , bottom] = rows90(c);
  return [top![0]!, top![top!.length - 1]!, bottom![0]!, bottom![bottom!.length - 1]!];
};

export const PRIZES: PrizeDef[] = [
  // 75-ball
  { id: 'line', name: 'Bingo — any line', description: 'Any full row, column or diagonal', balls: 75, defaultPoints: 10,
    check: (c, ok) => countFull(allLines75(c), ok) >= 1 },
  { id: 'row1', name: '1 Row', description: 'Any full horizontal row', balls: 75, defaultPoints: 10,
    check: (c, ok) => countFull(rows75(c), ok) >= 1 },
  { id: 'column', name: '1 Column', description: 'Any full vertical column', balls: 75, defaultPoints: 10,
    check: (c, ok) => countFull(cols75(c), ok) >= 1 },
  { id: 'diagonal', name: 'Diagonal', description: 'Either corner-to-corner diagonal', balls: 75, defaultPoints: 10,
    check: (c, ok) => countFull(diags75(c), ok) >= 1 },
  { id: 'corners75', name: '4 Corners', description: 'All four corner squares', balls: 75, defaultPoints: 10,
    check: (c, ok) => full([c.cells[0]![0], c.cells[0]![4], c.cells[4]![0], c.cells[4]![4]] as number[], ok) },
  { id: 'lines2', name: '2 Lines', description: 'Any two full lines (rows, columns or diagonals)', balls: 75, defaultPoints: 20,
    check: (c, ok) => countFull(allLines75(c), ok) >= 2 },
  { id: 'row2', name: '2 Rows', description: 'Any two full horizontal rows', balls: 75, defaultPoints: 20,
    check: (c, ok) => countFull(rows75(c), ok) >= 2 },
  { id: 'row3', name: '3 Rows', description: 'Any three full horizontal rows', balls: 75, defaultPoints: 30,
    check: (c, ok) => countFull(rows75(c), ok) >= 3 },
  { id: 'x', name: 'X', description: 'Both diagonals', balls: 75, defaultPoints: 25,
    check: (c, ok) => countFull(diags75(c), ok) === 2 },
  { id: 'plus', name: 'Plus', description: 'Middle row and middle column', balls: 75, defaultPoints: 20,
    check: (c, ok) => full(rows75(c)[2]!, ok) && full(cols75(c)[2]!, ok) },
  { id: 'frame', name: 'Frame', description: 'The whole outer edge', balls: 75, defaultPoints: 30,
    check: (c, ok) => { const r = rows75(c), k = cols75(c); return full(r[0]!, ok) && full(r[4]!, ok) && full(k[0]!, ok) && full(k[4]!, ok); } },
  { id: 'blackout', name: 'Blackout', description: 'Every square on the card', balls: 75, defaultPoints: 50,
    check: (c, ok) => countFull(rows75(c), ok) === 5 },

  // 90-ball (UK + tambola)
  { id: 'early5', name: 'Early Five', description: 'Any five numbers (Jaldi 5)', balls: 90, defaultPoints: 10,
    check: (c, ok) => rows90(c).flat().filter(ok).length >= 5 },
  { id: 'top', name: 'Top Line', description: 'All five numbers on the top row', balls: 90, defaultPoints: 15,
    check: (c, ok) => full(rows90(c)[0]!, ok) },
  { id: 'middle', name: 'Middle Line', description: 'All five numbers on the middle row', balls: 90, defaultPoints: 15,
    check: (c, ok) => full(rows90(c)[1]!, ok) },
  { id: 'bottom', name: 'Bottom Line', description: 'All five numbers on the bottom row', balls: 90, defaultPoints: 15,
    check: (c, ok) => full(rows90(c)[2]!, ok) },
  { id: 'corners90', name: '4 Corners', description: 'First and last number of the top and bottom rows', balls: 90, defaultPoints: 15,
    check: (c, ok) => full(corners90(c), ok) },
  { id: 'star', name: 'Star', description: '4 corners plus the centre number of the middle row', balls: 90, defaultPoints: 20,
    check: (c, ok) => full([...corners90(c), rows90(c)[1]![2]!], ok) },
  { id: 'oneLine', name: '1 Line', description: 'Any full row', balls: 90, defaultPoints: 10,
    check: (c, ok) => countFull(rows90(c), ok) >= 1 },
  { id: 'twoLines', name: '2 Lines', description: 'Any two full rows', balls: 90, defaultPoints: 20,
    check: (c, ok) => countFull(rows90(c), ok) >= 2 },
  { id: 'house', name: 'Full House', description: 'All fifteen numbers', balls: 90, defaultPoints: 50,
    check: (c, ok) => countFull(rows90(c), ok) === 3 },
  { id: 'house2', name: '2nd Full House', description: 'Full house after the first one has gone', balls: 90, defaultPoints: 30,
    check: (c, ok) => countFull(rows90(c), ok) === 3 },
];

export const PRIZE_BY_ID = new Map(PRIZES.map((p) => [p.id, p]));

export interface PrizePreset {
  name: string;
  balls: 75 | 90;
  prizes: string[];
}

export const PRESETS: PrizePreset[] = [
  { name: 'Classic', balls: 75, prizes: ['line', 'blackout'] },
  { name: 'Party', balls: 75, prizes: ['line', 'corners75', 'x', 'blackout'] },
  { name: 'Rows ladder', balls: 75, prizes: ['row1', 'row2', 'row3', 'blackout'] },
  { name: 'UK 90-ball', balls: 90, prizes: ['oneLine', 'twoLines', 'house'] },
  { name: 'Tambola', balls: 90, prizes: ['early5', 'top', 'middle', 'bottom', 'corners90', 'house'] },
  { name: 'Tambola deluxe', balls: 90, prizes: ['early5', 'top', 'middle', 'bottom', 'corners90', 'star', 'house', 'house2'] },
];
