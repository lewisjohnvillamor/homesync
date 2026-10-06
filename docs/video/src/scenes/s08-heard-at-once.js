/**
 * Composition 8's line. The diagram is tilted to the house camera's angle,
 * its lanes rising to the right, which leaves the lower right of the frame
 * open: the line is set there, right-aligned on plain ground, and only after
 * the tilt has settled, so no line of the diagram ever passes through it.
 * It holds, drifting, with the finished diagram to the beat at 17.5. Then it
 * is the front object and leaves towards the camera on its own, just ahead of
 * the sheet (s06's lift, from 17.55): over 17.50–17.72 it grows about its own
 * centre with an ease-in and no travel, to 1.15× (never cropped by the frame:
 * held EDGE inside every side). Its opacity holds full for the first half of
 * the move, then falls with an ease-in (1 − f²), so it is still seen pushing
 * forward until its last frames, and reaches 0 at 17.72, before the sheet,
 * growing about T, reaches the line's box. It is drawn in front of the sheet
 * (its layer is raised). It never comes near the dot.
 */

/** The line's exit towards the camera: it starts here, while bright, and is gone at OUT[1]. */
const OUT = [17.5, 17.72];
/** Its final scale, reached at OUT[1] with progress k^EASE (an ease-in); capped so it stays EDGE inside the frame. */
const GROW = 0.15;
const EASE = 2;
/** Its opacity holds at full to HOLD of the way through, then falls (1 − f², an ease-in) to 0 at OUT[1]. */
const HOLD = 0.5;
/** The line stays this far (design px) inside each side of the frame. */
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
  tl.to(line, { x: -30 * u, duration: OUT[1] - (t0 + 0.5), ease: 'sine.inOut' }, t0 + 0.5);
  // The exit: its own push towards the camera from 17.5, on the beat (see the header).
  // In front of the sheet (s06), which is drawn before it.
  el.style.zIndex = '1';
  onFrame((t) => {
    const k = clamp01((t - OUT[0]) / (OUT[1] - OUT[0]));
    const f = clamp01((k - HOLD) / (1 - HOLD));
    const o = 1 - f * f;
    lift.style.visibility = k >= 1 ? 'hidden' : '';
    if (k <= 0 || k >= 1) {
      lift.style.transform = 'none';
      lift.style.opacity = k >= 1 ? '0' : '1';
      return;
    }
    // Its box on screen before the push (the push is set after this read),
    // including its own drift in x; the frame's layer starts at 0, 0.
    lift.style.transform = 'none';
    const r = line.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // The most it may grow (about its centre) and still sit EDGE inside every side.
    const gMax = Math.max(1, Math.min((Math.min(cx, W - cx) - EDGE * u) / (r.width / 2), (Math.min(cy, H - cy) - EDGE * u) / (r.height / 2)));
    const g = 1 + Math.min(GROW, gMax - 1) * k ** EASE;
    lift.style.transformOrigin = `${cx}px ${cy}px`;
    lift.style.transform = `scale(${g})`;
    lift.style.opacity = String(o);
  });
}
