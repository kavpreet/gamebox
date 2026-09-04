/**
 * Table sounds, synthesised in the browser.
 *
 * Deliberately no audio files: the kiosk boots over the LAN and a handful of
 * oscillator blips cost nothing to ship and never 404. Each cue is short and
 * dry so it reads as "something happened on the table" rather than as music.
 *
 * Autoplay policy means a TV that nobody has touched cannot make noise. We
 * never throw for that — `enabled()` reports it so the UI can show a small
 * "tap for sound" nudge, and everything else degrades to silence.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Call from any user gesture — browsers only start an AudioContext from one. */
export function unlockSound(): void {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume();
}

export function soundReady(): boolean {
  return ctx !== null && ctx.state === 'running' && !muted;
}

export function setMuted(v: boolean): void {
  muted = v;
}

interface ToneOpts {
  freq: number;
  /** Slide to this frequency across the tone; omitted = steady pitch. */
  to?: number;
  durMs: number;
  type?: OscillatorType;
  gain?: number;
  delayMs?: number;
}

function tone({ freq, to, durMs, type = 'sine', gain = 1, delayMs = 0 }: ToneOpts): void {
  const a = audio();
  if (!a || muted) return;
  if (a.state === 'suspended') return; // not unlocked yet — stay silent, don't queue
  const t0 = a.currentTime + delayMs / 1000;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + durMs / 1000);
  // Short attack, exponential tail — a struck-object envelope, not a pad.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(g).connect(master!);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

function noise(durMs: number, gain = 0.5, delayMs = 0): void {
  const a = audio();
  if (!a || muted || a.state === 'suspended') return;
  const frames = Math.max(1, Math.floor((a.sampleRate * durMs) / 1000));
  const buf = a.createBuffer(1, frames, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = gain;
  const hp = a.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900;
  src.connect(hp).connect(g).connect(master!);
  src.start(a.currentTime + delayMs / 1000);
}

export const sfx = {
  /** Dice tumbling in a cup, then settling. */
  dice(): void {
    for (let i = 0; i < 7; i++) noise(45, 0.35 - i * 0.03, i * 62);
    noise(90, 0.4, 470);
  },
  /** One square of token travel — pitch climbs as you go, Mario-Party style. */
  hop(step: number, total: number): void {
    const ratio = total > 1 ? step / (total - 1) : 1;
    tone({ freq: 480 + ratio * 320, durMs: 80, type: 'triangle', gain: 0.5 });
  },
  /** Token lands. */
  land(): void {
    tone({ freq: 300, to: 180, durMs: 160, type: 'sine', gain: 0.7 });
  },
  /** Money moves. Rising for income, falling for a payment. */
  cash(positive: boolean): void {
    if (positive) {
      tone({ freq: 660, durMs: 90, type: 'square', gain: 0.35 });
      tone({ freq: 990, durMs: 140, type: 'square', gain: 0.3, delayMs: 85 });
    } else {
      tone({ freq: 520, durMs: 90, type: 'square', gain: 0.32 });
      tone({ freq: 330, durMs: 170, type: 'square', gain: 0.3, delayMs: 85 });
    }
  },
  card(): void {
    noise(110, 0.45);
    tone({ freq: 1400, to: 700, durMs: 120, type: 'triangle', gain: 0.22 });
  },
  capture(): void {
    tone({ freq: 220, to: 70, durMs: 280, type: 'sawtooth', gain: 0.4 });
  },
  build(): void {
    tone({ freq: 180, durMs: 70, type: 'square', gain: 0.5 });
    tone({ freq: 260, durMs: 110, type: 'square', gain: 0.4, delayMs: 70 });
  },
  jail(): void {
    tone({ freq: 300, to: 120, durMs: 420, type: 'sawtooth', gain: 0.35 });
  },
  /** It is now your turn. */
  yourTurn(): void {
    tone({ freq: 660, durMs: 120, type: 'sine', gain: 0.5 });
    tone({ freq: 880, durMs: 200, type: 'sine', gain: 0.45, delayMs: 110 });
  },
  /** Turn clock is nearly out. */
  tick(): void {
    tone({ freq: 1200, durMs: 45, type: 'square', gain: 0.25 });
  },
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, durMs: 260, type: 'triangle', gain: 0.45, delayMs: i * 130 }),
    );
  },
};

/** Map a beat straight onto a cue, so callers don't repeat this switch. */
export function playBeatSound(kind: string, data?: Record<string, unknown>): void {
  switch (kind) {
    case 'dice':
      sfx.dice();
      break;
    case 'money':
      sfx.cash(Number(data?.amount ?? 0) >= 0);
      break;
    case 'card':
      sfx.card();
      break;
    case 'capture':
      sfx.capture();
      break;
    case 'build':
      sfx.build();
      break;
    case 'jail':
      sfx.jail();
      break;
    case 'turn':
      sfx.yourTurn();
      break;
    default:
      break;
  }
}
