/**
 * Composition 8's line. The diagram is tilted to the house camera's angle,
 * its lanes rising to the right, which leaves the lower right of the frame
 * open: the line is set there, right-aligned on plain ground, and only after
 * the tilt has settled, so no line of the diagram ever passes through it.
 * At the hand-over it is the front object and leaves towards the camera on
 * its own, just ahead of the sheet (s06's lift): from 17.10, while still at
 * full brightness, it grows 1.0 → 1.6× about its own centre with an ease-in
 * and no travel, so it plainly comes at the lens. Its opacity holds full for
 * the first half of the move and is 0 by 17.26, before the sheet, growing
 * about T, sweeps the TV lane down through its place (~17.25). While it is
 * above ~30 % opacity it stays EDGE inside every side of the frame: where
 * that would cap its growth (9:16, and the bottom of 16:9) the growth to that
 * point is held to the cap and the rest is spent, still accelerating, once it
 * is fainter. It never comes near the dot.
 */

/** The line's exit towards the camera: it starts here, while bright, and is gone at OUT[1]. */
const OUT = [17.1, 17.26];
/** Its final scale, reached at OUT[1] with progress k^EASE (an ease-in). */
const GROW = 0.6;
const EASE = 2;
/** Its opacity holds at full to HOLD of the way through, then falls (cosine) to 0 at OUT[1]. */
const HOLD = 0.5;
/** While above 30 % opacity the line stays this far (design px) inside each side of the frame. */
const EDGE = 24;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function build({ el, tl, u, W, H, portrait, t0, onFrame }) {
  const right = portrait ? 70 * u : 110 * u;
  el.innerHTML = `
    <div class="lift" style="position:absolute;inset:0">
      <div class="line" style="position:absolute;right:${right}px;top:${portrait ? 1480 * u : 860 * u}px;text-align:right;
           font:700 ${portrait ? 86 * u : 80 * u}px/1.08 var(--sans);letter-spacing:-0.03em;color:var(--text);white-space:nowrap">Scheduled to be heard<br>at one agreed instant.</div>
    </div>`;
  const line = el.querySelector('.line');
  const lift = el.querySelector('.lift');
  // In from the right on the cut, as the plane starts to tilt (the lower
  // right stays clear of the diagram throughout the pull back), so the frame
  // keeps a line through it; set by ~16.0 s; drifts until the sheet lifts.
  tl.fromTo(line, { x: 140 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, t0);
  tl.to(line, { x: -30 * u, duration: 17.2 - (t0 + 0.5), ease: 'sine.inOut' }, t0 + 0.5);
  // The exit: its own push towards the camera from 17.10 (see the header).
  /** Progress through the fade at which the opacity is 0.3 (cosine fall). */
  const k30 = HOLD + (1 - HOLD) * (Math.acos(2 * 0.3 - 1) / Math.PI);
  onFrame((t) => {
    const k = clamp01((t - OUT[0]) / (OUT[1] - OUT[0]));
    const f = clamp01((k - HOLD) / (1 - HOLD));
    const o = 0.5 + 0.5 * Math.cos(Math.PI * f);
    lift.style.visibility = k >= 1 ? 'hidden' : '';
    if (k <= 0) {
      lift.style.transform = 'none';
      lift.style.opacity = '1';
      return;
    }
    // Its box on screen before the push (the push is set after this read),
    // including its own drift in x; the frame's layer starts at 0, 0.
    lift.style.transform = 'none';
    const r = line.getBoundingClientRect();
    const w = r.width;
    const cx = r.left + w / 2;
    const cy = r.top + r.height / 2;
    const h = r.height;
    // The most it may grow (about its centre) and still sit EDGE inside every side.
    const gMax = Math.max(1, Math.min((Math.min(cx, W - cx) - EDGE * u) / (w / 2), (Math.min(cy, H - cy) - EDGE * u) / (h / 2)));
    const gFree = 1 + GROW * k30 ** EASE;
    let g;
    if (gFree <= gMax) g = 1 + GROW * k ** EASE;
    else if (k <= k30) g = 1 + (gMax - 1) * (k / k30) ** EASE;
    else {
      // Past the 30 % point: on from the cap to 1 + GROW at OUT[1], keeping
      // the slope it had there and still accelerating (convex: an ease-in).
      const d = 1 - k30;
      const s0 = ((gMax - 1) * EASE) / k30;
      const c = Math.max(0, (1 + GROW - gMax - s0 * d) / (d * d));
      const x = k - k30;
      g = gMax + s0 * x + c * x * x;
    }
    lift.style.transformOrigin = `${cx}px ${cy}px`;
    lift.style.transform = `scale(${g})`;
    lift.style.opacity = String(o);
  });
}
