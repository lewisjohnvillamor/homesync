/**
 * Compositions 6–8: the timing diagram, under one continuous camera.
 *
 *  6  Plan view. Three device lanes; the dot lands above them as the instant
 *     T and a line falls from it through every lane.
 *  7  The camera rushes in on the phone's lane — the phone that just joined.
 *     Its delay bar (the same bar composition 2 drew on the floor) grows back
 *     from T, and its start marker slides left by exactly the bar's length.
 *  8  The camera pulls back and tilts the whole diagram down to the model
 *     house's camera angle. The laptop's and TV's bars grow too; all three
 *     end exactly on T, which brightens. Three lanes stay three lanes. Then
 *     the plane lifts towards the camera and away, revealing the house that
 *     is waiting underneath at the same angle.
 *
 * s07 and s08 add only their lines. This module owns the picture and the dot.
 */

import { span, lerp } from '../shared/beats.js';
import { laptopSvg, tvSvg } from '../shared/devices.js';
import { diagramLayout, DELAY_MS } from '../shared/diagram.js';
import { HOUSE_VIEW } from '../shared/house-view.js';
import { phoneHtml } from './s05-join.js';

/** Up through composition 8 and the lift that reveals the house. */
export const pad = [0.2, 2 * 2.5 + 0.1];

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;
const expoOut = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));

// Composition boundaries (seconds).
const C7 = 13.125;
const C8 = 15.625;
const C9 = 18.125;
const LIFT = 17.85;

export function build({ el, u, W, H, portrait, t0, onFrame, hostDot }) {
  const L = diagramLayout(W, H, u, portrait);
  const order = ['laptop', 'phone', 'tv'];
  const label = { laptop: 'laptop', phone: 'phone', tv: 'TV' };
  const barH = 16 * u;
  const iconH = 96 * u;

  const lane = (kind) => {
    const y = L.lanes[kind];
    const icon =
      kind === 'phone'
        ? `<div class="icon" style="position:absolute;left:${L.iconX - 24 * u}px;top:${y - iconH / 2}px;width:${48 * u}px;height:${iconH}px">${phoneHtml(48 * u, iconH)}</div>`
        : `<div class="icon" style="position:absolute;left:${L.iconX - 90 * u}px;top:${y - 58 * u}px;width:${180 * u}px;height:${116 * u}px">${kind === 'laptop' ? laptopSvg() : tvSvg()}</div>`;
    const w = DELAY_MS[kind] * L.pxPerMs;
    return `
      <div class="lane lane-${kind}">
        ${icon}
        <div class="name" style="position:absolute;left:${L.iconX - 100 * u}px;width:${200 * u}px;top:${y + 60 * u}px;text-align:center;
             font:600 ${32 * u}px/1 var(--sans);color:var(--text-dim)">${label[kind]}</div>
        <div class="rule" style="position:absolute;left:${L.laneStart}px;top:${y - 2.5 * u}px;width:${L.laneEnd - L.laneStart}px;height:${5 * u}px;
             background:var(--line-strong);transform-origin:0 50%;border-radius:${2 * u}px"></div>
        <div class="tick" style="position:absolute;left:${L.tX - 3 * u}px;top:${y - 22 * u}px;width:${6 * u}px;height:${44 * u}px;border-radius:${3 * u}px;background:var(--accent)"></div>
        <div class="bar" style="position:absolute;left:${L.tX - w}px;top:${y - barH / 2}px;width:${w}px;height:${barH}px;border-radius:${barH / 2}px;
             background:var(--accent);transform-origin:100% 50%"></div>
        <div class="start" style="position:absolute;left:${L.tX - 13 * u}px;top:${y - 13 * u}px;width:${26 * u}px;height:${26 * u}px;border-radius:50%;
             background:var(--bg);border:${5 * u}px solid var(--accent);box-sizing:border-box"></div>
        <div class="ms" style="position:absolute;left:${L.tX - w}px;width:${w}px;top:${y - barH / 2 - 56 * u}px;text-align:center;
             font:500 ${34 * u}px/1 var(--mono);color:var(--text-dim);white-space:nowrap">${DELAY_MS[kind]} ms${
               kind === 'phone' ? ` <span class="ex example-tag" style="--tag-size:${16 * u}px;vertical-align:middle;margin-left:${8 * u}px">example</span>` : ''
             }</div>
      </div>`;
  };

  el.innerHTML = `
    <div class="ground" style="position:absolute;inset:0;background:var(--bg)"></div>
    <div class="line6" style="position:absolute;z-index:2;left:${portrait ? 70 * u : 128 * u}px;top:${portrait ? 150 * u : 96 * u}px;
         font:700 ${portrait ? 80 * u : 76 * u}px/1.08 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">Every device is told one instant…</div>
    <div class="persp" style="position:absolute;inset:0;perspective:${2200 * u}px;perspective-origin:50% 45%">
      <div class="world" style="position:absolute;inset:0;transform-style:preserve-3d">
        ${order.map(lane).join('')}
        <div class="tline" style="position:absolute;left:${L.tX - 2.5 * u}px;top:${L.tTop}px;width:${5 * u}px;height:${L.lanes.tv + 70 * u - L.tTop}px;
             background:var(--accent);transform-origin:50% 0;border-radius:${3 * u}px"></div>
        <div class="tlabel" style="position:absolute;left:${L.tX + 30 * u}px;top:${L.tTop - 24 * u}px;font:700 ${46 * u}px/1 var(--sans);color:var(--accent)">T</div>
        <div class="anchor" style="position:absolute;left:${L.tX - 13 * u}px;top:${L.tTop - 13 * u}px;width:${26 * u}px;height:${26 * u}px"></div>
        <div class="tag example-tag" style="position:absolute;left:${L.laneStart}px;top:${L.lanes.tv + 90 * u}px;--tag-size:${26 * u}px">example</div>
      </div>
    </div>`;

  const persp = el.querySelector('.persp');
  const line6 = el.querySelector('.line6');
  // The diagram's own ground. The house waits underneath (composition 9 sits
  // at a lower z), and is only revealed as the plane lifts away — not seen
  // through the diagram's gaps before then.
  const ground = el.querySelector('.ground');
  const world = el.querySelector('.world');
  const tline = el.querySelector('.tline');
  const tlabel = el.querySelector('.tlabel');
  const anchor = el.querySelector('.anchor');
  const tag = el.querySelector('.tag');
  const lanes = Object.fromEntries(
    order.map((kind) => {
      const root = el.querySelector(`.lane-${kind}`);
      return [kind, {
        root,
        icon: root.querySelector('.icon'),
        name: root.querySelector('.name'),
        rule: root.querySelector('.rule'),
        tick: root.querySelector('.tick'),
        bar: root.querySelector('.bar'),
        start: root.querySelector('.start'),
        ms: root.querySelector('.ms'),
        w: DELAY_MS[kind] * L.pxPerMs,
      }];
    }),
  );
  for (const svg of el.querySelectorAll('.icon svg')) svg.style.cssText = 'width:100%;height:100%;overflow:visible';

  // --- the camera --------------------------------------------------------------
  // A transform on the diagram as a function of t: plan view with a slow
  // push; a rush in on the phone lane; a pull back that tilts to the house's
  // angle; a lift away.
  const phoneFocus = { x: L.tX - lanes.phone.w / 2, y: L.lanes.phone };
  const zoomIn = portrait ? 1.9 : 2.3;
  const cam = (t) => {
    // Composition 6: plan view, slow push about the frame centre.
    let s = lerp(1, 1.03, span(t, t0, C7));
    let fx = W / 2;
    let fy = H / 2;
    let tiltX = 0;
    let rotZ = 0;
    let lift = 0;
    // Composition 7: rush in on the phone lane, landing slowly.
    const rush = expoOut(span(t, C7 - 0.05, C7 + 0.55));
    s = lerp(s, zoomIn * lerp(1, 1.025, span(t, C7 + 0.55, C8)), rush);
    fx = lerp(fx, phoneFocus.x, rush);
    fy = lerp(fy, phoneFocus.y, rush);
    // Composition 8: pull back and tilt to the house camera's angle.
    const back = easeInOut(span(t, C8 - 0.1, C8 + 0.7));
    // Tilted, the diagram foreshortens; it is scaled up to keep filling the
    // frame, centred on its lanes.
    s = lerp(s, portrait ? 1.05 : 1.08, back) * lerp(1, 1.03, span(t, C8 + 0.7, LIFT));
    // Centred on the whole diagram, icons included, so nothing is cropped.
    fx = lerp(fx, (L.iconX - 100 * u + L.laneEnd) / 2, back);
    fy = lerp(fy, (L.lanes.laptop + L.lanes.tv) / 2 + 20 * u, back);
    tiltX = lerp(0, 90 - HOUSE_VIEW.elevation, back);
    rotZ = lerp(0, -HOUSE_VIEW.azimuth * 0.35, back);
    // The lift: towards the camera and away.
    lift = easeInOut(span(t, LIFT, C9 + 0.08));
    return { s, fx, fy, tiltX, rotZ, lift };
  };

  onFrame((t) => {
    const c = cam(t);
    // Put the focus point at the frame centre, scaled; then tilt about it.
    const tx = W / 2 - c.fx * c.s;
    const ty = H / 2 - c.fy * c.s;
    world.style.transformOrigin = '0 0';
    world.style.transform =
      `translate3d(${tx}px, ${ty - c.lift * 260 * u}px, ${c.lift * 900 * u}px) ` +
      `translate(${c.fx * c.s}px, ${c.fy * c.s}px) rotateX(${c.tiltX}deg) rotateZ(${c.rotZ}deg) translate(${-c.fx * c.s}px, ${-c.fy * c.s}px) scale(${c.s})`;
    persp.style.opacity = String(1 - span(t, LIFT + 0.05, C9 + 0.1));
    ground.style.opacity = String(1 - easeInOut(span(t, LIFT, C9 + 0.02)));

    // Composition 6's line: set by 11.30 s, drifting, gone before the rush.
    const in6 = expoOut(span(t, t0 + 0.1, t0 + 0.6));
    const out6 = span(t, C7 - 0.22, C7);
    line6.style.opacity = String(in6 * (1 - out6));
    line6.style.transform = `translate(${(1 - in6) * -60 * u + span(t, t0 + 0.6, C7) * 18 * u}px, ${out6 * -40 * u}px)`;

    // --- composition 6: lanes draw in, the T line falls ---
    order.forEach((kind, i) => {
      const l = lanes[kind];
      const k = easeOut(span(t, t0 + 0.05 + i * 0.08, t0 + 0.55 + i * 0.08));
      l.rule.style.transform = `scaleX(${k})`;
      // The phone icon is composition 5's phone, which lands here at 10.78 s.
      const iconK = kind === 'phone' ? (t >= 10.78 ? 1 : 0) : easeOut(span(t, t0 + 0.1 + i * 0.08, t0 + 0.5 + i * 0.08));
      l.icon.style.opacity = String(iconK);
      l.icon.style.transform = kind === 'phone' ? '' : `translateX(${(1 - iconK) * -30 * u}px)`;
      l.name.style.opacity = String(easeOut(span(t, t0 + 0.3, t0 + 0.7)));
      l.tick.style.opacity = String(span(t, 11.25 + i * 0.04, 11.35 + i * 0.04) * (1 - span(t, C7 + 0.6, C7 + 0.8)));
      l.tick.style.transform = `scaleY(${easeOut(span(t, 11.25 + i * 0.04, 11.45 + i * 0.04))})`;
    });
    const fall = easeOut(span(t, 11.0, 11.35));
    tline.style.transform = `scaleY(${fall})`;
    tlabel.style.opacity = String(span(t, 11.05, 11.3));

    // --- compositions 7 and 8: each bar grows back from T, and its start
    // marker slides left by exactly the bar's length ---
    const grow = {
      phone: easeInOut(span(t, C7 + 0.45, C7 + 1.0)),
      laptop: easeInOut(span(t, C8 + 0.2, C8 + 0.6)),
      tv: easeInOut(span(t, C8 + 0.3, C8 + 0.85)),
    };
    for (const kind of order) {
      const l = lanes[kind];
      const g = grow[kind];
      l.bar.style.transform = `scaleX(${Math.max(0.0001, g)})`;
      l.bar.style.opacity = String(g > 0 ? 1 : 0);
      l.start.style.transform = `translateX(${-l.w * g}px)`;
      l.start.style.opacity = String(span(t, kind === 'phone' ? C7 + 0.35 : C8 + 0.1, kind === 'phone' ? C7 + 0.45 : C8 + 0.2));
      // Labels: the phone's is read in composition 7; in 8 they are small and dim.
      const msOn = span(t, kind === 'phone' ? C7 + 0.95 : C8 + 0.55, kind === 'phone' ? C7 + 1.15 : C8 + 0.75);
      l.ms.style.opacity = String(msOn * (kind === 'phone' ? lerp(1, 0.75, span(t, C8, C8 + 0.4)) : 0.75));
    }
    // In 8 the single tag covers all three bars; in 7 the phone's label
    // carries its own, because the close-up crops the diagram's corner.
    tag.style.opacity = String(span(t, C8 + 0.6, C8 + 0.8));
    // One example tag in composition 8: the phone label's own hands over.
    const ex = lanes.phone.ms.querySelector('.ex');
    if (ex) ex.style.opacity = String(1 - span(t, C8 + 0.4, C8 + 0.6));
    // The dot rides the T line down to the phone's lane for the close-up —
    // the moment the phone's sound must be heard — and back up after.
    const down = easeInOut(span(t, C7 + 0.05, C7 + 0.5)) * (1 - easeInOut(span(t, C8 + 0.1, C8 + 0.6)));
    anchor.style.transform = `translateY(${down * (L.lanes.phone - L.tTop)}px)`;
    // T brightens when all three bars are home.
    const home = span(t, C8 + 0.85, C8 + 1.05) * (1 - 0.5 * span(t, C8 + 1.3, C8 + 2.0));
    tline.style.boxShadow = `0 0 ${home * 34 * u}px ${home * 6 * u}px #5aa9ffaa`;
    // Glow only: a brightness filter pushes the accent towards cyan, and in
    // this film nothing is allowed to look like the app's "in sync" green.
  });

  // The dot is the instant T: it lands at the top of the T line and rides the
  // camera exactly, because its place is read from an element in the diagram.
  hostDot(11.0, LIFT + 0.05, () => {
    const r = anchor.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: Math.max(18 * u, (r.width + r.height) / 2), glow: 0.2 };
  });
}
