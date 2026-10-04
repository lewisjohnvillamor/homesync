/**
 * Composition 8's line. The diagram is tilted to the house camera's angle,
 * its lanes rising to the right, which leaves the lower right of the frame
 * open: the line is set there, right-aligned on plain ground, and only after
 * the tilt has settled, so no line of the diagram ever passes through it.
 */

export function build({ el, tl, u, W, portrait, t0 }) {
  const right = portrait ? 70 * u : 110 * u;
  el.innerHTML = `
    <div class="line" style="position:absolute;right:${right}px;top:${portrait ? 1500 * u : 800 * u}px;text-align:right;
         font:700 ${portrait ? 86 * u : 80 * u}px/1.08 var(--sans);letter-spacing:-0.03em;color:var(--text);white-space:nowrap">Scheduled to be heard<br>at one agreed instant.</div>`;
  const line = el.querySelector('.line');
  // In from the right as the tilt settles, set by ~16.3 s, starting 15.9 s; drifts; leaves (17.40–17.60) before the plane lifts.
  tl.fromTo(line, { x: 140 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, t0 + 0.27);
  tl.to(line, { x: -30 * u, duration: 17.4 - (t0 + 0.77), ease: 'sine.inOut' }, t0 + 0.77);
  tl.to(line, { y: 40 * u, opacity: 0, duration: 0.2, ease: 'power2.in' }, 17.4);
  void W;
}
