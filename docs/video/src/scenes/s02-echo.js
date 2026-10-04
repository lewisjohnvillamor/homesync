/**
 * Composition 2's line. The picture is s01's camera, risen over the floor.
 */

export function build({ el, tl, u, W, portrait, t0, t1 }) {
  el.innerHTML = `
    <div class="band" style="left:${portrait ? 60 * u : 104 * u}px;bottom:${portrait ? 140 * u : 72 * u}px;
         padding:${22 * u}px ${32 * u}px;background:rgba(11,14,19,0.86)">
      <div class="line" style="font:700 ${portrait ? 84 * u : 80 * u}px/1.05 var(--sans);letter-spacing:-0.025em;color:var(--text);${portrait ? `white-space:normal;width:${W - 184 * u}px` : 'white-space:nowrap'}">…and you still get an echo.</div>
    </div>`;
  const band = el.querySelector('.band');
  const line = el.querySelector('.line');
  // Arrives as the TV's bar lands, slowing down, set by 2.35 s; leaves fast before the floor sinks.
  tl.fromTo(band, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' }, 1.95);
  tl.fromTo(line, { x: -70 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.42, ease: 'expo.out' }, 1.95);
  // Gone completely before the floor sinks and the markers lift (3.40 s), so
  // nothing of it is ever cut by what comes next.
  tl.to([band, line], { y: -40 * u, opacity: 0, duration: 0.2, ease: 'power2.in' }, t1 - 0.55);
}
