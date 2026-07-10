import type { SeededRandom } from '@gamebox/core-engine';

export type UnoColor = 'R' | 'Y' | 'G' | 'B';
export type WildColor = UnoColor | null;

export type LightValue =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4'
  // Flip-only light-side values
  | 'draw1' | 'flip' | 'wilddraw2';

export type DarkValue =
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skipall' | 'reverse' | 'draw5' | 'flip' | 'wild' | 'wilddrawcolor';

export interface Face {
  color: UnoColor | 'W';
  value: string;
}

/** Classic UNO card = one face. Flip card = light + dark face. */
export interface UnoCard {
  light: Face;
  /** present only in UNO Flip decks */
  dark?: Face;
}

const COLORS: UnoColor[] = ['R', 'Y', 'G', 'B'];

export function buildClassicDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  for (const color of COLORS) {
    deck.push({ light: { color, value: '0' } });
    for (let n = 1; n <= 9; n++) {
      deck.push({ light: { color, value: String(n) } });
      deck.push({ light: { color, value: String(n) } });
    }
    for (const v of ['skip', 'reverse', 'draw2'] as const) {
      deck.push({ light: { color, value: v } });
      deck.push({ light: { color, value: v } });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ light: { color: 'W', value: 'wild' } });
    deck.push({ light: { color: 'W', value: 'wild4' } });
  }
  return deck; // 108
}

function buildFlipLightFaces(): Face[] {
  const faces: Face[] = [];
  for (const color of COLORS) {
    for (let n = 1; n <= 9; n++) {
      faces.push({ color, value: String(n) });
      faces.push({ color, value: String(n) });
    }
    for (const v of ['skip', 'reverse', 'draw1', 'flip'] as const) {
      faces.push({ color, value: v });
      faces.push({ color, value: v });
    }
  }
  for (let i = 0; i < 4; i++) {
    faces.push({ color: 'W', value: 'wild' });
    faces.push({ color: 'W', value: 'wilddraw2' });
  }
  return faces; // 112
}

function buildFlipDarkFaces(): Face[] {
  const faces: Face[] = [];
  for (const color of COLORS) {
    for (let n = 1; n <= 9; n++) {
      faces.push({ color, value: String(n) });
      faces.push({ color, value: String(n) });
    }
    for (const v of ['skipall', 'reverse', 'draw5', 'flip'] as const) {
      faces.push({ color, value: v });
      faces.push({ color, value: v });
    }
  }
  for (let i = 0; i < 4; i++) {
    faces.push({ color: 'W', value: 'wild' });
    faces.push({ color: 'W', value: 'wilddrawcolor' });
  }
  return faces; // 112
}

/** Flip deck: light and dark faces paired randomly (pairing doesn't affect fairness). */
export function buildFlipDeck(rng: SeededRandom): UnoCard[] {
  const light = buildFlipLightFaces();
  const dark = rng.shuffle(buildFlipDarkFaces());
  return light.map((l, i) => ({ light: l, dark: dark[i]! }));
}

export function faceOf(card: UnoCard, side: 'light' | 'dark'): Face {
  return side === 'dark' && card.dark ? card.dark : card.light;
}

export function isWildFace(face: Face): boolean {
  return face.color === 'W';
}
