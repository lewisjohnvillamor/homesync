/**
 * Composition 7's line. The picture is s06's camera, in close on the phone.
 */

export function build({ el, tl, u, portrait, t0, t1 }) {
  // On a band: in the close-up the T line runs to the top of the frame, and
  // the line of type must sit in front of it, not be crossed by it.
  el.innerHTML = `
    <div class="band" style="left:${portrait ? 54 * u : 104 * u}px;top:${portrait ? 130 * u : 76 * u}px;padding:${18 * u}px ${28 * u}px;background:rgba(11,14,19,0.94)">
      <div class="line" style="font:700 ${portrait ? 80 * u : 76 * u}px/1.08 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">…and works out how early to start.</div>
    </div>`;
  const line = el.querySelector('.band');
  // Set by 13.80 s; leaves fast before the camera pulls back.
  tl.fromTo(line, { x: -60 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, t0 + 0.2);
  tl.to(line, { x: 20 * u, duration: t1 - 0.25 - (t0 + 0.7), ease: 'none' }, t0 + 0.7);
  tl.to(line, { y: -40 * u, opacity: 0, duration: 0.22, ease: 'power2.in' }, t1 - 0.25);
}
