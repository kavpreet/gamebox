/** Standard English Scrabble letter distribution and values. '?' = blank. */
export const LETTER_VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  '?': 0,
};

export const LETTER_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
  '?': 2,
};

export function buildBag(): string[] {
  const bag: string[] = [];
  for (const [letter, n] of Object.entries(LETTER_COUNTS)) {
    for (let i = 0; i < n; i++) bag.push(letter);
  }
  return bag; // 100 tiles
}

export type Premium = 'DL' | 'TL' | 'DW' | 'TW' | null;

/**
 * Standard 15×15 premium layout. 'T'=triple word, 'D'=double word,
 * 't'=triple letter, 'd'=double letter, '.'=plain.
 */
const LAYOUT = [
  'T..d...T...d..T',
  '.D...t...t...D.',
  '..D...d.d...D..',
  'd..D...d...D..d',
  '....D.....D....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  'T..d...D...d..T',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....D.....D....',
  'd..D...d...D..d',
  '..D...d.d...D..',
  '.D...t...t...D.',
  'T..d...T...d..T',
];

export function premiumAt(row: number, col: number): Premium {
  const ch = LAYOUT[row]?.[col];
  if (ch === 'T') return 'TW';
  if (ch === 'D') return 'DW';
  if (ch === 't') return 'TL';
  if (ch === 'd') return 'DL';
  return null;
}

export const BOARD_SIZE = 15;
export const CENTER = 7;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
