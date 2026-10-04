/**
 * The beat grid every composition is cut to.
 *
 * 96 BPM: one beat is 0.625 s, one bar of four is 2.5 s, and the 30 s film is
 * exactly 48 beats. Compositions start and end on whole beats, so every scene
 * change lands on a beat of the score.
 */
export const BPM = 96;
export const BEAT = 60 / BPM;
export const DURATION = 48 * BEAT;

/** Seconds at beat `n`. */
export const beat = (n) => n * BEAT;

/** Compositions, in beats. Matches storyboard.md. */
export const SCENES = [
  { id: 1, name: 'press-play', from: 0, to: 3 },
  { id: 2, name: 'echo', from: 3, to: 6 },
  { id: 3, name: 'now', from: 6, to: 10 },
  { id: 4, name: 'mark', from: 10, to: 13 },
  { id: 5, name: 'join', from: 13, to: 17 },
  { id: 6, name: 'one-instant', from: 17, to: 21 },
  { id: 7, name: 'own-delay', from: 21, to: 25 },
  { id: 8, name: 'heard-at-once', from: 25, to: 29 },
  { id: 9, name: 'house', from: 29, to: 35 },
  { id: 10, name: 'your-machine', from: 35, to: 39 },
  { id: 11, name: 'terminal', from: 39, to: 43 },
  { id: 12, name: 'end-card', from: 43, to: 48 },
].map((scene) => ({ ...scene, t0: beat(scene.from), t1: beat(scene.to) }));

/** A seeded generator, because unseeded randomness would make frames differ between renders. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp to [0, 1]. */
export const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Progress of `t` through [a, b], clamped. */
export const span = (t, a, b) => clamp01((t - a) / (b - a));

/** Linear interpolation. */
export const lerp = (a, b, k) => a + (b - a) * k;
