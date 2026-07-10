/**
 * Deterministic seeded PRNG (mulberry32). The engine owns one instance per game
 * instance; its seed/state live only in server-side persisted state and are never
 * sent to any client — this keeps dice/shuffles both fair (clients can't predict
 * them) and replayable (deterministic from the stored seed + move log).
 */
export interface SeededRandom {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Fisher-Yates shuffle, returns a new array. */
  shuffle<T>(items: T[]): T[];
  /** Serializable snapshot of internal state, for persistence. */
  getState(): number;
}

export function createSeededRandom(seed: number): SeededRandom {
  let a = seed >>> 0;

  function rawNext(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next: rawNext,
    int(min: number, max: number): number {
      return Math.floor(rawNext() * (max - min + 1)) + min;
    },
    shuffle<T>(items: T[]): T[] {
      const arr = items.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rawNext() * (i + 1));
        [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
      }
      return arr;
    },
    getState(): number {
      return a;
    },
  };
}

export function newSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
