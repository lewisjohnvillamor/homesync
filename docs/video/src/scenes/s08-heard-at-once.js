/**
 * Composition 8's line. The diagram is tilted to the house camera's angle,
 * its lanes rising to the right, which leaves the lower right of the frame
 * open: the line is set there, right-aligned on plain ground, and only after
 * the tilt has settled, so no line of the diagram ever passes through it.
 * At the hand-over it rides composition 8's sheet (s06's lift): it grows and
 * rises out of the top with the lanes, one piece, never fading in place over
 * the house. It is text, so it is never cut round the dot as the lanes are:
 * as the sheet carries it up towards the dot it fades out whole, gone before
 * it comes within ~60 px of the dot's rim (rule: nothing flies through text).
 * It is also gone within the lift's first few frames (OUT): before it has grown
 * past ~1.05×, so never cut by the frame's edges, and before the house coming
 * up underneath is past ~10 % (17.27), so it is never seen over the picture.
 */

import { sheetLift } from './s06-one-instant.js';

/** The line leaves with the sheet and is gone by OUT[1]: its opacity falls as (1 − k)², fast at first. */
const OUT = [17.19, 17.27];

export function build({ el, tl, u, W, portrait, t0, onFrame }) {
  const right = portrait ? 70 * u : 110 * u;
  el.innerHTML = `
    <div class="clear" style="position:absolute;inset:0">
      <div class="lift" style="position:absolute;inset:0">
        <div class="line" style="position:absolute;right:${right}px;top:${portrait ? 1480 * u : 860 * u}px;text-align:right;
             font:700 ${portrait ? 86 * u : 80 * u}px/1.08 var(--sans);letter-spacing:-0.03em;color:var(--text);white-space:nowrap">Scheduled to be heard<br>at one agreed instant.</div>
      </div>
    </div>`;
  const line = el.querySelector('.line');
  const clear = el.querySelector('.clear');
  const lift = el.querySelector('.lift');
  // In from the right on the cut, as the plane starts to tilt (the lower
  // right stays clear of the diagram throughout the pull back), so the frame
  // keeps a line through it; set by ~16.0 s; drifts until the sheet lifts.
  tl.fromTo(line, { x: 140 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, t0);
  tl.to(line, { x: -30 * u, duration: 17.2 - (t0 + 0.5), ease: 'sine.inOut' }, t0 + 0.5);
  // From 17.20 it leaves with the sheet: the same growth about T, the same
  // rise and the same fade; and it fades out whole as it nears the dot.
  /** How far before the clear disc round the dot the line starts to fade (px). */
  const NEAR = (portrait ? 420 : 280) * u;
  onFrame((t) => {
    const s = sheetLift.at?.(t) ?? null;
    const k = Math.min(1, Math.max(0, (t - OUT[0]) / (OUT[1] - OUT[0])));
    const out = (1 - k) ** 2;
    line.parentElement.style.visibility = k >= 1 ? 'hidden' : '';
    if (!s) {
      lift.style.transform = 'none';
      lift.style.opacity = String(out);
      clear.style.maskImage = 'none';
      clear.style.webkitMaskImage = 'none';
      return;
    }
    lift.style.transformOrigin = `${s.ox}px ${s.oy}px`;
    clear.style.maskImage = s.mask;
    clear.style.webkitMaskImage = s.mask;
    // Its box on screen before the lift (the lift's transform is set after
    // this read), and how near the lift carries it to the dot: it fades out
    // whole before the clear disc round the dot, and stays out once past it.
    lift.style.transform = 'none';
    const r = line.getBoundingClientRect();
    const near = sheetLift.nearFade(t, [{ x: r.left, y: r.top }, { x: r.right, y: r.top }, { x: r.right, y: r.bottom }, { x: r.left, y: r.bottom }], NEAR);
    lift.style.transform = `translateY(${s.dy}px) scale(${s.g})`;
    lift.style.opacity = String(s.o * near * out);
  });
  void W;
}
