/**
 * Compositions 6–8: the timing diagram, under one continuous camera.
 *
 *  6  Plan view, centred, lanes ending just past T. Three device lanes draw
 *     in behind the phone as it shrinks into its lane icon; the dot lands
 *     above them as the instant T and a line falls from it through every
 *     lane. Where it crosses each lane a tick and a ring flash, and that
 *     device lights: every device is told the one instant. Nothing travels
 *     along a lane here — the lanes are time, not distance. From 12.35 s the
 *     camera leans in on the phone's lane.
 *  7  The camera rushes in on the phone's lane until its bar fills the width;
 *     the phone itself stays pinned, enlarged, at the lane's left edge. Its
 *     delay bar (the bar composition 2 drew on the floor) grows back from T
 *     and its start marker slides left by exactly the bar's length; "90 ms"
 *     fades in as it lands (only the facts.md values are ever shown). Then
 *     the start marker fires and a pulse runs the bar's length, 8× slowed,
 *     arriving exactly on T.
 *  8  The camera pulls back fast and lands slowly, tilting the plane to
 *     exactly the house camera's angle (HOUSE_VIEW: elevation, and the same
 *     turn about the vertical). The laptop's bar lands, then the TV's; then
 *     every start marker fires, the longest first, and the three pulses
 *     arrive on T together. Three lanes stay three lanes. The labels go; the
 *     plane — lanes and its own opaque ground, one card — lifts towards the
 *     camera and away, uncovering the house waiting underneath at the same
 *     angle, while the dot is let go and flies down to its place over it.
 *
 * s07 and s08 add only their lines. This module owns the picture and the dot.
 */

import { span, lerp } from '../shared/beats.js';
import { laptopSvg, tvSvg } from '../shared/devices.js';
import { DELAY_MS } from '../shared/diagram.js';
import { HOUSE_VIEW, HOUSE_VIEW_PORTRAIT } from '../shared/house-view.js';
import { handoff } from '../shared/handoff.js';
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
const LIFT_SPAN = [17.72, 17.95];
/**
 * The dot stays where T was as the plane drops away beneath it (everything of
 * the diagram moves away from it, nothing crosses it), then is let go and the
 * film flies it into the house's host (17.95).
 */
const DOT_RELEASE = 17.9;

/** Composition 6: the T line falls from the dot through the lanes. */
const FALL = [11.0, 11.8];
/** Composition 7: the phone's start fires, and its pulse takes 90 ms × 8 to reach T. */
const FIRE7 = 14.3;
const RUN7 = 0.72;
/** Composition 8: the bars land one after another, then all three pulses arrive on T together. */
const GROW8 = { laptop: [15.95, 16.3], tv: [16.32, 16.95] };
const ARRIVE8 = 17.5;
const RUN8 = (kind) => (DELAY_MS[kind] / 1000) * 2.5;
/** The pull back from the close-up starts just after the phone's pulse lands on T. */
const BACK0 = 15.3;
/** In composition 6's hold each device acknowledges T in turn. */
/** In composition 6's hold all three devices acknowledge T together — one instant, never one after another. */
const ACK = 12.1;

export function build({ el, u, W, H, portrait, t0, onFrame, hostDot, waitFor }) {
  const L = laneLayout(W, H, u, portrait);
  const track = joinTrack(W, H, u, portrait);
  const order = ['laptop', 'phone', 'tv'];
  const label = { laptop: 'laptop', phone: 'phone', tv: 'TV' };
  const barH = 18 * u;
  const ruleH = 14 * u;
  /** How far the lift card reaches above T: just past the top of the frame in composition 8. */
  // Just above T: the house is never above the diagram, so the edge sits on plain ground at the start.
  const CARD_TOP = 140 * u;
  const ic = L.phoneIcon;
  const devW = 180 * u * L.iconScale;
  const devH = 116 * u * L.iconScale;

  /**
   * Each device's name sits under its lane, set in from the lane's start so
   * it is well clear of the TV's start marker (the longest bar starts near
   * the lane's start) and of the icon.
   */
  const NAME_X = L.laneStart + 12 * u;
  // Above the lane, like its ms label, so a name and its delay share one side of one lane.
  const nameY = (kind) => L.lanes[kind] - 52 * u;
  const ackD = devW * 0.72;
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
        <div class="ackring" style="position:absolute;left:${L.iconX - ackD / 2}px;top:${y - ackD / 2}px;width:${ackD}px;height:${ackD}px;border-radius:50%;
             border:${5 * u}px solid var(--accent);box-sizing:border-box;opacity:0"></div>
        <div class="name" style="position:absolute;left:${NAME_X}px;top:${nameY(kind)}px;transform-origin:0 100%;
             font:600 ${30 * u}px/1 var(--sans);color:var(--text-dim);white-space:nowrap">${label[kind]}</div>
        <div class="tick" style="position:absolute;left:${L.tX - 5 * u}px;top:${y - 34 * u}px;width:${10 * u}px;height:${68 * u}px;border-radius:${5 * u}px;background:var(--accent)"></div>
        <div class="flash" style="position:absolute;left:${L.tX - 30 * u}px;top:${y - 30 * u}px;width:${60 * u}px;height:${60 * u}px;border-radius:50%;
             border:${4 * u}px solid var(--accent);box-sizing:border-box;opacity:0"></div>
        <div class="bar" style="position:absolute;left:${L.tX - w}px;top:${y - barH / 2}px;width:${w}px;height:${barH}px;border-radius:${barH / 2}px;
             background:var(--accent);transform-origin:100% 50%"></div>
        <div class="pulse" style="position:absolute;left:${L.tX - w}px;top:${y - barH / 2}px;width:${w}px;height:${barH}px;border-radius:${barH / 2}px;
             background:var(--text);transform-origin:0 50%;opacity:0"></div>
        <div class="start" style="position:absolute;left:${L.tX - 15 * u}px;top:${y - 15 * u}px;width:${30 * u}px;height:${30 * u}px;border-radius:50%;
             background:var(--bg);border:${6 * u}px solid var(--accent);box-sizing:border-box"></div>
        <div class="fire" style="position:absolute;left:${L.tX - w - 15 * u}px;top:${y - 15 * u}px;width:${30 * u}px;height:${30 * u}px;border-radius:50%;
             border:${3 * u}px solid var(--accent);box-sizing:border-box;opacity:0"></div>
        <div class="ms" style="position:absolute;left:${L.tX - w - 260 * u}px;width:${w + 234 * u}px;top:${y - barH / 2 - 54 * u}px;text-align:right;transform-origin:100% 100%;
             font:500 ${34 * u}px/1 var(--mono);color:var(--text-dim);white-space:nowrap">${DELAY_MS[kind]} ms <span class="ex example-tag" style="--tag-size:calc(${16 * u}px * var(--tag, 1));vertical-align:middle;margin-left:${8 * u}px">example</span></div>
      </div>`;
  };

  // The camera: perspective matching the house camera's field of view, so
  // the tilted plane foreshortens the way the model does.
  const persp = (H / 2) / Math.tan((HOUSE_VIEW.fov / 2) * (Math.PI / 180));
  el.innerHTML = `
    <style>.scene-6 .icon svg [stroke]{stroke:var(--text-faint)}</style>
    <div class="ground" style="position:absolute;inset:0;background:var(--bg)"></div>
    <div class="line6" style="position:absolute;z-index:2;left:${portrait ? 70 * u : 128 * u}px;top:${portrait ? 150 * u : 96 * u}px;
         font:700 ${portrait ? 84 * u : 76 * u}px/1.08 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">${portrait ? 'Every device is told<br>one instant…' : 'Every device is told one instant…'}</div>
    <div class="persp" style="position:absolute;inset:0;perspective:${persp}px;perspective-origin:50% 50%">
      <div class="world" style="position:absolute;inset:0;transform-style:preserve-3d;transform-origin:0 0">
        <div class="card" style="position:absolute;left:${-2600 * u}px;top:${L.tTop - CARD_TOP}px;width:${5200 * u + W}px;height:${CARD_TOP + 2600 * u}px;display:none;
             background:linear-gradient(to bottom, transparent, var(--bg) ${240 * u}px)"></div>
        ${order.map(lane).join('')}
        <div class="tline" style="position:absolute;left:${L.tX - 3 * u}px;top:${L.tTop}px;width:${6 * u}px;height:${L.lanes.tv + 70 * u - L.tTop}px;
             background:var(--accent);transform-origin:50% 0;border-radius:${3 * u}px"></div>
        <div class="tlabel" style="position:absolute;left:${L.tX + 30 * u}px;top:${L.tTop - 30 * u}px;transform-origin:${-30 * u}px ${30 * u}px;font:700 ${56 * u}px/1 var(--sans);color:var(--accent)">T</div>
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
        icon: q('.icon'), ackring: q('.ackring'), name: q('.name'), rule: q('.rule'), tick: q('.tick'), flash: q('.flash'), bar: q('.bar'),
        screen: q('.screen'), start: q('.start'), fire: q('.fire'), pulse: q('.pulse'), ms: q('.ms'),
        w: DELAY_MS[kind] * L.pxPerMs,
      }];
    }),
  );
  /** When the falling T line crosses each lane. */
  const tLen = L.lanes.tv + 70 * u - L.tTop;
  const fallK = (t) => easeOut(span(t, ...FALL));
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
  // The house camera this plane must match: 9:16 turns the model so its long side runs up the frame.
  const VIEW = portrait ? HOUSE_VIEW_PORTRAIT : HOUSE_VIEW;
  const elevation = VIEW.elevation;
  const barPhone = lanes.phone.w;
  const camA = (t) => {
    const k = sine(span(t, ICON_LANDS, C7));
    // 9:16 drifts up, not left, so the icons keep their margin.
    return { s: lerp(1, portrait ? 1.025 : 1.08, k), fx: W / 2, fy: H * 0.55, px: W / 2 - (portrait ? 0 : 30) * u * k, py: H * 0.55 - (portrait ? 30 : 14) * u * k, tilt: 0, rot: 0 };
  };
  const camB = (t) => ({
    s: (portrait ? 520 * u : 1300 * u) / barPhone * lerp(1, 1.035, sine(span(t, C7 + 0.6, C8))),
    fx: L.tX,
    fy: L.lanes.phone,
    px: (portrait ? W - 170 * u : 1650 * u) - 24 * u * sine(span(t, C7 + 0.6, C8)),
    py: portrait ? 900 * u : 470 * u,
    tilt: 0,
    rot: 0,
  });
  const camC = (t) => {
    const k = sine(span(t, C8 + 0.6, LIFT));
    return {
      // 9:16 pushes harder through the hold (5 %), so it never reads as paused.
      s: (portrait ? 0.74 : 1.2) * lerp(1, portrait ? 1.05 : 1.04, k),
      fx: (L.iconX - devW / 2 + L.laneEnd) / 2,
      fy: (L.lanes.laptop + L.lanes.tv) / 2,
      px: W / 2 + (portrait ? 2 * u : 10 * u) + (portrait ? 0 : 30) * u * k,
      py: (portrait ? H * 0.41 : H * 0.44) + 10 * u * k,
      tilt: 90 - elevation,
      // 9:16: the house's turn (−70°) would stand the lanes on end, so the plane
      // is held at −30° (lanes within ~25° of horizontal) and turns to the
      // house's angle just before the lift (17.5–17.8).
      rot: portrait ? PORTRAIT_ROT : VIEW.azimuth,
    };
  };
  const PORTRAIT_ROT = -30;
  const mix = (a, b, k) => {
    const out = {};
    for (const key of Object.keys(a)) out[key] = key === 's' ? a.s * (b.s / a.s) ** k : lerp(a[key], b[key], k);
    return out;
  };
  // The camera starts leaning in on the phone lane from 11.9 s, then rushes in on the cut.
  const RUSH = [12.88, 13.42];
  const rushK = (t) => {
    const k = span(t, ...RUSH);
    // Accelerates in, then settles slowly: an ease-in-out with its arrival stretched.
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2;
    // 9:16 has no lean (it would push the icons off the left edge); the hold has its acknowledge instead.
    return Math.max((portrait ? 0 : 0.07) * (span(t, 11.45, RUSH[0]) ** 1.2), k > 0 ? e : 0);
  };
  // The pull back leaves fast and lands slowly.
  const backK = (t) => {
    const k = span(t, BACK0, C8 + 1.1);
    return k < 0.12 ? easeIn(k / 0.12) * 0.12 * 0.5 : 0.06 + 0.94 * (1 - (1 - (k - 0.12) / 0.88) ** 4);
  };
  /** The same view as `c`, re-expressed as a zoom about world point (x, y): so a mix zooms about it and it travels straight. */
  const about = (c, x, y) => ({ ...c, fx: x, fy: y, px: c.px + (x - c.fx) * c.s, py: c.py + (y - c.fy) * c.s });
  // The rush zooms about T on the phone lane, so T (and its label) travel in a straight line and never leave the frame.
  // The pull back zooms out first and turns/tilts after, so the bar's end, T
  // and the laptop stay inside the frame through it.
  const mixBack = (a, b, k) => {
    const out = mix(a, b, k);
    const ks = Math.min(1, k * 2.4);
    out.s = a.s * (b.s / a.s) ** ks;
    return out;
  };
  const cam = (t) => mixBack(mix(about(camA(t), L.tX, L.lanes.phone), camB(t), rushK(t)), camC(t), backK(t));

  /**
   * Pin an element to a place on screen while the camera is flat, blending
   * out with weight 0: world anchor (ax, ay) is drawn at screen (sx, sy) at
   * on-screen scale `scr`.
   */
  const pin = (elx, c, c6, ax, ay, sx, sy, scr, w, pop = 1) => {
    if (w <= 0) {
      elx.style.transform = pop !== 1 ? `scale(${pop})` : '';
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
    elx.style.transform = `translate(${wx - ax}px, ${wy - ay}px) scale(${k * pop})`;
  };

  /** Where the dot (T) sits once the camera is frozen for the lift; set each frame, the same value from LIFT_SPAN[0] on. */
  let restDot = null;

  const frame = (t) => {
    // The camera holds still for the lift, so the lift alone moves the plane.
    const c = cam(Math.min(t, LIFT_SPAN[0]));
    world.style.transform =
      `translate(${c.px}px, ${c.py}px) rotateX(${c.tilt}deg) rotateZ(${c.rot}deg) scale(${c.s}) translate(${-c.fx}px, ${-c.fy}px)`;
    // The flat ground covers the frame until the plane's own card takes over
    // for the lift; after the lift nothing of this layer is left.
    // The ground fades fast as the plane lifts, onto the lit house underneath (no mask, no wipe).
    ground.style.opacity = t >= ICON_LANDS ? String(1 - sine(span(t, LIFT_SPAN[0] + 0.02, LIFT_SPAN[0] + 0.14))) : '0';
    // Only drawn for the lift (it is large; the flat ground covers the frame before).
    card.style.display = 'none';
    // '' (inherit), never 'visible': an explicit 'visible' would show through the layer while the film hides it.
    perspEl.style.visibility = t < LIFT_SPAN[1] + 0.02 ? '' : 'hidden';
    // The lift: the plane — its own opaque card under the lanes — grows
    // (≥ 2×) about the point where T is and falls away down the frame
    // towards the camera, uncovering the house from the top down. Every part
    // of the diagram moves away from the dot, so nothing crosses it.
    perspEl.style.transform = 'none';
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
    line6.style.transform = `translate(${(1 - in6) * -260 * u + sine(span(t, t0 + 0.6, C7)) * 40 * u}px, ${out6 * -40 * u}px)`;

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
      // In the hold each device answers in turn: it pops, its screen floods, a ring opens round it.
      // No rings here: in this film an expanding ring means a sound starting.
      const ackK = span(t, ACK, ACK + 0.8);
      const ack = Math.sin(Math.PI * Math.min(1, ackK * 1.5));
      l.ackring.style.opacity = '0';
      const lit = Math.min(1, easeOut(span(t, reach, reach + 0.18)) * (1 - 0.45 * sine(span(t, reach + 0.3, C7))) + 0.8 * ack);
      // The device lights as its pulse arrives: a glow and a small lift.
      const glowPx = (6 + 22 * lit) * u;
      const glow = lit > 0 ? `drop-shadow(0 0 ${glowPx}px rgba(90,169,255,${0.25 + 0.55 * lit}))` : 'none';
      l.icon.style.filter = glow;
      // Its screen comes up as it is told.
      if (l.screen) {
        l.screen.style.fill = lit > 0 ? 'var(--accent)' : '';
        l.screen.style.fillOpacity = lit > 0 ? String(0.12 + 0.3 * lit + 0.35 * ack) : '';
      }
      if (kind !== 'phone') l.icon.style.transform = `translateX(${(1 - iconK) * -30 * u}px) scale(${1 + 0.06 * lit + (portrait ? 0.08 : 0.16) * ack})`;
      // The other lanes' names step aside during the close-up, so no word is ever cut by the frame edge.
      const aside = kind === 'phone' ? 0 : easeInOut(span(rush, 0.05, 0.6)) * (1 - easeInOut(span(back, 0.25, 0.75)));
      // The phone's name dips out while the camera rushes in and returns under the pinned icon.
      const dip = kind === 'phone' ? Math.sin(Math.PI * span(rush, 0.05, 0.9)) * (1 - back) : 0;
      l.name.style.opacity = String(easeOut(span(t, ICON_LANDS - 0.1, ICON_LANDS + 0.3)) * (1 - aside) * (1 - dip) * (1 - span(t, 17.32, 17.5)));
      l.rule.style.opacity = String((0.7 + 0.3 * ack) * (1 - aside));
      l.rule.style.background = ack > 0.01 ? `color-mix(in srgb, var(--accent) ${Math.round(55 * ack)}%, var(--text-faint))` : 'var(--text-faint)';
      // 9:16, tilted: the lanes stop just past T, so nothing runs to the frame's edge.
      const trimTo = (L.tX + 16 * u - L.laneStart) / (L.laneEnd - L.laneStart);
      l.rule.style.transformOrigin = '0 50%';
      l.rule.style.transform = portrait ? `scaleX(${lerp(1, trimTo, back)})` : '';
      l.name.style.color = lit > 0.5 ? 'var(--text)' : 'var(--text-dim)';
      // A tick and a ring flash where T crosses the lane — on the line, never travelling along it.
      const tk = span(t, reach, reach + 0.18);
      l.tick.style.opacity = String((tk > 0 ? 1 : 0) * (1 - span(t, C7 + 0.3, C7 + 0.5)));
      l.tick.style.transform = `scaleY(${easeOut(tk) * (1 + 0.5 * Math.sin(Math.PI * tk) + 0.35 * ack)})`;
      const tickGlow = Math.max(Math.sin(Math.PI * tk), ack);
      l.tick.style.boxShadow = tickGlow > 0 ? `0 0 ${18 * u * tickGlow}px ${4 * u * tickGlow}px #5aa9ffaa` : 'none';
      // Rings on T: as T reaches the lane (6), and — for the phone — as its pulse lands on T (7), bigger.
      const fl = span(t, reach, reach + 0.45);
      const fl7 = kind === 'phone' ? span(t, FIRE7 + RUN7, FIRE7 + RUN7 + 0.5) : 0;
      if (fl7 > 0 && fl7 < 1) {
        l.flash.style.opacity = String(1 - fl7);
        // Sized for the close-up: ≤ ~170 px across on screen, clear of the label above.
        l.flash.style.transform = `scale(${0.25 + 0.55 * easeOut(fl7)})`;
      } else {
        l.flash.style.opacity = '0';
        void fl;
      }

      // --- compositions 7 and 8: the bar grows back from T; its start marker
      // slides left by exactly the bar's length; its value fades in as it lands ---
      const grow = kind === 'phone' ? easeInOut(span(t, C7 + 0.45, C7 + 1.0)) : easeInOut(span(t, ...GROW8[kind]));
      l.bar.style.transform = `scaleX(${Math.max(0.0001, grow)})`;
      l.bar.style.opacity = String(grow > 0 ? 1 : 0);
      // The start marker is never seen at T: it appears out at the bar's far end
      // as the bar reaches the device's own start, and pops in there.
      const pop = span(grow, 0.82, 1);
      l.start.style.transform = `translateX(${-l.w * grow}px) scale(${pop > 0 ? 0.4 + 0.6 * easeOut(pop) + 0.25 * Math.sin(Math.PI * pop) : 0.0001})`;
      l.start.style.opacity = String(pop > 0 ? 1 : 0);
      const landed = kind === 'phone' ? C7 + 1.0 : GROW8[kind][1];
      // The value comes in with its bar and holds (facts.md values only).
      const growFrom = kind === 'phone' ? C7 + 0.45 : GROW8[kind][0];
      const msOn = easeOut(span(t, growFrom, growFrom + 0.2));
      void landed;
      // Tags grow in composition 8, where they are seen small and tilted.
      l.ms.style.setProperty('--tag', String(lerp(1, 1.45, back)));
      // Tilted, the labels foreshorten; they grow so they read at ≥ 24 px.
      // 9:16 labels are counter-turned so they read screen-horizontal on the turned plane.
      l.ms.style.transform = `translate(${-24 * u * back}px, ${-22 * u * back}px) scale(${lerp(1, 1.5, back)})${portrait ? ` rotate(${-c.rot}deg)` : ''}`;
      // Gone before the plane lifts, so no label is ever seen over the house.
      l.ms.style.opacity = String(msOn * (1 - span(t, 17.32, 17.5)));

      // The start fires, and the bar fills from the device's start to T —
      // the bar itself lighting up, never a separate object travelling.
      const fireAt = kind === 'phone' && t < C8 ? FIRE7 : ARRIVE8 - RUN8(kind);
      const run = kind === 'phone' && t < C8 ? RUN7 : RUN8(kind);
      const fk = span(t, fireAt, fireAt + 0.4);
      l.fire.style.opacity = String(fk > 0 && fk < 1 ? 0.9 * (1 - fk) : 0);
      l.fire.style.transform = `scale(${1 + (t < C8 ? 0.9 : 1.1) * easeOut(fk)})`;
      const rk = span(t, fireAt, fireAt + run);
      // Once only: the phone's bar in the close-up. In 8, T brightening is the result.
      const fillOn = t < C8 && rk > 0 && grow > 0.99 ? 1 - span(t, fireAt + run + 0.05, fireAt + run + 0.35) : 0;
      l.pulse.style.opacity = String(0.85 * fillOn * (1 - span(t, LIFT_SPAN[0] - 0.2, LIFT_SPAN[0])));
      l.pulse.style.transform = `scaleX(${Math.max(0.0001, easeInOut(rk))})`;

      // In composition 7 the phone stays in shot, pinned enlarged at the lane's left edge.
      if (kind === 'phone') {
        const wPin = rush * (1 - back);
        const iconScreenH = portrait ? 380 * u : 400 * u;
        const iconScr = iconScreenH / ic.h;
        const sx = portrait ? 165 * u : 140 * u;
        const c6 = camA(t);
        const iy = c.py;
        pin(l.icon, c, c6, ic.x, L.lanes.phone, sx, iy, iconScr, wPin, 1 + 0.16 * ack);
        // Its name sits under it.
        const ns = portrait ? 1.6 : 1.45;
        pin(l.name, c, c6, NAME_X, nameY('phone'), sx - 50 * u * ns, iy + iconScreenH / 2 + 8 * u, ns, wPin);
      }
      // (Built fresh each frame — never read back — so nothing accumulates between frames.)
      if (kind !== 'phone') l.name.style.transform = portrait && back > 0 ? `rotate(${-c.rot}deg)` : '';
      else if (portrait && back > 0 && rush * (1 - back) <= 0) l.name.style.transform = `rotate(${-c.rot}deg)`;
      void i;
    });
    // 9:16, tilted: T's line ends just below the TV lane.
    const tTrim = portrait ? lerp(1, (L.lanes.tv + 16 * u - L.tTop) / tLen, back) : 1;
    tline.style.transform = `scaleY(${fallK(t) * tTrim})`;
    // The dot (T) and its label stay at the top of the T line, held inside
    // the frame in the close-up, the label at a readable size. One example
    // tag, always beside the phone's 90 ms, in 7 and 8.
    const flat = 1 - back;
    const topY = c.py + (L.tTop - c.fy) * c.s;
    const keepY = Math.max(topY, (portrait ? 130 : 90) * u);
    const dy = ((keepY - topY) / c.s) * flat;
    anchor.style.transform = `translateY(${dy}px)`;
    // Through the tilt the flat estimate above is not exact: measure, and pull
    // T (and its label) down until it is ≥ 70 px inside the top edge.
    let dy2 = 0;
    if (back > 0) {
      // Two passes: the first estimate ignores perspective, the second corrects it.
      for (let pass = 0; pass < 2; pass += 1) {
        const top = anchor.getBoundingClientRect();
        const need = 125 * u - (top.top + top.height / 2);
        if (need <= 0) break;
        dy2 += need / (c.s * Math.max(0.3, Math.cos((c.tilt * Math.PI) / 180)));
        anchor.style.transform = `translateY(${dy + dy2}px)`;
      }
    }
    const tk7 = lerp(1, 1.25 / c.s, rush * flat);
    tlabel.style.opacity = String(span(t, 11.05, 11.3) * (1 - span(t, 17.32, 17.5)));
    // The T line starts at the (held) dot, so nothing of it runs above T.
    const shift = dy + dy2;
    tline.style.transform = `translateY(${shift}px) scaleY(${Math.max(0, fallK(t) * tTrim - shift / tLen)})`;
    tlabel.style.transform = `translateY(${dy + dy2}px) scale(${Math.max(tk7, 1 / c.s * 0.9)})${portrait ? ` rotate(${-c.rot}deg)` : ''}`;
    // T flashes when a pulse arrives on it: the phone's in 7, all three together in 8.
    const flash = (at) => (t >= at ? Math.exp(-(t - at) * 4) : 0);
    // Composition 6's hold: T gathers (11.55–12.1) and all three lanes answer it together at 12.1.
    const charge = sine(span(t, 11.55, ACK)) * (1 - span(t, ACK + 0.15, ACK + 0.7));
    const home = Math.max(1.4 * flash(FIRE7 + RUN7), flash(ARRIVE8), 0.9 * flash(GROW8.tv[1]), 0.35 * span(t, GROW8.tv[1], GROW8.tv[1] + 0.2), 0.9 * charge);
    tline.style.boxShadow = `0 0 ${home * 34 * u}px ${home * 6 * u}px #5aa9ffaa`;

    // Read where T is before the lift moves the plane; from LIFT_SPAN[0] on
    // the camera is frozen, so this is the same point on every later frame.
    const ar = anchor.getBoundingClientRect();
    restDot = { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2, d: Math.min(46 * u, Math.max(24 * u, (ar.width + ar.height) / 2)) };
    const lift = span(t, ...LIFT_SPAN);
    // The lift: the plane scales up towards the camera (about the frame's
    // centre) and leaves through the top, fading out fast — gone in 0.23 s,
    // so it is never seen over the house at another scale.
    perspEl.style.opacity = String(1 - sine(span(t, LIFT_SPAN[0], LIFT_SPAN[0] + 0.14)));
    if (lift > 0) {
      const e = sine(span(t, LIFT_SPAN[0], LIFT_SPAN[0] + 0.16));
      const g = 1 + 0.7 * e;
      perspEl.style.transformOrigin = '50% 50%';
      perspEl.style.transform = `translate(0, ${-0.45 * H * e}px) scale(${g})`;
    }
  };
  onFrame(frame);

  // Where T is once the camera is frozen for the lift (from LIFT_SPAN[0]):
  // a constant, measured once per worker at build time, before any frame is
  // drawn, by laying this scene out at the release. Nothing that needs it
  // reads the page layout while frames are drawn.
  let frozenDot = null;
  waitFor(
    document.fonts.ready.then(() => {
      const prev = el.style.display;
      el.style.display = 'block';
      frame(DOT_RELEASE);
      frozenDot = { ...restDot };
      el.style.display = prev;
    }),
  );

  // The dot is the instant T: it lands at the top of the T line and rides the
  // camera exactly, because its place is read from an element in the diagram
  // (the same frame's layout before the lift; the frozen constant from it on).
  const dotAt = (t) => {
    const r = t >= LIFT_SPAN[0] && frozenDot ? frozenDot : restDot;
    const ex = (at) => (t >= at ? Math.exp(-(t - at) * 5) : 0);
    const pulse = Math.max(ex(FIRE7 + RUN7), ex(ARRIVE8), 0.6 * ex(GROW8.tv[1]));
    // As the plane lifts away the dot starts to sink, so the house's drop continues one motion.
    const sinkY = 60 * u * easeInOut(span(t, LIFT_SPAN[0], DOT_RELEASE));
    return { x: r.x, y: r.y + sinkY, d: r.d * (1 + 0.6 * pulse), glow: 0.2 + 0.9 * pulse };
  };
  hostDot(11.0, DOT_RELEASE, dotAt);
  // Composition 9 starts its dot from exactly here: a pure function of t
  // (from the frozen constant), clamped so any t ≥ the release gives the release value.
  handoff.liftDotAt = (t) => {
    const p = dotAt(Math.min(t, DOT_RELEASE));
    return { x: p.x, y: p.y, d: p.d };
  };
}
