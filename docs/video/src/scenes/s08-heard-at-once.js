/**
 * Composition 8's line. The diagram is tilted to the house camera's angle,
 * its lanes rising to the right, which leaves the lower right of the frame
 * open: the line is set there, right-aligned on plain ground, and only after
 * the tilt has settled, so no line of the diagram ever passes through it.
 */

export function build({ el, tl, u, W, portrait, t0 }) {
  const right = portrait ? 70 * u : 110 * u;
  el.innerHTML = `
    <div class="line" style="position:absolute;right:${right}px;top:${portrait ? 1480 * u : 860 * u}px;text-align:right;
         font:700 ${portrait ? 86 * u : 80 * u}px/1.08 var(--sans);letter-spacing:-0.03em;color:var(--text);white-space:nowrap">Scheduled to be heard<br>at one agreed instant.</div>`;
  const line = el.querySelector('.line');
  // In from the right on the cut, as the plane starts to tilt (the lower
  // right stays clear of the diagram throughout the pull back), so the frame
  // keeps a line through it; set by ~16.0 s; drifts; leaves fast (17.20–17.36)
  // as the diagram lifts away above it, so the frame's brightness hands over
  // to the house coming up underneath without a dip.
  tl.fromTo(line, { x: 140 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, t0);
  tl.to(line, { x: -30 * u, duration: 17.2 - (t0 + 0.5), ease: 'sine.inOut' }, t0 + 0.5);
  tl.to(line, { y: -60 * u, opacity: 0, duration: 0.16, ease: 'power2.in' }, 17.2);
  void W;
}
