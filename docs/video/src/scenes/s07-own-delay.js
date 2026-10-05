/**
 * Composition 7's line. The picture is s06's camera, in close on the phone's
 * lane: the bar fills the width and the T line runs the full height at the
 * right, so the line is set low on plain ground, left of T and below the
 * lane, where nothing of the diagram passes. Different framing from 6 and 8.
 */

/** The line starts rising in during the camera's rush, before the cut (so the beat never thins). */
export const pad = [0.15, 0];

export function build({ el, tl, u, portrait, t0, t1 }) {
  el.innerHTML = `
    <div class="line" style="position:absolute;left:${portrait ? 70 * u : 104 * u}px;top:${portrait ? 1440 * u : 846 * u}px;
         font:700 ${portrait ? 88 * u : 84 * u}px/1.08 var(--sans);letter-spacing:-0.03em;color:var(--text);
         ${portrait ? `width:${800 * u}px` : 'white-space:nowrap'}">…and works out how early to start.</div>`;
  const line = el.querySelector('.line');
  // Rises in from below from 13.00 s (during the camera's rush, 0.125 s before
  // the cut), set by ~13.45; drifts; leaves fast before the camera pulls back.
  tl.fromTo(line, { y: 70 * u, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, t0 - 0.125);
  // Leaves (15.12–15.30) just before the camera pulls back at 15.3.
  tl.to(line, { x: 48 * u, duration: 15.12 - (t0 + 0.25), ease: 'sine.inOut' }, t0 + 0.25);
  tl.to(line, { y: 50 * u, opacity: 0, duration: 0.18, ease: 'power2.in' }, 15.12);
}
