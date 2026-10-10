import type { SeededRandom } from '@gamebox/core-engine';

/**
 * A card is a grid of cells. 75-ball: 5×5, column B=1–15 … O=61–75, the
 * centre cell is FREE (0). 90-ball (tambola ticket): 3 rows × 9 columns,
 * column 0 = 1–9, column 1 = 10–19 … column 8 = 80–90; each row holds exactly
 * five numbers, blanks are null, numbers ascend down each column.
 */
export type Cell = number | null;
export interface Card {
  cells: Cell[][];
}

export const FREE = 0;
export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

/** "B 12" for 75-ball, plain "12" for 90-ball. */
export function ballLabel(balls: 75 | 90, n: number): string {
  if (balls === 90) return String(n);
  return `${BINGO_LETTERS[Math.min(4, Math.floor((n - 1) / 15))]} ${n}`;
}

export function generateCard75(rng: SeededRandom): Card {
  const cols: number[][] = [];
  for (let c = 0; c < 5; c++) {
    const range = Array.from({ length: 15 }, (_, i) => c * 15 + i + 1);
    cols.push(rng.shuffle(range).slice(0, 5));
  }
  const cells: Cell[][] = [];
  for (let r = 0; r < 5; r++) {
    cells.push(cols.map((col, c) => (r === 2 && c === 2 ? FREE : col[r]!)));
  }
  return { cells };
}

function columnRange90(c: number): number[] {
  const lo = c === 0 ? 1 : c * 10;
  const hi = c === 8 ? 90 : c * 10 + 9;
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

export function generateCard90(rng: SeededRandom): Card {
  for (let attempt = 0; attempt < 50; attempt++) {
    // 15 numbers over 9 columns, every column 1..3 numbers
    const counts = Array<number>(9).fill(1);
    let extra = 6;
    while (extra > 0) {
      const c = rng.int(0, 8);
      if (counts[c]! < 3) {
        counts[c]!++;
        extra--;
      }
    }
    // assign rows: fullest columns first, each into the rows with most room left
    const room = [5, 5, 5];
    const rowsOf: number[][] = Array.from({ length: 9 }, () => []);
    const colOrder = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).sort((a, b) => counts[b]! - counts[a]!);
    let ok = true;
    for (const c of colOrder) {
      const rows = rng.shuffle([0, 1, 2]).sort((a, b) => room[b]! - room[a]!).slice(0, counts[c]!);
      if (rows.some((r) => room[r]! <= 0)) {
        ok = false;
        break;
      }
      for (const r of rows) room[r]!--;
      rowsOf[c] = rows.sort((a, b) => a - b);
    }
    if (!ok || room.some((x) => x !== 0)) continue;

    const cells: Cell[][] = [Array(9).fill(null), Array(9).fill(null), Array(9).fill(null)];
    for (let c = 0; c < 9; c++) {
      const nums = rng.shuffle(columnRange90(c)).slice(0, counts[c]!).sort((a, b) => a - b);
      rowsOf[c]!.forEach((r, i) => {
        cells[r]![c] = nums[i]!;
      });
    }
    return { cells };
  }
  throw new Error('Could not generate a 90-ball ticket');
}

export function cardNumbers(card: Card): number[] {
  return card.cells.flat().filter((n): n is number => n !== null && n !== FREE);
}
