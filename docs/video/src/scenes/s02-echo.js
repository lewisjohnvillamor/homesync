/**
 * Composition 2's line. The picture is s01's camera, risen over the floor.
 */

/** On screen from 1.675 s, so it can chase the first line out. */
export const pad = [0.2, 0];

export function build({ el, tl, u, portrait, t1 }) {
  el.innerHTML = `
    <div class="band echo-band" style="opacity:0;${portrait ? `left:${60 * u}px;top:${170 * u}px` : `left:${96 * u}px;bottom:${72 * u}px`};
         padding:${22 * u}px ${32 * u}px;background:rgba(11,14,19,0.86)">
      <div class="line" style="font:700 ${portrait ? 84 * u : 80 * u}px/1.05 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">…and you still<br>get an echo.</div>
    </div>`;
  const band = el.querySelector('.band');
  // Takes over from the first line, which is leaving fast to the left: this
  // one comes in from the right, behind it, overlapping ~0.05 s, and slows to
  // land by ~2.28 s — before the TV's bar lands (~2.35 s).
  // 16:9: it starts no further right than the laptop's bar ends and well
  // left of the phone's bar, below both, so on its way in it never passes
  // under or over a bar, a marker or a tag (checked every frame).
  const from = portrait ? 1000 * u : 640 * u;
  const at = portrait ? 1.68 : 1.725;
  tl.fromTo(band, { x: from }, { x: 0, duration: 2.28 - at, ease: 'power3.out' }, at);
  tl.fromTo(band, { opacity: 0 }, { opacity: 1, duration: 0.08, ease: 'power1.out', immediateRender: false }, at);
  // Gone completely before the floor sinks and the markers lift (3.40 s), so
  // nothing of it is ever cut by what comes next.
  tl.to(band, { y: -40 * u, opacity: 0, duration: 0.2, ease: 'power2.in' }, t1 - 0.55);
}
