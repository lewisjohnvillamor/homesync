/**
 * Composition 3: "Nothing tells them when "now" is." — and the three "nows"
 * become one.
 *
 * Two halves of solid ground slide in with the two lines from opposite
 * sides and cover the floor. The three lag markers left on the floor by
 * composition 2 fly in from exactly where they were and merge into one round
 * dot: the sentence's full stop. The dot is the brand circle, never the
 * font's glyph. When the words rush past the camera, it is the one thing left.
 */

import { span, lerp, clamp01 } from '../shared/beats.js';
import { handoff } from '../shared/handoff.js';

/** Hosts the dot through composition 4's opening so the mark can grow from it. */
export const pad = [0.35, 0.05];

const easeOut = (k) => 1 - (1 - k) ** 3;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function build({ el, tl, u, W, H, portrait, t0, t1, onFrame, hostDot, waitFor }) {
  const size = portrait ? 132 * u : 184 * u;
  const half = portrait ? 'top:0;left:0;right:0;height:50%' : 'top:0;bottom:0;left:0;width:50.5%';
  const other = portrait ? 'bottom:0;left:0;right:0;height:50.5%' : 'top:0;bottom:0;right:0;width:50%';
  el.innerHTML = `
    <div class="ground-a" style="position:absolute;${half};background:var(--bg)"></div>
    <div class="ground-b" style="position:absolute;${other};background:var(--bg)"></div>
    <div class="words" style="position:absolute;inset:0">
      <div class="l1" style="position:absolute;white-space:nowrap;font:800 ${size}px/1 var(--sans);letter-spacing:-0.035em;color:var(--text)">Nothing tells them</div>
      <div class="l2" style="position:absolute;white-space:nowrap;font:800 ${size}px/1 var(--sans);letter-spacing:-0.035em;color:var(--text)">when “now” is</div>
    </div>
    <i class="m m1" style="position:absolute;left:0;top:0;border-radius:50%;background:var(--accent)"></i>
    <i class="m m2" style="position:absolute;left:0;top:0;border-radius:50%;background:var(--accent)"></i>`;

  const groundA = el.querySelector('.ground-a');
  const groundB = el.querySelector('.ground-b');
  const words = el.querySelector('.words');
  const l1 = el.querySelector('.l1');
  const l2 = el.querySelector('.l2');
  const extras = [el.querySelector('.m1'), el.querySelector('.m2')];

  // Layout, once the font is in: a centred two-line block whose second line
  // ends in the dot. The full stop is a circle the size of the font's own.
  const geo = { stop: { x: W * 0.7, y: H * 0.6 }, d: size * 0.19 };
  waitFor(
    document.fonts.ready.then(() => {
      const w1 = l1.getBoundingClientRect().width;
      const w2 = l2.getBoundingClientRect().width;
      const gap = size * 0.05;
      const block = Math.max(w1, w2 + gap + geo.d);
      const left = (W - block) / 2;
      const lineH = size * 1.08;
      const top = H / 2 - lineH + (portrait ? 0 : -size * 0.04);
      l1.style.left = `${left}px`;
      l1.style.top = `${top}px`;
      l2.style.left = `${left + block - (w2 + gap + geo.d)}px`;
      l2.style.top = `${top + lineH}px`;
      // Baseline sits ~0.77 em below the top of a line box at line-height 1.
      const baseline = top + lineH + size * 0.77;
      geo.stop = { x: left + block - geo.d / 2, y: baseline - geo.d / 2 };
    }),
  );

  // Ground and words arrive together, slowing as they land; set by 4.40 s.
  const from = portrait ? { a: { yPercent: -100 }, b: { yPercent: 100 } } : { a: { xPercent: -100 }, b: { xPercent: 100 } };
  tl.fromTo(groundA, from.a, { xPercent: 0, yPercent: 0, duration: 0.42, ease: 'expo.out' }, t0 - 0.3);
  tl.fromTo(groundB, from.b, { xPercent: 0, yPercent: 0, duration: 0.42, ease: 'expo.out' }, t0 - 0.3);
  const enter = portrait ? { y: -260 * u } : { x: -520 * u };
  const enter2 = portrait ? { y: 260 * u } : { x: 520 * u };
  tl.fromTo(l1, { ...enter, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' }, t0 - 0.05);
  tl.fromTo(l2, { ...enter2, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' }, t0 + 0.04);
  // Held, never still: a slow push on the whole sentence.
  tl.fromTo(words, { scale: 1 }, { scale: 1.035, duration: 5.9 - (t0 + 0.6), ease: 'none', transformOrigin: '50% 50%' }, t0 + 0.6);
  // Then the words rush past the camera; the full stop stays.
  tl.to(words, { scale: 2.6, opacity: 0, filter: 'blur(14px)', duration: 0.32, ease: 'power3.in', transformOrigin: '50% 50%' }, 5.9);

  handoff.stopAt = (t) => stopAt(t);

  // The two lines' current offset, so the dot rides in with the second line.
  const lineOffset = () => ({ x: gsap.getProperty(l2, 'x'), y: gsap.getProperty(l2, 'y') });

  /** Where the full stop is at time t, including the push. */
  const stopAt = (t) => {
    const push = t < 5.9 ? lerp(1, 1.035, span(t, t0 + 0.6, 5.9)) : 1.035;
    return {
      x: W / 2 + (geo.stop.x - W / 2) * push,
      y: H / 2 + (geo.stop.y - H / 2) * push,
      d: geo.d * push,
    };
  };

  // The three markers fly in from where composition 2 left them and merge.
  // The film's dot is the TV's marker (the latest "now"); the other two are
  // drawn here and disappear into it.
  const MERGE = [t0, t0 + 0.62];

  /**
   * The flight from a marker to the full stop: a curve whose last stretch
   * comes in level from the right. The stop is the rightmost thing on its
   * line, so arriving from the right never crosses a letter.
   */
  const flight = (m, stop, k) => {
    // Low and to the right: the dots travel under the sentence, clear of its
    // descenders, and swing up into place from the right of the last word.
    const cx = stop.x + 520 * u;
    const cy = stop.y + 330 * u;
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const c = k * k;
    return { x: a * m.x + b * cx + c * stop.x, y: a * m.y + b * cy + c * stop.y };
  };
  // Where composition 2 shows the markers at the moment this composition
  // starts — asked of composition 1 as a function of time, never remembered
  // from whichever frame happened to be drawn last.
  const markersAt = (t) => (handoff.markersAt ? handoff.markersAt(Math.min(t, t0)) : []);
  onFrame((t) => {
    const frozen = markersAt(t);
    const k = easeInOut(span(t, ...MERGE));
    const stop = stopAt(t);
    const line = lineOffset();
    extras.forEach((e, i) => {
      const m = frozen[i];
      if (!m || t < t0 - 0.35 || k >= 1 || t > t1) {
        e.style.visibility = 'hidden';
        return;
      }
      e.style.visibility = 'visible';
      const p = flight(m, { x: stop.x + line.x, y: stop.y + line.y }, k);
      const x = p.x;
      const y = p.y;
      const d = lerp(m.d, stop.d, k);
      e.style.width = `${d}px`;
      e.style.height = `${d}px`;
      e.style.transform = `translate(${x - d / 2}px, ${y - d / 2}px)`;
    });
  });

  hostDot(t0 - 0.35, t1 + 0.05, (t) => {
    const m = markersAt(t)[2] ?? { x: W * 0.7, y: H * 0.7, d: 20 };
    const k = easeInOut(span(t, ...MERGE));
    const stop = stopAt(t);
    const line = t < 5.9 ? lineOffset() : { x: 0, y: 0 };
    // A drift that never stops, so the moment the words leave is not a freeze.
    const drift = Math.sin(t * 2.1) * 2 * u;
    if (t < t0) {
      // Still on the floor, as composition 2 left it.
      return { x: m.x, y: m.y, d: m.d, glow: 0 };
    }
    const p = flight(m, { x: stop.x + line.x, y: stop.y + line.y }, k);
    return {
      x: p.x + drift,
      y: p.y,
      d: lerp(m.d, stop.d, k),
      glow: 0.4 * clamp01((t - 5.9) / 0.3),
    };
  });
  void easeOut;
}
