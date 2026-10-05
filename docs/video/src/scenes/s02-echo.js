/**
 * Composition 2's line. The picture is s01's camera, risen over the floor.
 */

/** On screen from 1.675 s, so it can chase the first line out. */
export const pad = [0.2, 0];

export function build({ el, tl, u, portrait, t1 }) {
  el.innerHTML = `
    <div class="band" style="opacity:0;${portrait ? `left:${60 * u}px;top:${70 * u}px` : `left:${96 * u}px;bottom:${72 * u}px`};
         padding:${22 * u}px ${32 * u}px;background:rgba(11,14,19,0.86)">
      <div class="line" style="font:700 ${portrait ? 84 * u : 80 * u}px/1.05 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">…and you still<br>get an echo.</div>
    </div>`;
  const band = el.querySelector('.band');
  // Takes over from the first line, which is leaving fast to the left: this
  // one comes in from the right, behind it, overlapping ~0.1 s, and slows to
  // land by ~2.28 s — before the TV's bar lands (~2.35 s).
  tl.fromTo(band, { x: 1000 * u }, { x: 0, duration: 0.6, ease: 'power3.out' }, 1.68);
  tl.fromTo(band, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: 'power1.out', immediateRender: false }, 1.68);
  // Gone completely before the floor sinks and the markers lift (3.40 s), so
  // nothing of it is ever cut by what comes next.
  tl.to(band, { y: -40 * u, opacity: 0, duration: 0.2, ease: 'power2.in' }, t1 - 0.55);
}
