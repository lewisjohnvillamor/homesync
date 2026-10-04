/**
 * Composition 8's line, on a band: the diagram is tilting beneath it.
 */

export function build({ el, tl, u, portrait, t0, t1 }) {
  el.innerHTML = `
    <div class="band" style="left:${portrait ? 60 * u : 104 * u}px;top:${portrait ? 130 * u : 72 * u}px;padding:${20 * u}px ${30 * u}px;
         background:rgba(11,14,19,0.9)">
      <div class="line" style="font:700 ${portrait ? 72 * u : 72 * u}px/1.1 var(--sans);letter-spacing:-0.025em;color:var(--text);
           ${portrait ? `width:${900 * u}px` : 'white-space:nowrap'}">Scheduled to be heard at one agreed instant.</div>
    </div>`;
  const band = el.querySelector('.band');
  const line = el.querySelector('.line');
  // Set by 16.00 s; held while the plane drifts; leaves as the plane lifts.
  tl.fromTo(band, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' }, t0 + 0.05);
  tl.fromTo(line, { x: -60 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: 'expo.out' }, t0 + 0.05);
  tl.to(line, { x: 16 * u, duration: 17.75 - (t0 + 0.5), ease: 'none' }, t0 + 0.5);
  tl.to([band, line], { y: -40 * u, opacity: 0, duration: 0.22, ease: 'power2.in' }, 17.78);
  void t1;
}
