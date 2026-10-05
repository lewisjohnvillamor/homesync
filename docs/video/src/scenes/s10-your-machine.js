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
import { handoff } from '../shared/handoff.js';

/** "Your LAN" starts sliding in while the house is still dropping away. */
export const pad = [0.18, 0.06];

const LINES = ['Your LAN', 'Your files', 'Your machine'];

const expoOut = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const cubicOut = (k) => 1 - (1 - k) ** 3;
const quartOut = (k) => 1 - (1 - k) ** 4;
const cubicIn = (k) => k * k * k;

export function build({ el, u, W, H, portrait, t0, t1, onFrame, hostDot, waitFor }) {
  const size = portrait ? 140 * u : 184 * u;
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
  const IN = [t0 - 0.16, t0 + 0.38, t0 + 1.25];
  const OUT = [t0 + 0.54, t0 + 1.155, t1 - 0.17];
  const LEAVE = t1 - 0.25; // 24.125: gone before the terminal frame shows
  const PUSH = [t0, LEAVE];

  // Layout (measured once the font is in).
  const geo = { stop: { x: W * 0.72, y: H * 0.55 }, d: size * 0.19, gap: size * 0.05, w: [0, 0, 0], left: [0, 0, 0], top: [0, 0, 0], sz: [size, size, size] };
  waitFor(
    document.fonts.ready.then(() => {
      // Each line is set as large as the frame allows — one line per beat,
      // so each fills the width on its own — all right-aligned to the one
      // full stop, which never moves.
      // One size for all three — a parallel list — set by the widest line.
      const target = portrait ? W - 200 * u : W * 0.8;
      const w0 = lines.map((l) => l.getBoundingClientRect().width);
      const k1 = Math.min(target / Math.max(...w0), 1.9);
      const k = w0.map(() => k1);
      geo.sz = k.map((ki) => size * ki);
      lines.forEach((l, i) => { l.style.fontSize = `${geo.sz[i]}px`; });
      const kd = Math.sqrt(Math.min(...k) * Math.max(...k));
      geo.d = size * 0.19 * kd;
      geo.gap = size * 0.08 * kd;
      geo.w = lines.map((l) => l.getBoundingClientRect().width);
      const blTops = lines.map((l) => l.querySelector('.bl').getBoundingClientRect().top - l.getBoundingClientRect().top);
      const block = Math.max(...geo.w) + geo.gap + geo.d;
      const left = (W - block) / 2;
      // Caps centred on the frame (by the largest line); 9:16 sits a little low.
      const big = Math.max(...geo.sz);
      const baseline = portrait ? H * 0.56 + big * 0.3 : H / 2 + big * 0.36;
      geo.top = blTops.map((b) => baseline - b);
      geo.stop = { x: left + block - geo.d / 2, y: baseline - geo.d * 0.5 };
      geo.left = geo.w.map((w) => geo.stop.x - geo.d / 2 - geo.gap - w);
      if (portrait) {
        // 9:16: the three lines stack, filling the tall frame as they arrive;
        // the dot moves down to be the newest line's full stop.
        // The size is set by "Your machine." filling the width, so the block
        // fills the height with open leading instead — one line per beat.
        const lead = 1.75;
        const rel = [0, geo.sz[1] * lead, geo.sz[1] * lead + geo.sz[2] * lead];
        const capTop = -geo.sz[0] * 0.72;
        const shift = H * 0.52 - (capTop + rel[2]) / 2;
        const base = rel.map((r) => r + shift);
        geo.top = blTops.map((b, i) => base[i] - b);
        geo.left = geo.w.map(() => left);
        geo.rows = geo.w.map((w, i) => ({ x: left + w + geo.gap + geo.d / 2, y: base[i] - geo.d * 0.5 }));
        geo.stop = geo.rows[0];
      }
    }),
  );

  // Lines from the left come from off the frame's edge.
  const travelOf = (i) => (i === 1 ? 560 * u : geo.left[i] + geo.w[i] + 80 * u);
  const dropOf = (i) => geo.sz[i] * 1.06; // the lower lane: cap tops clear the dot's bottom

  /** A line's offset from its resting place at time t, and its opacity. */
  const lineAt = (i, t) => {
    let x = 0;
    let y = 0;
    let o = 1;
    const kIn = span(t, IN[i], IN[i] + 0.32);
    if (portrait) {
      // Each line slides into its own row from alternate sides and stays.
      const from = i === 1 ? 1 : -1;
      const dist = i === 1 ? W - geo.left[i] + 60 * u : geo.left[i] + geo.w[i] + 60 * u;
      x = from * dist * (1 - cubicOut(span(t, IN[i], IN[i] + 0.42)));
      o = clamp01((t - IN[i]) / 0.06) * (1 - clamp01((t - LEAVE - 0.02) / 0.1));
      if (t < IN[i]) o = 0;
      return { x, y, o };
    }
    if (i === 1) {
      // From the right, below the dot's line; rises only once its last
      // letter has passed left of the dot.
      const kx = span(t, IN[i], IN[i] + 0.5);
      x = travelOf(i) * (1 - expoOut(kx));
      y = dropOf(i) * (1 - cubicOut(span(t, IN[i] + 0.2, IN[i] + 0.34)));
      o = clamp01((t - IN[i]) / 0.14);
    } else {
      x = -travelOf(i) * (1 - cubicOut(span(t, IN[i], IN[i] + 0.42)));
      o = clamp01((t - IN[i]) / 0.06);
    }
    if (i < 2) {
      // Eased up and out by the next line.
      const k = span(t, OUT[i], OUT[i] + 0.3);
      y -= geo.sz[i] * 1.3 * quartOut(k);
      o *= 1 - clamp01((t - OUT[i]) / 0.22);
    } else {
      // The last line rushes past the camera with the whole sentence (see
      // the frame hook), fading only at the very end.
      o *= 1 - clamp01((t - LEAVE - 0.02) / 0.1);
    }
    if (t < IN[i]) o = 0;
    return { x, y, o };
  };

  const pushAt = (t) => lerp(1, portrait ? 1.05 : 1.1, span(t, ...PUSH) ** 1.6);

  /** The full stop at time t (it moves only with the push). */
  const stopAt = (t) => {
    const s = pushAt(t);
    let st = geo.stop;
    if (portrait && geo.rows) {
      const a = cubicOut(span(t, IN[1] + 0.3, IN[1] + 0.5));
      const b = cubicOut(span(t, IN[2] - 0.12, IN[2] + 0.06));
      const r = geo.rows;
      st = { x: lerp(lerp(r[0].x, r[1].x, a), r[2].x, b), y: lerp(lerp(r[0].y, r[1].y, a), r[2].y, b) };
    }
    return { x: W / 2 + (st.x - W / 2) * s, y: H / 2 + (st.y - H / 2) * s, d: geo.d * s };
  };

  onFrame((t) => {
    const s = pushAt(t);
    // Leaving, the words rush towards the camera about the full stop, which
    // stays put: the slow push about the centre, then the rush about the dot.
    const rush = 1 + 1.6 * span(t, LEAVE - 0.02, LEAVE + 0.14) ** 2;
    const P = stopAt(t);
    words.style.transformOrigin = `${W / 2}px ${H / 2}px`;
    words.style.transform = `translate(${(W / 2 - P.x) * (rush - 1)}px, ${(H / 2 - P.y) * (rush - 1)}px) scale(${s * rush})`;
    lines.forEach((l, i) => {
      const p = lineAt(i, t);
      l.style.transform = `translate(${geo.left[i] + p.x}px, ${geo.top[i] + p.y}px)`;
      l.style.opacity = String(p.o);
      l.style.visibility = p.o > 0.001 ? 'visible' : 'hidden';
    });
    // The ground is the same colour as the frame behind it, so fading it
    // shows nothing — and a half-opaque copy of the ground rounds one level
    // off, which the encoder spreads over the whole frame. It goes at once at
    // 24.30, as the terminal window starts to appear.
    ground.style.opacity = String(t < t0 + 0.07 ? clamp01((t - t0) / 0.07) : t < LEAVE + 0.175 ? 1 : 0);
    if (t < t0) ground.style.opacity = '0';
  });

  // Hosts the dot from the start of the composition to just after the words
  // begin to clear. It arrives a little large (it has risen towards the
  // camera) and settles to the size of a full stop as "Your LAN" lands.
  // Where the dot arrives, a little large, for composition 9 to aim at.
  handoff.lanDotAt = (t) => {
    const st = stopAt(t);
    return { x: st.x, y: st.y, d: st.d };
  };

  hostDot(t0, LEAVE + 0.075, (t) => {
    const st = stopAt(t);
    const k = cubicOut(span(t, t0, t0 + 0.36));
    const drift = Math.sin((t - t0) * 2.4) * 1.5 * u;
    return {
      x: st.x + drift,
      y: st.y,
      d: st.d * (1 + 0.1 * Math.max(0, Math.cos(Math.PI * 2 * ((t - t0) / 0.625))) ** 6 * span(t, t0 + 0.6, t0 + 0.7)),
      glow: lerp(0.45, 0.08, k) + 0.3 * span(t, LEAVE - 0.05, LEAVE + 0.075),
    };
  });
}
