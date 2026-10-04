/**
 * Composition 4: the HomeSync mark grows out of the full stop.
 *
 * The dot never stops: as composition 3's words rush past the camera it is
 * already gliding to the left of frame and growing, and the mark's arcs draw
 * outward around it, inner pair first — the mark's scale is the dot's size,
 * so the two cannot come apart. Only once the dot is home and the mark at full
 * size does "HomeSync" slide in to its right, so the dot never passes over the
 * word and the arcs never cross it. While it holds, the arcs breathe and the
 * dot pulses softly under a slow push. In 9:16 the mark fills the
 * width of the upper half, the word under it (storyboard).
 *
 * Then the arcs and wordmark lift up and out fast (ease-in, ~7 frames from
 * 7.85 s, gone by 7.97 s) and the dot is let go — into the next composition.
 * Everything is computed from t in one frame hook.
 */

import { span, lerp, clamp01 } from '../shared/beats.js';
import { arcsSvg, MARK_DOT_RATIO } from '../shared/devices.js';
import { handoff } from '../shared/handoff.js';

/** Visible from the moment the dot leaves the full stop; gone before composition 5's layer appears. */
export const pad = [0.15, 0];

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;
const expoOut = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const sineInOut = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);

export function build({ el, u, W, H, portrait, t0, t1, hostDot, onFrame, waitFor }) {
  // The outer arcs reach 0.51 S either side of the centre and ±0.34 S above
  // and below it (radius 11 over a chord of 15, plus the stroke).
  // 16:9: the lockup spans 87 % of the width (margins ≥ 96 px), the word
  // ~1.3× its round-1 size. "HomeSync" at this weight is ~5.43 em wide; the
  // exact width is measured below for centring.
  const PUSH = 1.04;
  const GAPK = 0.11;
  const wordSize = portrait ? 176 * u : 172 * u;
  const S = portrait ? 920 * u : (0.87 * W - 5.43 * wordSize) / (1.02 * PUSH + GAPK);
  /** Clear space between the outer arc (at its largest, with the push) and the word. */
  const GAP = portrait ? 0 : GAPK * S;

  el.innerHTML = `
    <div class="mark" style="position:absolute;left:0;top:0;width:${S}px;height:${S}px;will-change:transform">${arcsSvg()}</div>
    <div class="word" style="position:absolute;left:0;top:0;white-space:nowrap;font:800 ${wordSize}px/1 var(--sans);letter-spacing:-0.04em;color:var(--text)">HomeSync</div>`;
  const mark = el.querySelector('.mark');
  const svg = mark.querySelector('svg');
  svg.style.cssText = 'width:100%;height:100%;overflow:visible';
  const word = el.querySelector('.word');
  const arcs = ['.arc-inner-l', '.arc-inner-r', '.arc-outer-l', '.arc-outer-r'].map((q) => svg.querySelector(q));
  const lens = arcs.map((a) => a.getTotalLength());
  arcs.forEach((a, i) => {
    a.style.strokeDasharray = `${lens[i]}`;
    a.style.transformBox = 'view-box';
    a.style.transformOrigin = '12px 12px';
  });

  // Layout: the lockup centred with equal margins (16:9), or the mark high
  // and the word under it (9:16). The word's width is measured once the font
  // is in.
  const geo = { mx: W * 0.3, my: H * 0.5, wx: W * 0.6, wy: H * 0.5 };
  const layout = () => {
    const ww = word.getBoundingClientRect().width;
    if (portrait) {
      geo.mx = W / 2;
      geo.my = H * 0.36;
      geo.wx = (W - ww) / 2;
      geo.wy = geo.my + 0.34 * S * PUSH + 70 * u;
    } else {
      const total = 1.02 * S * PUSH + GAP + ww;
      const margin = (W - total) / 2;
      geo.mx = margin + 0.51 * S * PUSH;
      geo.my = H * 0.5;
      geo.wx = margin + 1.02 * S * PUSH + GAP;
      geo.wy = geo.my - wordSize * 0.56;
    }
  };
  layout();
  waitFor(document.fonts.ready.then(layout));

  // Times.
  const START = t0 - 0.15; // 6.10: the dot leaves the full stop as the words rush away
  const DRAW = t0; // 6.25: the arcs start drawing out of the dot
  const HOME = t0 + 0.5; // 6.75: dot home, mark at full size
  const WORD = HOME - 0.03; // the word only once the mark has stopped growing
  const LEAVE = t1 - 0.275; // 7.85
  const GONE = LEAVE + 0.12; // 7.97: nothing of this composition is left

  // The drop: from 7.76 s the dot leaves the mark's centre, shrinking (ease-in,
  // 13 frames) and falling to where composition 5 picks it up at 7.98 s —
  // s05's dot at its first frame: (700u, 830u) in 16:9, (W/2, 980u) in 9:16,
  // 36u across. If s05 moves it, the film's flight bridges the last frame.
  const DROP = [LEAVE - 0.09, 7.98];
  const PICKUP = portrait ? { x: W / 2, y: 980 * u, d: 36 * u, glow: 0.25 } : { x: 700 * u, y: 830 * u, d: 36 * u, glow: 0.25 };
  const from = () => handoff.stopAt?.(START) ?? { x: W * 0.7, y: H * 0.6, d: 30 * u };
  const dotFull = S * MARK_DOT_RATIO;

  /** The dot's path and size: glides home while it grows into the mark's centre. */
  const centre = (t) => {
    const f = from();
    const k = easeInOut(span(t, START, HOME));
    // A gentle arc, never a straight cursor-like line: the dot dips under the
    // line it is leaving and rises into place.
    const dip = Math.sin(Math.PI * k) * (portrait ? -60 : 70) * u;
    return { x: lerp(f.x, geo.mx, k), y: lerp(f.y, geo.my, k) + dip };
  };
  /** The mark's scale at t: grows with the dot, then a slow push. */
  const markScale = (t) => {
    const f = from();
    const grow = lerp(f.d / dotFull, 1, easeOut(span(t, START + 0.05, HOME)));
    return grow * lerp(1, PUSH, span(t, HOME, LEAVE));
  };
  /** Breathing during the hold, ramped in so it never fights the arrival. */
  const breathe = (t) => clamp01((t - HOME) / 0.3);

  onFrame((t) => {
    if (t < START || t >= t1) return;
    const c = centre(t);
    const s = markScale(t);
    const lift = (span(t, LEAVE, GONE)) ** 2; // ease-in
    const liftBy = lift * (Math.max(geo.my + 0.36 * S * PUSH, geo.wy + wordSize) + 60 * u);
    const gone = t >= GONE;

    mark.style.visibility = gone ? 'hidden' : 'visible';
    mark.style.transform = `translate(${c.x - S / 2}px, ${c.y - S / 2 - liftBy}px) scale(${s})`;
    mark.style.opacity = String(1 - lift);

    // The arcs draw outward from the dot, inner pair first, then breathe.
    const b = breathe(t);
    arcs.forEach((a, i) => {
      const outer = i >= 2;
      const k = expoOut(span(t, DRAW + (outer ? 0.12 : 0), DRAW + (outer ? 0.12 : 0) + 0.55));
      a.style.strokeDashoffset = `${lens[i] * (1 - k)}`;
      const phase = (t - HOME) * ((2 * Math.PI) / 1.25) - (outer ? 0.9 : 0);
      a.style.transform = `scale(${1 + b * (outer ? 0.04 : 0.03) * Math.sin(phase)})`;
      a.style.opacity = String(lerp(1, 0.93, b * (0.5 + 0.5 * Math.sin(phase))));
    });

    // The word: slides in from beyond the mark (from the right in 16:9, from
    // below in 9:16), moving away from the arcs, never towards them past its
    // resting place; then drifts slowly outward while it holds.
    const w = expoOut(span(t, WORD, WORD + 0.5));
    const drift = sineInOut(span(t, WORD + 0.3, LEAVE)) * 18 * u;
    const wx = geo.wx + (portrait ? 0 : (1 - w) * 160 * u + drift);
    const wy = geo.wy + (portrait ? (1 - w) * 120 * u + drift : 0) - liftBy;
    word.style.visibility = gone || t < WORD ? 'hidden' : 'visible';
    word.style.transform = `translate(${wx}px, ${wy}px)`;
    word.style.opacity = String(Math.min(easeOut(span(t, WORD, WORD + 0.3)), 1 - lift));
  });

  // The dot: from the full stop to the mark's centre, its size always the
  // mark's centre at the mark's current scale; pulses softly while it holds.
  const held = (t) => {
    const c = centre(t);
    const b = breathe(t);
    const pulse = Math.sin((t - HOME) * ((2 * Math.PI) / 1.25) + 0.6);
    return {
      x: c.x,
      y: c.y + Math.sin((t - START) * 2.3) * 1.5 * u * b,
      d: dotFull * markScale(t) * (1 + 0.05 * b * pulse),
      glow: lerp(from().glow ?? 0.4, 0.14, span(t, START, HOME)) + 0.12 * b * (0.5 + 0.5 * pulse),
    };
  };
  hostDot(START, DROP[1], (t) => {
    const h = held(Math.min(t, DROP[0]));
    if (t <= DROP[0]) return held(t);
    const k = span(t, ...DROP);
    const fall = easeInOut(k);
    // Straight down out of the mark first, then across: it never crosses an arc.
    return {
      x: lerp(h.x, PICKUP.x, fall * fall),
      y: lerp(h.y, PICKUP.y, fall),
      // Ease-in: it lets go of the mark slowly, then shrinks to its new size.
      d: lerp(h.d, PICKUP.d, k * k),
      glow: lerp(h.glow, PICKUP.glow, k),
    };
  });
}
