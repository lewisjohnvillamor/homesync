/**
 * Composition 12: the end card — a centred stack.
 *
 * The terminal's cursor glides to the top of the frame's centre line and the
 * HomeSync mark grows around it: the dot is its centre, and its arcs grow
 * outward from the dot, each drawn from its middle towards both ends. Under
 * it, one after another: "HomeSync", "Try it on two devices.", and the
 * repository URL — the call to action, the largest line under the wordmark,
 * set by 27.60 s. From 28.10 s, dim and smaller, the licence.
 *
 * Never still: the arcs breathe (the outer pair a little behind the inner)
 * and the whole card pushes in slowly to the last frame.
 */

import { span, lerp, clamp01 } from '../shared/beats.js';
import { arcsSvg, MARK_DOT_RATIO } from '../shared/devices.js';
import { terminalGeo, cursorAt } from './s11-terminal.js';

export const pad = [0, 0];

const expoOut = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const cubicOut = (k) => 1 - (1 - k) ** 3;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function build({ el, u, W, H, portrait, t0, t1, onFrame, hostDot, waitFor }) {
  const S = portrait ? 700 * u : 540 * u; // the mark's box; arcs span ±0.35 S
  const sizes = portrait
    ? { word: 184 * u, try: 42 * u, url: 44 * u, lic: 34 * u }
    : { word: 142 * u, try: 48 * u, url: 56 * u, lic: 32 * u };
  const gaps = portrait
    ? { mark: 64 * u, word: 34 * u, try: 46 * u, url: 34 * u }
    : { mark: 40 * u, word: 22 * u, try: 34 * u, url: 28 * u };
  const pill = { py: sizes.url * 0.52, px: sizes.url * (portrait ? 0.55 : 0.85) };

  el.innerHTML = `
    <div class="ground" style="position:absolute;inset:0;background:var(--bg)"></div>
    <div class="card" style="position:absolute;inset:0">
      <div class="mark" style="position:absolute;left:0;top:0;width:${S}px;height:${S}px">${arcsSvg()}</div>
      <div class="stack" style="position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;align-items:center;text-align:center">
        <div class="word" style="font:800 ${sizes.word}px/1 var(--sans);letter-spacing:-0.04em;color:var(--text);white-space:nowrap">HomeSync</div>
        <div class="try" style="margin-top:${gaps.word}px;font:600 ${sizes.try}px/1.2 var(--sans);letter-spacing:-0.01em;color:var(--text);white-space:nowrap">Try it on two devices.</div>
        <div class="url" style="margin-top:${gaps.try}px;padding:${pill.py}px ${pill.px}px;border-radius:999px;background:var(--surface);border:${1.5 * u}px solid var(--line-strong);
             font:600 ${sizes.url}px/1 var(--sans);letter-spacing:-0.012em;white-space:nowrap"><span class="url-text"><span style="color:var(--text)">github.com/lewisjohnvillamor/</span><span style="color:var(--accent)">homesync</span></span></div>
        <div class="lic" style="margin-top:${gaps.url}px;font:500 ${sizes.lic}px/1.2 var(--sans);letter-spacing:0;color:var(--text-dim);white-space:nowrap">Free and open source · MIT licence</div>
      </div>
    </div>`;

  const ground = el.querySelector('.ground');
  const card = el.querySelector('.card');
  const mark = el.querySelector('.mark');
  const svg = mark.querySelector('svg');
  svg.style.cssText = 'width:100%;height:100%;overflow:visible';
  const stack = el.querySelector('.stack');
  const parts = ['.word', '.try', '.url', '.lic'].map((q) => el.querySelector(q));
  const arcs = ['.arc-inner-l', '.arc-inner-r', '.arc-outer-l', '.arc-outer-r'].map((q) => svg.querySelector(q));
  const lens = arcs.map((a) => a.getTotalLength());

  // Vertical layout of the whole stack, centred in the frame.
  const geo = { cx: W / 2, cy: H * 0.32, stackTop: H * 0.5 };
  waitFor(
    document.fonts.ready.then(() => {
      const stackH = stack.getBoundingClientRect().height;
      const markVis = 0.7 * S; // arcs: y from 4.5 to 19.5 of 24, plus the stroke
      const total = markVis + gaps.mark + stackH;
      const top = (H - total) / 2 + (portrait ? -20 * u : 0);
      geo.cy = top + markVis / 2;
      geo.stackTop = top + markVis + gaps.mark;
      stack.style.top = `${geo.stackTop}px`;
    }),
  );

  const HOLD = t0;
  const ARRIVE = t0 + 0.5; // 27.375
  const PUSH0 = ARRIVE;
  const pushAt = (t) => lerp(1, 1.06, span(t, PUSH0, t1));

  // Where composition 11 leaves the cursor.
  const tg = terminalGeo(W, H, u, portrait);
  const from = cursorAt(t0, tg);
  const startScale = from.d / (S * MARK_DOT_RATIO);

  /** The mark's centre (unpushed) at time t. */
  const centre = (t) => {
    const k = easeInOut(span(t, HOLD, HOLD + 0.32));
    return { x: lerp(from.x, geo.cx, k), y: lerp(from.y, geo.cy, k) };
  };
  /** The mark's own scale: grows from the size of the cursor it was. */
  const markScale = (t) => lerp(startScale, 1, expoOut(span(t, HOLD + 0.02, ARRIVE + 0.3)));

  // Text: rises in, slowing; each line on its own moment, all set by 27.60.
  const IN = [t0 + 0.3, t0 + 0.38, t0 + 0.46, 28.1];
  const DUR = [0.55, 0.5, 0.42, 0.6];

  onFrame((t) => {
    const p = pushAt(t);
    card.style.transformOrigin = `${W / 2}px ${H / 2}px`;
    card.style.transform = `scale(${p})`;
    const c = centre(t);
    const ms = markScale(t);
    mark.style.transform = `translate(${c.x - S / 2}px, ${c.y - S / 2}px) scale(${ms})`;

    // Arcs: drawn from their middles outward, and pushed out from the dot
    // as they draw; then breathing.
    arcs.forEach((a, i) => {
      const outer = i >= 2;
      const start = HOLD + 0.26 + (outer ? 0.12 : 0);
      const k = expoOut(span(t, start, start + 0.6));
      const len = lens[i];
      const vis = len * k;
      a.style.strokeDasharray = `${vis} ${len * 2}`;
      a.style.strokeDashoffset = String(-(len - vis) / 2);
      a.style.visibility = vis > len * 0.04 ? 'visible' : 'hidden';
      const grow = lerp(0.45, 1, k);
      const breathe = 1 + 0.05 * Math.sin(((t - ARRIVE) / 1.25) * Math.PI * 2 - (outer ? 0.9 : 0)) * span(t, ARRIVE, ARRIVE + 0.5);
      const s = grow * breathe;
      a.setAttribute('transform', `translate(12 12) scale(${s}) translate(-12 -12)`);
      a.style.opacity = String(outer ? lerp(1, 0.68, 0.5 + 0.5 * Math.sin(((t - ARRIVE) / 1.25) * Math.PI * 2 - 2.2)) : 1);
    });

    parts.forEach((node, i) => {
      const k = span(t, IN[i], IN[i] + DUR[i]);
      const e = expoOut(k);
      node.style.opacity = String(clamp01((t - IN[i]) / (DUR[i] * 0.45)));
      node.style.transform = `translateY(${(portrait ? 46 : 38) * u * (1 - e)}px)`;
    });
    ground.style.opacity = '1';
  });

  hostDot(t0, t1 + 0.1, (t) => {
    const c = centre(t);
    const p = pushAt(t);
    const ms = markScale(t);
    // The dot breathes with the inner arcs, a touch less.
    const breathe = 1 + 0.035 * Math.sin(((t - ARRIVE) / 1.25) * Math.PI * 2) * span(t, ARRIVE, ARRIVE + 0.5);
    return {
      x: W / 2 + (c.x - W / 2) * p,
      y: H / 2 + (c.y - H / 2) * p,
      d: S * MARK_DOT_RATIO * ms * p * breathe,
      glow: lerp(from.glow ?? 0.4, 0.14, span(t, HOLD, ARRIVE + 0.2)),
    };
  });
}
