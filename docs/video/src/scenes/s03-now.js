/**
 * Composition 3: "Nothing tells them when "now" is." — and the three "nows"
 * become one.
 *
 * As composition 2's floor sinks and darkens underneath, its three lag
 * markers lift off it towards the camera — growing, and coming down the frame
 * the way a thing rising towards a high camera does — into a row below where
 * the sentence will sit. The two lines arrive from opposite sides on plain
 * ground; the markers sweep along under the sentence and rise into its end,
 * merging into one round dot: the full stop. The dot is the brand circle,
 * never the font's glyph. While it holds, the sentence pushes in and its two
 * lines drift apart. When the words rush past the camera, the dot is the one
 * thing left.
 */

import { span, lerp, clamp01 } from '../shared/beats.js';
import { handoff } from '../shared/handoff.js';

/** From the moment the markers lift until composition 4 has the dot. */
export const pad = [0.35, 0];

const easeOut = (k) => 1 - (1 - k) ** 3;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function build({ el, tl, u, W, H, portrait, t0, t1, onFrame, hostDot, waitFor }) {
  // 16:9: two lines across the frame. 9:16: four lines at about twice the
  // size, so the type fills the frame; the full stop always ends the last.
  const size = portrait ? 138 * u : 184 * u;
  const texts = portrait ? ['Nothing tells', 'them when', '“now” is'] : ['Nothing tells them', 'when “now” is'];
  const lineStyle = `position:absolute;white-space:nowrap;font:800 ${size}px/1 var(--sans);letter-spacing:-0.035em;color:var(--text)`;
  el.innerHTML = `
    <div class="ground" style="position:absolute;inset:0;background:var(--bg)"></div>
    <div class="words" style="position:absolute;inset:0"><div class="push" style="position:absolute;inset:0">
      ${texts
        .map((txt, i) => `<div class="ln" style="${lineStyle}">${txt}${i === texts.length - 1 ? '<span class="bl" style="display:inline-block;width:0;height:0"></span>' : ''}</div>`)
        .join('')}
    </div></div>
    <i class="m m1" style="position:absolute;left:0;top:0;border-radius:50%;background:var(--accent)"></i>
    <i class="m m2" style="position:absolute;left:0;top:0;border-radius:50%;background:var(--accent)"></i>`;

  const ground = el.querySelector('.ground');
  const words = el.querySelector('.words');
  const pushEl = el.querySelector('.push');
  const bl = el.querySelector('.bl');
  const lines = [...el.querySelectorAll('.ln')];
  const last = lines[lines.length - 1];
  /** First half of the lines arrive from the left and drift left; the rest from the right. */
  const side = (i) => (i < lines.length / 2 ? -1 : 1);
  const extras = [el.querySelector('.m1'), el.querySelector('.m2')];

  // Layout, once the font is in: a centred two-line block whose second line
  // ends in the dot. The full stop is a circle the size of the font's own.
  const geo = { stop: { x: W * 0.7, y: H * 0.6 }, d: size * 0.19, bottom: H * 0.65 };
  const layout = () => {
    const ws = lines.map((l) => l.getBoundingClientRect().width);
    const wl = ws[ws.length - 1];
    const gap = size * 0.05;
    const block = Math.max(...ws.slice(0, -1), wl + gap + geo.d);
    const left = (W - block) / 2;
    const lineH = size * (portrait ? 1.02 : 1.08);
    const n = lines.length;
    const top = H / 2 - (n * lineH) / 2 + (portrait ? 0 : size * 0.04);
    lines.forEach((l, i) => {
      // 16:9: the last line is set flush right, ending in the stop; 9:16:
      // every line flush left.
      const x = !portrait && i === n - 1 ? left + block - (wl + gap + geo.d) : left;
      l.style.left = `${x}px`;
      l.style.top = `${top + i * lineH}px`;
    });
    // The baseline, measured: a zero-height inline box sits on it.
    const lastTop = top + (n - 1) * lineH;
    const baseline = lastTop + bl.offsetTop;
    const lastLeft = !portrait ? left + block - (wl + gap + geo.d) : left;
    geo.stop = { x: lastLeft + wl + gap + geo.d / 2, y: baseline - geo.d / 2 };
    geo.bottom = lastTop + size;
  };
  layout();
  waitFor(document.fonts.ready.then(layout));

  // Times.
  const LIFT = t0 - 0.35; // 3.40: the markers lift off the floor
  const SWEEP = t0 - 0.12; // 3.63: they sweep under the sentence…
  const MERGED = t0 + 0.65; // 4.40: …and merge into the full stop, once every line has stopped
  const EXIT = 5.9;

  // Plain ground arrives under the sinking floor; it is fully there before
  // the first word is.
  tl.fromTo(ground, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'power2.out' }, t0 - 0.05);
  // The lines from opposite sides, slowing as they land; set by 4.40 s.
  // (in 9:16 too they come from the sides, so nothing crosses the markers'
  // row below the sentence)
  lines.forEach((l, i) => {
    const late = i >= lines.length / 2;
    tl.fromTo(
      l,
      // 16:9 from the sides; 9:16 from the top and the bottom (storyboard).
      portrait ? { y: side(i) * 260 * u, opacity: 0 } : { x: side(i) * 520 * u, opacity: 0 },
      { x: 0, y: 0, opacity: 1, duration: 0.5, ease: 'expo.out' },
      // On the beat (3.75 s); every line set by 4.40.
      t0 + 0.05 + (late ? 0.1 : 0) + (portrait ? 0.04 * (i % 2) : 0),
    );
  });
  // Then the words rush past the camera; the full stop stays.
  const EXIT_DUR = 0.32;
  tl.to(words, { scale: 2.6, opacity: 0, filter: 'blur(14px)', duration: EXIT_DUR, ease: 'power3.in' }, EXIT);


  // Held, never still: a 6 % push on the whole sentence, and its two lines
  // drifting slowly apart. Computed here so the full stop can follow exactly.
  const PUSH = portrait ? 1.04 : 1.05;
  // In 9:16 the four lines nearly fill the width: no sideways drift there,
  // only the push.
  const DRIFT = (portrait ? 0 : 24) * u;
  // The push starts just before the dot lands (the dot follows it exactly);
  // the lines only start drifting once it has landed.
  // A steady push (linear, as a slow push may be): no stretch of it is still.
  const pushAt = (t) => lerp(1, PUSH, span(t, MERGED - 0.3, EXIT));
  const driftAt = (t) => span(t, MERGED, EXIT) * DRIFT;

  /**
   * Where the full stop is at time t. The hold's push is about the
   * sentence's centre (so neither line runs off an edge); the exit is about
   * the stop as it was when the exit began, so the dot stays exactly where it
   * is while the words rush away from it, and the "s" only moves away.
   */
  const stopAt = (t) => {
    const tt = Math.min(t, EXIT);
    const p = pushAt(tt);
    return {
      x: W / 2 + (geo.stop.x + driftAt(tt) - W / 2) * p,
      y: H / 2 + (geo.stop.y - H / 2) * p,
      d: geo.d * p,
    };
  };
  /** The dot as composition 4 receives it: the full stop, still drifting, starting to glow. */
  const dotAt = (t) => {
    const s = stopAt(t);
    const settle = clamp01((t - MERGED) / 0.5);
    return { x: s.x + Math.sin((t - MERGED) * 2.1) * 2.5 * u * settle, y: s.y, d: s.d, glow: 0.4 * clamp01((t - EXIT) / 0.3) };
  };
  handoff.stopAt = dotAt;

  // Where composition 2 left the markers at the moment they lift — asked of
  // composition 1 as a function of time, never remembered from a frame.
  const markers = () => (handoff.markersAt ? handoff.markersAt(LIFT) : []);

  /** The row below the sentence the markers lift into. */
  const rowY = () => geo.bottom + (portrait ? 170 : 120) * u;
  const margin = 110 * u;

  /** A marker's path at t: lift towards the camera, sweep, merge. */
  const markerAt = (m, i, t) => {
    // Quick enough to be in the row below before the words arrive over it.
    const lift = easeOut(span(t, LIFT, SWEEP));
    // Lifted: larger, lower, a little closer together, inside the margins.
    // Spread evenly about where they were, laptop to the left, TV to the
    // right, so no two ever overlap.
    const ms = markers();
    const mean = ms.reduce((acc, q) => acc + q.x, 0) / Math.max(1, ms.length);
    const spacing = (portrait ? 150 : 190) * u;
    const lifted = {
      // Drifting all the way to the merge, so the markers never stop dead.
      x: Math.min(W - margin, Math.max(margin, lerp(mean, W / 2, 0.2) + (i - 1) * spacing)) + 110 * u * (Math.min(t, MERGED) - LIFT),
      y: rowY() + (i - 1) * 14 * u,
      d: m.d * 1.7,
    };
    if (t < SWEEP) {
      return { x: lerp(m.x, lifted.x, lift), y: lerp(m.y, lifted.y, lift), d: lerp(m.d, lifted.d, lift) };
    }
    // Sweep along under the sentence, past the end of it, and curl up into
    // the stop from below-right, so the last stretch never crosses a letter.
    const k = easeInOut(span(t, SWEEP, MERGED));
    const s = stopAt(t);
    const c = { x: Math.min(s.x + 150 * u, W - 40 * u), y: lifted.y };
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const cc = k * k;
    return {
      x: a * lifted.x + b * c.x + cc * s.x,
      y: a * lifted.y + b * c.y + cc * s.y,
      d: lerp(lifted.d, s.d, k),
    };
  };

  onFrame((t) => {
    if (t < LIFT || t >= t1) return;
    lines.forEach((l, i) => {
      l.style.translate = `${side(i) * driftAt(t)}px 0`;
    });
    pushEl.style.scale = String(pushAt(Math.min(t, EXIT)));
    const o = stopAt(EXIT);
    words.style.transformOrigin = `${o.x}px ${o.y}px`;
    const ms = markers();
    extras.forEach((e, i) => {
      const m = ms[i];
      if (!m || t >= MERGED) {
        e.style.visibility = 'hidden';
        return;
      }
      const p = markerAt(m, i, t);
      e.style.visibility = 'visible';
      e.style.width = `${p.d}px`;
      e.style.height = `${p.d}px`;
      e.style.transform = `translate(${p.x - p.d / 2}px, ${p.y - p.d / 2}px)`;
    });
  });

  // The film's dot is the TV's marker (the latest "now"); the other two are
  // drawn here and disappear into it.
  hostDot(LIFT, t1 - 0.15, (t) => {
    const m = markers()[2] ?? { x: W * 0.7, y: H * 0.7, d: 20 };
    if (t < MERGED) {
      const p = markerAt(m, 2, t);
      return { x: p.x, y: p.y, d: p.d, glow: 0 };
    }
    return dotAt(t);
  });
}
