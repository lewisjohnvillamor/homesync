/**
 * Compositions 6–8: the timing diagram, under one continuous camera.
 *
 *  6  Plan view. Three device lanes draw in behind the phone as it shrinks
 *     into its lane icon; the dot lands above them as the instant T and a
 *     line falls from it through every lane. As T reaches each lane a marker
 *     pops there and a pulse runs back along the lane to its device, which
 *     lights: every device is told the one instant.
 *  7  The camera rushes in on the phone's lane until its bar fills the width;
 *     the phone itself stays pinned, enlarged, at the lane's left edge. Its
 *     delay bar (the bar composition 2 drew on the floor) grows back from T,
 *     counting up to 90 ms, and its start marker slides left by exactly the
 *     bar's length. Then the start marker fires and a pulse runs the bar's
 *     length, 8× slowed, arriving exactly on T.
 *  8  The camera pulls back and tilts the plane to exactly the house camera's
 *     angle (HOUSE_VIEW: elevation, and the same turn about the vertical). The
 *     laptop's bar lands, then the TV's; then every start marker fires, the
 *     longest first, and the three pulses arrive on T together, which
 *     brightens. Three lanes stay three lanes. The labels go; the plane lifts
 *     towards the camera and away, and the ground opens on the house that is
 *     waiting underneath at the same angle.
 *
 * s07 and s08 add only their lines. This module owns the picture and the dot.
 */

import { span, lerp } from '../shared/beats.js';
import { laptopSvg, tvSvg } from '../shared/devices.js';
import { DELAY_MS } from '../shared/diagram.js';
import { HOUSE_VIEW } from '../shared/house-view.js';
import { phoneHtml, roomHtml, laneLayout, joinTrack, ICON_LANDS } from './s05-join.js';

/** Up through composition 8 and the lift that reveals the house. */
export const pad = [0.2, 2 * 2.5 + 0.15];

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;
const easeIn = (k) => k * k * k;
const expoOut = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const sine = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);

// Composition boundaries (seconds).
const C7 = 13.125;
const C8 = 15.625;
const C9 = 18.125;
/**
 * The lift: the plane — lanes and its own opaque ground together, one card —
 * rises towards the camera and away over LIFT_SPAN, uncovering the house
 * that waits underneath from the bottom of the frame up. Nothing of the
 * diagram is ever seen through or over the house; it only moves off it.
 */
const LIFT = 17.85;
const LIFT_SPAN = [17.62, 18.12];
/** The dot is let go as the lift starts; the film flies it to the house's host (18.15). */
const DOT_RELEASE = LIFT_SPAN[0];

/** Composition 6: the T line falls from the dot through the lanes. */
const FALL = [11.0, 11.8];
/** Composition 7: the phone's start fires, and its pulse takes 90 ms × 8 to reach T. */
const FIRE7 = 14.3;
const RUN7 = 0.72;
/** Composition 8: the bars land one after another, then all three pulses arrive on T together. */
const GROW8 = { laptop: [15.95, 16.3], tv: [16.32, 16.95] };
const ARRIVE8 = 17.5;
const RUN8 = (kind) => (DELAY_MS[kind] / 1000) * 2.5;

export function build({ el, u, W, H, portrait, t0, onFrame, hostDot }) {
  const L = laneLayout(W, H, u, portrait);
  const track = joinTrack(W, H, u, portrait);
  const order = ['laptop', 'phone', 'tv'];
  const label = { laptop: 'laptop', phone: 'phone', tv: 'TV' };
  const barH = 18 * u;
  const ruleH = 14 * u;
  const ic = L.phoneIcon;
  const devW = 180 * u * L.iconScale;
  const devH = 116 * u * L.iconScale;

  const lane = (kind) => {
    const y = L.lanes[kind];
    const icon =
      kind === 'phone'
        ? `<div class="icon" style="position:absolute;left:${ic.x - ic.w / 2}px;top:${y - ic.h / 2}px;width:${ic.w}px;height:${ic.h}px;transform-origin:50% 50%">${phoneHtml(
            ic.w,
            ic.h,
            roomHtml(ic.w, false),
          )}</div>`
        : `<div class="icon" style="position:absolute;left:${L.iconX - devW / 2}px;top:${y - devH / 2}px;width:${devW}px;height:${devH}px;transform-origin:50% 50%">${
            kind === 'laptop' ? laptopSvg() : tvSvg()
          }</div>`;
    const w = DELAY_MS[kind] * L.pxPerMs;
    return `
      <div class="lane lane-${kind}">
        <div class="rule" style="position:absolute;left:${L.laneStart}px;top:${y - ruleH / 2}px;width:${L.laneEnd - L.laneStart}px;height:${ruleH}px;
             background:var(--text-faint);opacity:0.7;border-radius:${ruleH / 2}px"></div>
        ${icon}
        <div class="name" style="position:absolute;left:${L.laneStart + 6 * u}px;top:${y + 36 * u}px;transform-origin:0 0;
             font:600 ${32 * u}px/1 var(--sans);color:var(--text-dim);white-space:nowrap">${label[kind]}</div>
        <div class="tick" style="position:absolute;left:${L.tX - 5 * u}px;top:${y - 34 * u}px;width:${10 * u}px;height:${68 * u}px;border-radius:${5 * u}px;background:var(--accent)"></div>
        <div class="flash" style="position:absolute;left:${L.tX - 30 * u}px;top:${y - 30 * u}px;width:${60 * u}px;height:${60 * u}px;border-radius:50%;
             border:${4 * u}px solid var(--accent);box-sizing:border-box;opacity:0"></div>
        <div class="bar" style="position:absolute;left:${L.tX - w}px;top:${y - barH / 2}px;width:${w}px;height:${barH}px;border-radius:${barH / 2}px;
             background:var(--accent);transform-origin:100% 50%"></div>
        <div class="start" style="position:absolute;left:${L.tX - 15 * u}px;top:${y - 15 * u}px;width:${30 * u}px;height:${30 * u}px;border-radius:50%;
             background:var(--bg);border:${6 * u}px solid var(--accent);box-sizing:border-box"></div>
        <div class="fire" style="position:absolute;left:${L.tX - w - 15 * u}px;top:${y - 15 * u}px;width:${30 * u}px;height:${30 * u}px;border-radius:50%;
             border:${3 * u}px solid var(--accent);box-sizing:border-box;opacity:0"></div>
        <div class="pulse" style="position:absolute;left:${-22 * u}px;top:${y - 11 * u}px;width:${44 * u}px;height:${22 * u}px;border-radius:${11 * u}px;
             background:var(--text);box-shadow:0 0 ${24 * u}px ${6 * u}px #5aa9ffaa;opacity:0"></div>
        <div class="ms" style="position:absolute;left:${L.tX - w - 260 * u}px;width:${w + 234 * u}px;top:${y - barH / 2 - 54 * u}px;text-align:right;transform-origin:100% 100%;
             font:500 ${34 * u}px/1 var(--mono);color:var(--text-dim);white-space:nowrap">${DELAY_MS[kind]} ms${
               kind === 'phone' ? ` <span class="ex example-tag" style="--tag-size:${16 * u}px;vertical-align:middle;margin-left:${8 * u}px">example</span>` : ''
             }</div>
      </div>`;
  };

  // The camera: perspective matching the house camera's field of view, so
  // the tilted plane foreshortens the way the model does.
  const persp = (H / 2) / Math.tan((HOUSE_VIEW.fov / 2) * (Math.PI / 180));
  el.innerHTML = `
    <style>.scene-6 .icon svg [stroke]{stroke:var(--text-faint)}</style>
    <div class="ground" style="position:absolute;inset:0;background:var(--bg)"></div>
    <div class="line6" style="position:absolute;z-index:2;left:${portrait ? 70 * u : 128 * u}px;top:${portrait ? 150 * u : 96 * u}px;
         font:700 ${portrait ? 84 * u : 76 * u}px/1.08 var(--sans);letter-spacing:-0.025em;color:var(--text);${portrait ? `width:${940 * u}px` : 'white-space:nowrap'}">Every device is told one instant…</div>
    <div class="persp" style="position:absolute;inset:0;perspective:${persp}px;perspective-origin:50% 50%">
      <div class="world" style="position:absolute;inset:0;transform-style:preserve-3d;transform-origin:0 0">
        <div class="card" style="position:absolute;left:${-6000 * u}px;top:${-6000 * u}px;width:${12000 * u + W}px;height:${6000 * u + L.lanes.tv + 520 * u}px;
             background:linear-gradient(to bottom, var(--bg) calc(100% - ${300 * u}px), transparent)"></div>
        ${order.map(lane).join('')}
        <div class="tline" style="position:absolute;left:${L.tX - 3 * u}px;top:${L.tTop}px;width:${6 * u}px;height:${L.lanes.tv + 70 * u - L.tTop}px;
             background:var(--accent);transform-origin:50% 0;border-radius:${3 * u}px"></div>
        <div class="tlabel" style="position:absolute;left:${L.tX + 30 * u}px;top:${L.tTop - 30 * u}px;font:700 ${56 * u}px/1 var(--sans);color:var(--accent)">T</div>
        <div class="anchor" style="position:absolute;left:${L.tX - 13 * u}px;top:${L.tTop - 13 * u}px;width:${26 * u}px;height:${26 * u}px"></div>
      </div>
    </div>`;

  const perspEl = el.querySelector('.persp');
  const line6 = el.querySelector('.line6');
  // The diagram's own ground. Transparent while composition 5's phone is
  // still shrinking into its icon underneath; opaque after, so the house
  // (composition 9, at a lower z) is only revealed by the iris at the lift.
  const ground = el.querySelector('.ground');
  const world = el.querySelector('.world');
  const tline = el.querySelector('.tline');
  const tlabel = el.querySelector('.tlabel');
  const anchor = el.querySelector('.anchor');
  const card = el.querySelector('.card');
  const lanes = Object.fromEntries(
    order.map((kind) => {
      const root = el.querySelector(`.lane-${kind}`);
      const q = (c) => root.querySelector(c);
      return [kind, {
        icon: q('.icon'), name: q('.name'), rule: q('.rule'), tick: q('.tick'), flash: q('.flash'), bar: q('.bar'),
        screen: q('.screen'), start: q('.start'), fire: q('.fire'), pulse: q('.pulse'), ms: q('.ms'),
        w: DELAY_MS[kind] * L.pxPerMs,
      }];
    }),
  );
  /** When the falling T line crosses each lane. */
  const tLen = L.lanes.tv + 70 * u - L.tTop;
  const fallK = (t) => easeInOut(span(t, ...FALL));
  const REACH = Object.fromEntries(order.map((kind) => {
    const target = (L.lanes[kind] - L.tTop) / tLen;
    let lo = FALL[0];
    let hi = FALL[1];
    for (let n = 0; n < 40; n += 1) {
      const mid = (lo + hi) / 2;
      if (fallK(mid) < target) lo = mid;
      else hi = mid;
    }
    return [kind, lo];
  }));
  for (const svg of el.querySelectorAll('.icon svg')) svg.style.cssText = 'width:100%;height:100%;overflow:visible';

  // --- the camera --------------------------------------------------------------
  // World point f appears at screen point p, scaled by s, tilted by tilt and
  // turned by rot about the plane's normal.
  const elevation = portrait ? 54 : HOUSE_VIEW.elevation; // composition 9 frames 9:16 at 54°
  const barPhone = lanes.phone.w;
  const camA = (t) => {
    const k = sine(span(t, ICON_LANDS, C7));
    return { s: lerp(1, 1.05, k), fx: W / 2, fy: H * 0.55, px: W / 2 - 30 * u * k, py: H * 0.55 - 14 * u * k, tilt: 0, rot: 0 };
  };
  const camB = (t) => ({
    s: (portrait ? 720 * u : 1300 * u) / barPhone * lerp(1, 1.035, sine(span(t, C7 + 0.6, C8))),
    fx: L.tX,
    fy: L.lanes.phone,
    px: (portrait ? W - 100 * u : 1650 * u) - 24 * u * sine(span(t, C7 + 0.6, C8)),
    py: portrait ? 700 * u : 420 * u,
    tilt: 0,
    rot: 0,
  });
  const camC = (t) => {
    const k = sine(span(t, C8 + 0.6, LIFT));
    return {
      s: (portrait ? 1.22 : 1.2) * lerp(1, 1.045, k),
      fx: (L.iconX - devW / 2 + L.laneEnd) / 2,
      fy: (L.lanes.laptop + L.lanes.tv) / 2,
      px: W / 2 + (portrait ? 0 : 10 * u) + 30 * u * k,
      py: (portrait ? H * 0.4 : H * 0.44) + 10 * u * k,
      tilt: 90 - elevation,
      rot: HOUSE_VIEW.azimuth,
    };
  };
  const mix = (a, b, k) => {
    const out = {};
    for (const key of Object.keys(a)) out[key] = key === 's' ? a.s * (b.s / a.s) ** k : lerp(a[key], b[key], k);
    return out;
  };
  // The camera starts leaning in on the phone lane from 12.35 s, then rushes in on the cut.
  const rushK = (t) => Math.max(0.1 * easeIn(span(t, 12.35, C7)), expoOut(span(t, C7 - 0.05, C7 + 0.6)));
  // The pull back leaves fast and lands slowly.
  const backK = (t) => {
    const k = span(t, C8 - 0.1, C8 + 1.1);
    return k < 0.12 ? easeIn(k / 0.12) * 0.12 * 0.5 : 0.06 + 0.94 * (1 - (1 - (k - 0.12) / 0.88) ** 4);
  };
  const cam = (t) => mix(mix(camA(t), camB(t), rushK(t)), camC(t), backK(t));

  /**
   * Pin an element to a place on screen while the camera is flat, blending
   * out with weight 0: world anchor (ax, ay) is drawn at screen (sx, sy) at
   * on-screen scale `scr`.
   */
  const pin = (elx, c, c6, ax, ay, sx, sy, scr, w) => {
    if (w <= 0) {
      elx.style.transform = '';
      return;
    }
    // Blend on screen, never further left than where it sat in composition 6.
    const ux = c.px + (ax - c.fx) * c.s;
    const uy = c.py + (ay - c.fy) * c.s;
    const u6 = c6.px + (ax - c6.fx) * c6.s;
    const x = Math.max(lerp(ux, sx, w), lerp(u6, sx, w));
    const y = lerp(uy, sy, w);
    const k = lerp(c.s, scr, w) / c.s;
    const wx = c.fx + (x - c.px) / c.s;
    const wy = c.fy + (y - c.py) / c.s;
    elx.style.transform = `translate(${wx - ax}px, ${wy - ay}px) scale(${k})`;
  };

  onFrame((t) => {
    const c = cam(t);
    // The lift: towards the camera and up, fast.
    // It starts a beat of frames before LIFT, so it is visibly moving (and
    // ≥ 1.3× larger) before it goes; it is gone by LIFT + 0.14.
    const lk = easeIn(span(t, ...LIFT_SPAN));
    world.style.transform =
      `translate3d(0, ${-lk * 1.7 * H}px, ${lk * 0.25 * persp}px) ` +
      `translate(${c.px}px, ${c.py}px) rotateX(${c.tilt}deg) rotateZ(${c.rot}deg) scale(${c.s}) translate(${-c.fx}px, ${-c.fy}px)`;
    // The flat ground covers the frame until the plane's own card takes over
    // for the lift; after the lift nothing of this layer is left.
    ground.style.opacity = t >= ICON_LANDS && t < LIFT_SPAN[0] ? '1' : '0';
    card.style.opacity = t >= ICON_LANDS ? '1' : '0';
    perspEl.style.visibility = t < LIFT_SPAN[1] + 0.02 ? 'visible' : 'hidden';
    // While composition 5's phone shrinks into its icon, the lanes draw in
    // behind it: nothing of the diagram is drawn left of the phone's edge.
    if (t < ICON_LANDS - 0.04) {
      const r = track.phoneRect(t);
      perspEl.style.clipPath = `inset(0 0 0 ${Math.max(0, r.x + track.phoneW * r.s + 14 * u)}px)`;
    } else perspEl.style.clipPath = 'none';

    // Composition 6's line: set by 11.30 s, drifting, gone before the rush.
    const in6 = expoOut(span(t, t0 + 0.1, t0 + 0.6));
    const out6 = span(t, C7 - 0.22, C7);
    line6.style.opacity = String(in6 * (1 - out6));
    line6.style.transform = `translate(${(1 - in6) * -60 * u + sine(span(t, t0 + 0.6, C7)) * 40 * u}px, ${out6 * -40 * u}px)`;

    // --- composition 6: icons, T falls, each lane is told ---
    const rush = rushK(t);
    const back = backK(t);
    order.forEach((kind, i) => {
      const l = lanes[kind];
      // The phone icon is composition 5's phone, which lands here at ICON_LANDS.
      const iconK = kind === 'phone' ? (t >= ICON_LANDS ? 1 : 0) : easeOut(span(t, ICON_LANDS - 0.05 + i * 0.06, ICON_LANDS + 0.3 + i * 0.06));
      l.icon.style.opacity = String(iconK);
      const reach = REACH[kind];
      // The device lights the moment T crosses its lane, and stays lit, dimming a little.
      const lit = easeOut(span(t, reach, reach + 0.18)) * (1 - 0.45 * sine(span(t, reach + 0.3, C7)));
      // The device lights as its pulse arrives: a glow and a small lift.
      const glowPx = (6 + 22 * lit) * u;
      const glow = lit > 0 ? `drop-shadow(0 0 ${glowPx}px rgba(90,169,255,${0.25 + 0.55 * lit}))` : 'none';
      l.icon.style.filter = glow;
      // Its screen comes up as it is told.
      if (l.screen) {
        l.screen.style.fill = lit > 0 ? 'var(--accent)' : '';
        l.screen.style.fillOpacity = lit > 0 ? String(0.12 + 0.3 * lit) : '';
      }
      if (kind !== 'phone') l.icon.style.transform = `translateX(${(1 - iconK) * -30 * u}px) scale(${1 + 0.06 * lit})`;
      l.name.style.opacity = String(easeOut(span(t, ICON_LANDS - 0.1, ICON_LANDS + 0.3)));
      l.name.style.color = lit > 0.5 ? 'var(--text)' : 'var(--text-dim)';
      // A tick and a ring flash where T crosses the lane — on the line, never travelling along it.
      const tk = span(t, reach, reach + 0.18);
      l.tick.style.opacity = String((tk > 0 ? 1 : 0) * (1 - span(t, C7 + 0.3, C7 + 0.5)));
      l.tick.style.transform = `scaleY(${easeOut(tk) * (1 + 0.5 * Math.sin(Math.PI * tk))})`;
      const fl = span(t, reach, reach + 0.45);
      l.flash.style.opacity = String(fl > 0 && fl < 1 ? 0.9 * (1 - fl) : 0);
      l.flash.style.transform = `scale(${0.4 + 1.4 * easeOut(fl)})`;
      let px = 0;
      let pOp = 0;

      // --- compositions 7 and 8: the bar grows back from T; its start marker
      // slides left by exactly the bar's length; its value fades in as it lands ---
      const grow = kind === 'phone' ? easeInOut(span(t, C7 + 0.45, C7 + 1.0)) : easeInOut(span(t, ...GROW8[kind]));
      l.bar.style.transform = `scaleX(${Math.max(0.0001, grow)})`;
      l.bar.style.opacity = String(grow > 0 ? 1 : 0);
      l.start.style.transform = `translateX(${-l.w * grow}px)`;
      const startOn = kind === 'phone' ? C7 + 0.35 : GROW8[kind][0] - 0.1;
      l.start.style.opacity = String(span(t, startOn, startOn + 0.1));
      const landed = kind === 'phone' ? C7 + 1.0 : GROW8[kind][1];
      const msOn = easeOut(span(t, landed - 0.12, landed + 0.12));
      // Tilted, the labels foreshorten; they grow so they read at ≥ 24 px.
      l.ms.style.transform = `scale(${lerp(1, 1.5, back)})`;
      // Gone before the plane lifts, so no label is ever seen over the house.
      l.ms.style.opacity = String(msOn * (1 - span(t, LIFT - 0.32, LIFT - 0.14)));

      // The start fires, and a pulse runs the bar's length to T.
      const fireAt = kind === 'phone' && t < C8 ? FIRE7 : ARRIVE8 - RUN8(kind);
      const run = kind === 'phone' && t < C8 ? RUN7 : RUN8(kind);
      const fk = span(t, fireAt, fireAt + 0.4);
      l.fire.style.opacity = String(fk > 0 && fk < 1 ? 0.9 * (1 - fk) : 0);
      l.fire.style.transform = `scale(${1 + (t < C8 ? 0.9 : 1.1) * easeOut(fk)})`;
      const rk = span(t, fireAt, fireAt + run);
      if (rk > 0 && rk < 1 && grow > 0.99) {
        px = lerp(L.tX - l.w, L.tX, easeInOut(rk));
        pOp = 1;
      }
      l.pulse.style.opacity = String(pOp * (1 - span(t, LIFT - 0.2, LIFT)));
      l.pulse.style.transform = `translateX(${px}px)`;

      // In composition 7 the phone stays in shot, pinned enlarged at the lane's left edge.
      if (kind === 'phone') {
        const wPin = rush * (1 - back);
        const iconScreenH = portrait ? 220 * u : 240 * u;
        const iconScr = iconScreenH / ic.h;
        const sx = portrait ? 90 * u : 140 * u;
        const c6 = camA(t);
        pin(l.icon, c, c6, ic.x, L.lanes.phone, sx, c.py, iconScr, wPin);
        // Its name sits under it, clear of the lane and the start marker.
        pin(l.name, c, c6, L.laneStart + 6 * u, L.lanes.phone + 36 * u, sx - 50 * u, c.py + iconScreenH / 2 + 16 * u, portrait ? 1.3 : 1.35, wPin);
      }
      void i;
    });
    tline.style.transform = `scaleY(${fallK(t)})`;
    tlabel.style.opacity = String(span(t, 11.05, 11.3));

    // One example tag, always beside the phone's 90 ms, in 7 and 8.
    // The dot rides the T line down to the phone's lane for the close-up —
    // where the phone's sound must be heard — and back up after.
    const down = easeInOut(span(t, C7 + 0.05, C7 + 0.5)) * (1 - easeInOut(span(t, C8 + 0.1, C8 + 0.6)));
    anchor.style.transform = `translateY(${down * (L.lanes.phone - L.tTop)}px)`;
    // T flashes when a pulse arrives on it: the phone's in 7, all three together in 8.
    const flash = (at) => (t >= at ? Math.exp(-(t - at) * 4) : 0);
    const home = Math.max(flash(FIRE7 + RUN7), flash(ARRIVE8), 0.35 * span(t, GROW8.tv[1], GROW8.tv[1] + 0.2));
    tline.style.boxShadow = `0 0 ${home * 34 * u}px ${home * 6 * u}px #5aa9ffaa`;
  });

  // The dot is the instant T: it lands at the top of the T line and rides the
  // camera exactly, because its place is read from an element in the diagram.
  hostDot(11.0, DOT_RELEASE, (t) => {
    const r = anchor.getBoundingClientRect();
    const pulse = Math.max(t >= FIRE7 + RUN7 ? Math.exp(-(t - FIRE7 - RUN7) * 5) : 0, t >= ARRIVE8 ? Math.exp(-(t - ARRIVE8) * 5) : 0);
    const d = Math.min(46 * u, Math.max(24 * u, (r.width + r.height) / 2));
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: d * (1 + 0.35 * pulse), glow: 0.2 + 0.6 * pulse };
  });
}
