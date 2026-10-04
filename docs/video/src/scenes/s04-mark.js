/**
 * Composition 4: the HomeSync mark grows out of the full stop.
 *
 * The dot holds for a moment where the sentence left it, then glides to the
 * left of frame while the mark scales up around it and its arcs draw outward,
 * inner pair first; "HomeSync" slides in to its right. The dot's size is the
 * mark's centre at the mark's current scale, so the two cannot come apart. In
 * 9:16 the mark is larger than the frame and cropped by its edges, so this
 * is never the end card's layout.
 *
 * Then the arcs and wordmark lift away fast and the dot drops out — into the
 * next composition.
 */

import { span, lerp } from '../shared/beats.js';
import { arcsSvg, MARK_DOT_RATIO } from '../shared/devices.js';
import { handoff } from '../shared/handoff.js';

export const pad = [0.05, 0.1];

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function build({ el, tl, u, W, H, portrait, t0, t1, hostDot, onFrame }) {
  // The outer arcs reach 0.51 S either side of the centre (radius 11 over a
  // chord of 15, plus the stroke), and "HomeSync" is ~5 em wide. The lockup
  // is centred with equal margins, and the word starts clear of the right arc.
  const S = portrait ? 1500 * u : 740 * u;
  const wordSize = portrait ? 200 * u : 168 * u;
  const margin = (W - (1.02 * S + 0.06 * S + 5.0 * wordSize)) / 2;
  const mx = portrait ? W / 2 : margin + 0.51 * S;
  const my = portrait ? H * 0.34 : H * 0.5;

  el.innerHTML = `
    <div class="mark" style="position:absolute;left:0;top:0;width:${S}px;height:${S}px">${arcsSvg()}</div>
    <div class="word" style="position:absolute;white-space:nowrap;font:800 ${wordSize}px/1 var(--sans);letter-spacing:-0.04em;color:var(--text);
         ${portrait ? `left:0;right:0;text-align:center;top:${H * 0.62}px` : `left:${mx + S * 0.57}px;top:${my - wordSize * 0.56}px`}">HomeSync</div>`;
  const mark = el.querySelector('.mark');
  const svg = mark.querySelector('svg');
  svg.style.cssText = 'width:100%;height:100%;overflow:visible';
  const word = el.querySelector('.word');
  const arcs = ['.arc-inner-l', '.arc-inner-r', '.arc-outer-l', '.arc-outer-r'].map((q) => svg.querySelector(q));
  for (const a of arcs) {
    const len = a.getTotalLength();
    a.style.strokeDasharray = `${len}`;
    a.style.strokeDashoffset = `${len}`;
  }

  const HOLD_END = t0 + 0.2;
  const ARRIVE = t0 + 0.75;
  const LEAVE = t1 - 0.3;

  // Where the full stop was when composition 3 let go of it.
  const from = () => handoff.stopAt?.(t0 + 0.05) ?? { x: W * 0.7, y: H * 0.6, d: 30 * u };
  const centre = (t) => {
    const k = easeInOut(span(t, HOLD_END, ARRIVE));
    const f = from();
    return { x: lerp(f.x, mx, k), y: lerp(f.y, my, k) };
  };

  arcs.forEach((a, i) => {
    tl.to(a, { strokeDashoffset: 0, duration: 0.55, ease: 'expo.out' }, HOLD_END + 0.12 + (i >= 2 ? 0.14 : 0));
  });
  // The mark starts at the size of the full stop it grows out of.
  const startScale = from().d / (S * MARK_DOT_RATIO);
  tl.fromTo(mark, { scale: startScale, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.6, ease: 'expo.out' }, HOLD_END + 0.05);
  tl.to(mark, { scale: 1.03, duration: LEAVE - (HOLD_END + 0.65), ease: 'none' }, HOLD_END + 0.65);
  tl.fromTo(
    word,
    portrait ? { y: 120 * u, opacity: 0 } : { x: 160 * u, opacity: 0 },
    { x: 0, y: 0, opacity: 1, duration: 0.55, ease: 'expo.out' },
    HOLD_END + 0.25,
  );
  tl.to(word, { x: portrait ? 0 : 18 * u, duration: LEAVE - (HOLD_END + 0.8), ease: 'none' }, HOLD_END + 0.8);
  // Leaving: arcs and word lift away fast; the dot is let go to fall.
  tl.to([mark, word], { y: -140 * u, opacity: 0, duration: 0.26, ease: 'power3.in' }, LEAVE);

  // The mark is positioned from the dot's path, so they arrive together.
  onFrame((t) => {
    const c = centre(t);
    mark.style.left = `${c.x - S / 2}px`;
    mark.style.top = `${c.y - S / 2}px`;
  });

  hostDot(t0 + 0.05, LEAVE + 0.02, (t) => {
    const c = centre(t);
    const f = from();
    const scale = t < HOLD_END + 0.05 ? startScale : gsap.getProperty(mark, 'scale');
    return {
      x: c.x,
      y: c.y + Math.sin(t * 2.3) * 1.5 * u,
      d: Math.max(f.d, S * MARK_DOT_RATIO * scale),
      glow: lerp(0.4, 0.12, span(t, HOLD_END, ARRIVE)),
    };
  });
}
