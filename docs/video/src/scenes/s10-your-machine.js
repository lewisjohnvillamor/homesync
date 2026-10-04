/**
 * Composition 10: "Your LAN. Your files. Your machine."
 *
 * The dot arrives from the house still a little large — it has come towards
 * the camera — and settles at centre-right as the full stop of every line.
 * One line per beat: "Your LAN" slides in from the left; "Your files" comes
 * in from the right along a lane below the dot's line (so it passes under
 * the dot, never through it) and rises into place as "Your LAN" is eased up
 * and out; "Your machine" comes in from the left as "Your files" lifts away.
 * Everything is right-aligned to the dot, which never moves while the words
 * change around it. The whole sentence has a slow push.
 *
 * Leaving, the words clear to the left and this layer's ground thins, so the
 * terminal of composition 11 is already waiting underneath; the dot is let go
 * to fly to where that terminal's cursor is.
 */

import { span, lerp, clamp01 } from '../shared/beats.js';

export const pad = [0, 0.06];

const LINES = ['Your LAN', 'Your files', 'Your machine'];

const expoOut = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const cubicOut = (k) => 1 - (1 - k) ** 3;
const quartOut = (k) => 1 - (1 - k) ** 4;
const cubicIn = (k) => k * k * k;

export function build({ el, u, W, H, portrait, t0, t1, onFrame, hostDot, waitFor }) {
  const size = portrait ? 150 * u : 184 * u;
  const track = portrait ? -0.045 : -0.035;
  // In front of composition 11 while it waits underneath.
  el.style.zIndex = '2';
  el.innerHTML = `
    <div class="ground" style="position:absolute;inset:0;background:var(--bg)"></div>
    <div class="words" style="position:absolute;inset:0">
      ${LINES.map(
        (w, i) => `<div class="ln ln${i}" style="position:absolute;left:0;top:0;white-space:nowrap;font:800 ${size}px/1 var(--sans);letter-spacing:${track}em;color:var(--text);will-change:transform">${w}<span class="bl" style="display:inline-block;width:0;height:0;vertical-align:baseline"></span></div>`,
      ).join('')}
    </div>`;
  const ground = el.querySelector('.ground');
  const words = el.querySelector('.words');
  const lines = [...el.querySelectorAll('.ln')];

  // Times. Each line starts moving on a beat (21.875, 22.5, 23.125) and has
  // landed ~0.35 s later. "Your files" starts a little before its beat
  // because it has a longer road: along the lower lane, then up.
  const IN = [t0, t0 + 0.38, t0 + 1.25];
  const OUT = [t0 + 0.625, t0 + 1.155, t1 - 0.17];
  const LEAVE = t1 - 0.17; // 24.205
  const PUSH = [t0, LEAVE];

  // Layout (measured once the font is in).
  const geo = { stop: { x: W * 0.72, y: H * 0.55 }, d: size * 0.19, gap: size * 0.05, w: [0, 0, 0], left: [0, 0, 0], top: 0, base: 0 };
  waitFor(
    document.fonts.ready.then(() => {
      geo.w = lines.map((l) => l.getBoundingClientRect().width);
      const blTop = lines[0].querySelector('.bl').getBoundingClientRect().top - lines[0].getBoundingClientRect().top;
      geo.base = blTop; // baseline below the line box's top
      const block = Math.max(...geo.w) + geo.gap + geo.d;
      const left = (W - block) / 2;
      // Landscape: caps centred on the frame. Portrait: the dot sits low.
      const baseline = portrait ? H * 0.565 : H / 2 + size * 0.36;
      geo.top = baseline - blTop;
      geo.stop = { x: left + block - geo.d / 2, y: baseline - geo.d * 0.5 };
      geo.left = geo.w.map((w) => geo.stop.x - geo.d / 2 - geo.gap - w);
    }),
  );

  const travel = 560 * u;
  const drop = size * 1.06; // the lower lane: cap tops clear the dot's bottom

  /** A line's offset from its resting place at time t, and its opacity. */
  const lineAt = (i, t) => {
    let x = 0;
    let y = 0;
    let o = 1;
    const kIn = span(t, IN[i], IN[i] + 0.6);
    if (i === 1) {
      // From the right, below the dot's line; rises only once its last
      // letter has passed left of the dot.
      const kx = span(t, IN[i], IN[i] + 0.5);
      x = travel * (1 - expoOut(kx));
      y = drop * (1 - cubicOut(span(t, IN[i] + 0.26, IN[i] + 0.52)));
      o = clamp01((t - IN[i]) / 0.14);
    } else {
      x = -travel * (1 - expoOut(kIn));
      // The first line waits for the ground to cover composition 9.
      o = clamp01((t - IN[i] - (i === 0 ? 0.08 : 0.03)) / 0.12);
    }
    if (i < 2) {
      // Eased up and out by the next line.
      const k = span(t, OUT[i], OUT[i] + 0.3);
      y -= size * 1.3 * quartOut(k);
      o *= 1 - clamp01((t - OUT[i]) / 0.22);
    } else {
      // The last line clears to the left, fast.
      const k = span(t, LEAVE - 0.04, LEAVE + 0.14) ** 2;
      x -= W * 0.55 * k;
      o *= 1 - clamp01((t - LEAVE) / 0.08);
    }
    if (t < IN[i]) o = 0;
    return { x, y, o };
  };

  const pushAt = (t) => lerp(1, portrait ? 1.05 : 1.08, span(t, ...PUSH));

  /** The full stop at time t (it moves only with the push). */
  const stopAt = (t) => {
    const s = pushAt(t);
    return { x: W / 2 + (geo.stop.x - W / 2) * s, y: H / 2 + (geo.stop.y - H / 2) * s, d: geo.d * s };
  };

  onFrame((t) => {
    const s = pushAt(t);
    words.style.transformOrigin = `${W / 2}px ${H / 2}px`;
    words.style.transform = `scale(${s})`;
    lines.forEach((l, i) => {
      const p = lineAt(i, t);
      l.style.transform = `translate(${geo.left[i] + p.x}px, ${geo.top + p.y}px)`;
      l.style.opacity = String(p.o);
      l.style.visibility = p.o > 0.001 ? 'visible' : 'hidden';
    });
    // The ground thins as the words clear, revealing the terminal.
    ground.style.opacity = String(clamp01(t < t0 + 0.07 ? (t - t0) / 0.07 : 1 - (t - LEAVE - 0.06) / 0.12));
  });

  // Hosts the dot from the start of the composition to just after the words
  // begin to clear. It arrives a little large (it has risen towards the
  // camera) and settles to the size of a full stop as "Your LAN" lands.
  hostDot(t0, LEAVE + 0.075, (t) => {
    const st = stopAt(t);
    const k = cubicOut(span(t, t0, t0 + 0.36));
    const drift = Math.sin((t - t0) * 2.4) * 1.5 * u;
    return {
      x: st.x + drift,
      y: st.y,
      d: st.d * lerp(1.9, 1, k) * (1 + 0.1 * Math.max(0, Math.cos(Math.PI * 2 * ((t - t0) / 0.625))) ** 6 * span(t, t0 + 0.6, t0 + 0.7)),
      glow: lerp(0.45, 0.08, k) + 0.3 * span(t, LEAVE - 0.05, LEAVE + 0.075),
    };
  });
}
