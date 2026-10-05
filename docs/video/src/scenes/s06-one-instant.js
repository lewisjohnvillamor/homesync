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
 *     arrive on T together. Three lanes stay three lanes. The labels go; each
 *     device icon travels onto its own 3D model in the house (whose screen
 *     rectangles composition 9 publishes) and stands up to face the camera;
 *     then the plane — lanes and its own opaque ground, one sheet — comes up
 *     towards the camera and drops out of the frame, uncovering the lit house
 *     underneath, each icon dissolving into its model as it is uncovered,
 *     while the dot is let go and flies down to its place over it.
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
 * The hand-over into the house (composition 9 is drawn, fully lit, underneath
 * from 17.40). Over HAND each flat device icon travels across the plane onto
 * its own 3D model's place on screen (handoff.houseDevicesAt) and stands up
 * to face the camera, its lane's start running with it. Then, over LIFT_SPAN,
 * the plane (lanes and its own opaque ground, one sheet) comes up towards the
 * camera and drops out of the frame; its leading edge uncovers the house, and
 * each icon dissolves into its model only as the edge passes it.
 */
const HAND = [17.3, 17.68];
const LIFT = 17.85;
const LIFT_SPAN = [17.64, 17.94];
/** The labels, the T label and the example tag leave before any icon moves. */
const LABELS_OUT = [17.16, 17.3];
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
const ACK = 11.75;

export function build({ el, u, W, H, portrait, t0, onFrame, hostDot, waitFor }) {
  const L = laneLayout(W, H, u, portrait);
  const track = joinTrack(W, H, u, portrait);
  const order = ['laptop', 'phone', 'tv'];
  const label = { laptop: 'laptop', phone: 'phone', tv: 'TV' };
  const barH = 18 * u;
  const ruleH = 14 * u;
  const ic = L.phoneIcon;
  const devW = 180 * u * L.iconScale;
  const devH = 116 * u * L.iconScale;

  /**
   * Each device's name sits under its lane, set in from the lane's start so
   * it is well clear of the TV's start marker (the longest bar starts near
   * the lane's start) and of the icon.
   */
  const NAME_X = L.laneStart + 24 * u;
  /** 9:16: every name (the phone's too) is right-aligned, ending here, left of its lane's start. */
  const NAME_R = L.laneStart + 20 * u;
  const NAME_FS = 30 * u;
  /** 9:16, composition 8: how much the names grow, and how far each steps sideways (screen px) to stay clear of its lane. */
  const NAME_GROW = 1.4;
  const NAME_DX = { laptop: 0, phone: 0, tv: 0 };
  /** Width of each name's " · NN ms" (JetBrains Mono advances 0.6 em): computed, never read from the layout. */
  const NMS_W = Object.fromEntries(Object.entries(DELAY_MS).map(([k, v]) => [k, ` · ${v} ms`.length * 0.6 * NAME_FS]));
  // Above the lane, like its ms label, so a name and its delay share one side of one lane.
  const nameY = (kind) => L.lanes[kind] - (portrait ? 118 : 66) * u;
  const ackD = devW * 0.72;
  /**
   * The device icons live on their own copy of the plane (same camera, drawn
   * above it), so at the hand-over they can stay on the house's models while
   * the plane itself lifts away.
   */
  const iconHtml = (kind) => {
    const y = L.lanes[kind];
    return kind === 'phone'
      ? `<div class="icon icon-${kind}" style="position:absolute;left:${ic.x - ic.w / 2}px;top:${y - ic.h / 2}px;width:${ic.w}px;height:${ic.h}px;transform-origin:50% 50%">${phoneHtml(
          ic.w,
          ic.h,
          roomHtml(ic.w, false),
        )}</div>`
      : `<div class="icon icon-${kind}" style="position:absolute;left:${L.iconX - devW / 2}px;top:${y - devH / 2}px;width:${devW}px;height:${devH}px;transform-origin:50% 50%">${
          kind === 'laptop' ? laptopSvg() : tvSvg()
        }</div>`;
  };
  const lane = (kind) => {
    const y = L.lanes[kind];
    const w = DELAY_MS[kind] * L.pxPerMs;
    return `
      <div class="lane lane-${kind}">
        <div class="rule" style="position:absolute;left:${L.laneStart}px;top:${y - ruleH / 2}px;width:${L.laneEnd - L.laneStart}px;height:${ruleH}px;
             background:var(--text-faint);opacity:0.7;border-radius:${ruleH / 2}px;transform-origin:0 50%"></div>
        <div class="ackring" style="position:absolute;left:${L.iconX - ackD / 2}px;top:${y - ackD / 2}px;width:${ackD}px;height:${ackD}px;border-radius:50%;
             border:${5 * u}px solid var(--accent);box-sizing:border-box;opacity:0"></div>
        <div class="name" style="position:absolute;${portrait
          ? `left:${L.laneStart + 40 * u - 620 * u}px;width:${600 * u}px;text-align:right;transform-origin:calc(100% - ${kind === 'phone' ? NMS_W.phone : 0}px) 100%;`
          : `left:${NAME_X}px;transform-origin:0 100%;`}top:${nameY(kind)}px;
             font:600 ${30 * u}px/1 var(--sans);color:var(--text-dim);white-space:nowrap"><span class="nin" style="display:inline-block;transform-origin:0 100%">${label[kind]}<span class="nms" style="font:500 ${30 * u}px/1 var(--mono);opacity:0"> · ${DELAY_MS[kind]} ms</span></span></div>
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
        <div class="ms" style="position:absolute;${portrait
          ? `left:${L.tX - w / 2 - 300 * u}px;width:${600 * u}px;top:${y - barH / 2 - 46 * u}px;text-align:center;transform-origin:50% 100%;`
          : `left:${L.tX - w - 260 * u}px;width:${w + 234 * u}px;top:${y - barH / 2 - 54 * u}px;text-align:right;transform-origin:100% 100%;`}
             font:500 ${34 * u}px/1 var(--mono);color:var(--text-dim);white-space:nowrap;${kind === 'phone' ? '' : 'display:none'}">${DELAY_MS[kind]} ms</div>
      </div>`;
  };

  // The camera: perspective matching the house camera's field of view, so
  // the tilted plane foreshortens the way the model does.
  // 16:9 is drawn with a longer lens than the house's (10° against 30°): at
  // this tilt and turn the TV's bar runs towards the camera and otherwise
  // reads ~25 % long against the laptop's.
  // The hand-over no longer depends on the two lenses matching: the icons are
  // placed on the models' measured screen rectangles.
  const persp = (H / 2) / Math.tan(((portrait ? HOUSE_VIEW.fov : 10) / 2) * (Math.PI / 180));
  /** The ground's soft leading edge, drawn above the frame until the plane lifts. */
  const FEATHER = 90 * u;
  el.innerHTML = `
    <style>.scene-6 .icon svg [stroke]{stroke:var(--text-faint)}</style>
    <div class="sheet" style="position:absolute;inset:0">
      <div class="ground" style="position:absolute;left:${-40 * u}px;right:${-40 * u}px;top:${-FEATHER}px;bottom:${-40 * u}px;
           background:linear-gradient(to bottom, transparent, var(--bg) ${FEATHER}px)"></div>
      <div class="persp" style="position:absolute;inset:0;perspective:${persp}px;perspective-origin:50% 50%">
        <div class="world" style="position:absolute;inset:0;transform-style:preserve-3d;transform-origin:0 0">
          ${order.map(lane).join('')}
        <div class="tline" style="position:absolute;left:${L.tX - 3 * u}px;top:${L.tTop}px;width:${6 * u}px;height:${L.lanes.tv + 70 * u - L.tTop}px;
             background:var(--accent);transform-origin:50% 0;border-radius:${3 * u}px"></div>
        <div class="tlabel" style="position:absolute;left:${L.tX + 30 * u}px;top:${L.tTop - 30 * u}px;transform-origin:${-30 * u}px ${30 * u}px;font:700 ${56 * u}px/1 var(--sans);color:var(--accent)">T</div>
        <div class="anchor" style="position:absolute;left:${L.tX - 13 * u}px;top:${L.tTop - 13 * u}px;width:${26 * u}px;height:${26 * u}px"></div>
        </div>
      </div>
    </div>
    <div class="persp2" style="position:absolute;inset:0;perspective:${persp}px;perspective-origin:50% 50%">
      <div class="world2" style="position:absolute;inset:0;transform-style:preserve-3d;transform-origin:0 0">
        ${order.map(iconHtml).join('')}
      </div>
    </div>
    <div class="exv example-tag" style="position:absolute;z-index:3;left:0;top:0;--tag-size:${(portrait ? 22 : 24) * u}px;opacity:0">example values</div>
    <div class="line6" style="position:absolute;z-index:2;left:${portrait ? 70 * u : 128 * u}px;top:${portrait ? 150 * u : 96 * u}px;
         font:700 ${portrait ? 84 * u : 76 * u}px/1.08 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">${portrait ? 'Every device is told<br>one instant…' : 'Every device is told one instant…'}</div>`;

  const perspEl = el.querySelector('.persp');
  const persp2 = el.querySelector('.persp2');
  const world2 = el.querySelector('.world2');
  const sheet = el.querySelector('.sheet');
  const line6 = el.querySelector('.line6');
  // The diagram's own ground. Transparent while composition 5's phone is
  // still shrinking into its icon underneath; opaque after, so the house
  // (composition 9, at a lower z) is only revealed by the iris at the lift.
  const ground = el.querySelector('.ground');
  const world = el.querySelector('.world');
  const tline = el.querySelector('.tline');
  const tlabel = el.querySelector('.tlabel');
  const anchor = el.querySelector('.anchor');
  const exv = el.querySelector('.exv');
  const lanes = Object.fromEntries(
    order.map((kind) => {
      const root = el.querySelector(`.lane-${kind}`);
      const q = (c) => root.querySelector(c);
      const icon = el.querySelector(`.icon-${kind}`);
      return [kind, {
        icon, ackring: q('.ackring'), name: q('.name'), nin: q('.nin'), nms: q('.nms'), rule: q('.rule'), tick: q('.tick'), flash: q('.flash'), bar: q('.bar'),
        screen: icon.querySelector('.screen'), start: q('.start'), fire: q('.fire'), pulse: q('.pulse'), ms: q('.ms'),
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
    // 9:16: the lane fills the width, high in the frame (the line sits under it).
    s: (portrait ? 570 * u : 1300 * u) / barPhone * lerp(1, 1.035, sine(span(t, C7 + 0.6, C8))),
    fx: L.tX,
    fy: L.lanes.phone,
    px: (portrait ? W - 125 * u : 1650 * u) - 24 * u * sine(span(t, C7 + 0.6, C8)),
    // 9:16 sits lower, so the group and the line below it share the frame's height.
    py: portrait ? 900 * u : 470 * u,
    tilt: 0,
    rot: 0,
  });
  const camC = (t) => {
    const k = sine(span(t, C8 + 0.6, LIFT));
    return {
      // 9:16 pushes harder through the hold (5 %), so it never reads as paused.
      // 9:16 is framed larger (its icons close up towards the bars, so the plane is narrower).
      s: (portrait ? 0.88 : 1.08) * lerp(1, portrait ? 1.05 : 1.04, k),
      fx: portrait ? (L.iconX + SHIFT8 - devW / 2 + L.tX + 40 * u) / 2 : (L.iconX - devW / 2 + L.laneEnd) / 2,
      fy: (L.lanes.laptop + L.lanes.tv) / 2,
      px: W / 2 + (portrait ? 0 : 50 * u) + (portrait ? 0 : 30) * u * k,
      py: (portrait ? H * 0.41 - 120 * u : H * 0.45) + 10 * u * k,
      tilt: 90 - elevation,
      // 9:16: the house's turn (−70°) would stand the lanes on end, so the plane
      // is held at −30° (lanes within ~25° of horizontal) and turns to the
      // house's angle just before the lift (17.5–17.8).
      rot: portrait ? PORTRAIT_ROT : VIEW.azimuth,
    };
  };
  const PORTRAIT_ROT = -30;
  /** 9:16, composition 8: how far (world px) the icons and names close up towards the bars. */
  const SHIFT8 = portrait ? 150 * u : 0;
  const mix = (a, b, k) => {
    const out = {};
    for (const key of Object.keys(a)) out[key] = key === 's' ? a.s * (b.s / a.s) ** k : lerp(a[key], b[key], k);
    return out;
  };
  // The camera starts leaning in on the phone lane from 11.9 s, then rushes in on the cut.
  const RUSH = [12.4, 13.3];
  const rushK = (t) => {
    const k = span(t, ...RUSH);
    // Accelerates in, then settles slowly: an ease-in-out with its arrival stretched.
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2;
    // 9:16 has no lean (it would push the icons off the left edge); the hold has its acknowledge instead.
    return Math.max((portrait ? 0 : 0.07) * (span(t, 11.45, RUSH[0]) ** 1.2), k > 0 ? e : 0);
  };
  /** The rush alone, without the lean: how far the phone is pinned in the close-up. */
  const rushOnly = (t) => {
    const k = span(t, ...RUSH);
    return k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2;
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
  const pin = (elx, c, c6, ax, ay, sx, sy, scr, w, pop = 1, tail = '') => {
    if (w <= 0) {
      elx.style.transform = `${pop !== 1 ? `scale(${pop})` : ''} ${tail}`.trim();
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
    elx.style.transform = `translate(${wx - ax}px, ${wy - ay}px) scale(${k * pop}) ${tail}`.trim();
  };

  // --- the plane on screen ------------------------------------------------------
  // The same projection the browser applies to .world (CSS perspective about
  // the frame centre), so a point on the plane can be placed at a screen point
  // by arithmetic alone.
  const project = (c, x, y) => {
    const X = (x - c.fx) * c.s;
    const Y = (y - c.fy) * c.s;
    const r = (c.rot * Math.PI) / 180;
    const a = (c.tilt * Math.PI) / 180;
    const X1 = X * Math.cos(r) - Y * Math.sin(r);
    const Y1 = X * Math.sin(r) + Y * Math.cos(r);
    const Z = Y1 * Math.sin(a);
    const k = persp / (persp - Z);
    return { x: W / 2 + (X1 + c.px - W / 2) * k, y: H / 2 + (Y1 * Math.cos(a) + c.py - H / 2) * k, k };
  };
  /** The plane point drawn at screen point (sx, sy), and the depth scale there. */
  const unproject = (c, sx, sy) => {
    const r = (c.rot * Math.PI) / 180;
    const a = (c.tilt * Math.PI) / 180;
    const Y1 = (persp * (sy - c.py)) / (persp * Math.cos(a) + (sy - H / 2) * Math.sin(a));
    const k = persp / (persp - Y1 * Math.sin(a));
    const X1 = (sx - W / 2) / k + W / 2 - c.px;
    const X = X1 * Math.cos(r) + Y1 * Math.sin(r);
    const Y = -X1 * Math.sin(r) + Y1 * Math.cos(r);
    return { x: X / c.s + c.fx, y: Y / c.s + c.fy, k };
  };
  /** The lift at time t: the sheet's transform and its leading (top) edge on screen; null before it. */
  const liftAt = (t) => {
    const k = span(t, ...LIFT_SPAN);
    if (k <= 0) return null;
    // Leaves fast: it is already moving on its first frame and accelerates out.
    const e = 0.5 * k + 0.5 * k * k;
    const o = project(cam(LIFT_SPAN[0]), L.tX, L.tTop);
    const g = 1 + 1.4 * e;
    // At the end the feathered top edge is below the frame's bottom.
    const D = e * (H + 10 * u - o.y + (FEATHER + o.y) * (1 + 1.4));
    // Where the ground becomes solid (its feather ends) and where it starts.
    return { o, g, D, solid: o.y - o.y * g + D, top: o.y - (FEATHER + o.y) * g + D };
  };

  /** As `pin`, but returns where the anchor lands on the plane and its scale there, instead of writing a transform. */
  const pinAt = (c, c6, ax, ay, sx, sy, scr, w) => {
    if (w <= 0) return { x: ax, y: ay, m: 1 };
    const ux = c.px + (ax - c.fx) * c.s;
    const uy = c.py + (ay - c.fy) * c.s;
    const u6 = c6.px + (ax - c6.fx) * c6.s;
    const x = Math.max(lerp(ux, sx, w), lerp(u6, sx, w));
    const y = lerp(uy, sy, w);
    return { x: c.fx + (x - c.px) / c.s, y: c.fy + (y - c.py) / c.s, m: lerp(c.s, scr, w) / c.s };
  };

  /** Where the dot (T) sits once the camera is frozen for the lift; set each frame, the same value from LIFT_SPAN[0] on. */
  let restDot = null;

  const frame = (t) => {
    // The camera holds still for the lift, so the lift alone moves the plane.
    const c = cam(Math.min(t, LIFT_SPAN[0]));
    // scale3d, not scale: the icons stand up off the plane at the hand-over,
    // and a 2D scale would leave their depth unscaled.
    const camTf = `translate(${c.px}px, ${c.py}px) rotateX(${c.tilt}deg) rotateZ(${c.rot}deg) scale3d(${c.s}, ${c.s}, ${c.s}) translate(${-c.fx}px, ${-c.fy}px)`;
    world.style.transform = camTf;
    world2.style.transform = camTf;
    // The diagram's own opaque ground: transparent while composition 5's phone
    // is still shrinking into its icon underneath, opaque after. It never
    // fades: at the lift it leaves with the plane, uncovering the lit house.
    ground.style.opacity = t >= ICON_LANDS ? '1' : '0';
    // '' (inherit), never 'visible': an explicit 'visible' would show through the layer while the film hides it.
    sheet.style.visibility = t < LIFT_SPAN[1] + 0.02 ? '' : 'hidden';
    persp2.style.visibility = t < LIFT_SPAN[1] + 0.06 ? '' : 'hidden';
    // Set at the end of the frame, after T has been measured on the resting plane.
    sheet.style.transform = 'none';
    // While composition 5's phone shrinks into its icon, the lanes and names
    // draw in behind it: none of them is drawn left of the phone's edge. (The
    // camera is still flat and unmoved then, so world x is frame x.) The laptop
    // and TV icons are not clipped: they arrive whole beside the landing phone.
    const clipX = t < ICON_LANDS - 0.04 ? (() => { const r = track.phoneRect(t); return r.x + track.phoneW * r.s + 14 * u; })() : null;
    const clipFrom = (elx, left) => {
      elx.style.clipPath = clipX === null ? 'none' : `inset(0 0 0 ${Math.max(0, clipX - left)}px)`;
    };
    perspEl.style.clipPath = 'none';
    // The hand-over: where each house model is on screen, as a point on this plane.
    const hand = easeInOut(span(t, ...HAND));
    const house = hand > 0 ? handoff.houseDevicesAt?.(t) ?? null : null;
    const lift = liftAt(t);

    // Composition 6's line: set by 11.30 s, drifting, gone before the rush.
    const in6 = expoOut(span(t, t0 + 0.1, t0 + 0.6));
    // It leaves (12.55–12.80) before the rush carries the laptop's lane up into its band.
    const out6 = span(t, 12.55, 12.8);
    line6.style.opacity = String(in6 * (1 - out6));
    line6.style.transform = `translate(${(1 - in6) * -260 * u + sine(span(t, t0 + 0.6, 12.8)) * 40 * u}px, ${out6 * -40 * u}px)`;

    // --- composition 6: icons, T falls, each lane is told ---
    const rush = rushK(t);
    const back = backK(t);
    /** 9:16, composition 8: icons and names close up towards the bars, so the plane is narrower and framed larger. */
    const close8 = SHIFT8 * easeInOut(span(back, 0.3, 1));
    order.forEach((kind, i) => {
      const l = lanes[kind];
      // The phone icon is composition 5's phone, which lands here at ICON_LANDS.
      // The laptop and TV come in whole beside it as it lands (solid by ~10.9), so the diagram never arrives thin.
      const iconIn = kind === 'phone' ? (t >= ICON_LANDS ? 1 : 0) : easeOut(span(t, 10.62 + i * 0.03, 10.86 + i * 0.03));
      // In the close-up the laptop and TV are out of shot; they come back only
      // once the phone has shrunk back into its slot, so no two icons overlap.
      // They return as the pull back starts — at 60 % at once (15.42–15.56),
      // so the stack is there as the plane tilts — and fully once the phone has
      // shrunk back into its slot.
      const iconBack = 0.6 * easeInOut(span(back, 0.06, 0.3)) + 0.4 * easeInOut(span(back, 0.4, 0.75));
      const iconAway = kind === 'phone' ? 0 : easeInOut(span(rush, 0.05, 0.4)) * (1 - iconBack);
      const iconK = iconIn * (1 - iconAway);
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
      // The phone keeps composition 5's glow as it lands (never a dip in brightness), easing to its lane glow.
      const carry = kind === 'phone' ? 1 - span(t, ICON_LANDS + 0.1, ICON_LANDS + 0.6) : 0;
      const glow = iconK > 0
        ? `${carry > 0 ? `drop-shadow(0 0 ${2 * u}px rgba(148,163,180,${0.8 * carry})) ` : ''}drop-shadow(0 0 ${Math.max(glowPx, 14 * u * carry)}px rgba(90,169,255,${Math.max(0.25 + 0.55 * lit, 0.6 * carry)}))`
        : 'none';
      l.icon.style.filter = glow;
      // Its screen comes up as it is told.
      if (l.screen) {
        l.screen.style.fill = lit > 0 ? 'var(--accent)' : '';
        l.screen.style.fillOpacity = lit > 0 ? String(0.12 + 0.3 * lit + 0.35 * ack) : '';
      }
      // Composition 8: 16:9's laptop and TV a little smaller, so the three icons
      // stand clear of each other; 9:16's icons a little larger (its plane is framed wider).
      const size8 = lerp(1, kind === 'phone' ? (portrait ? 1.15 : 1) : portrait ? 1.15 : 0.86, easeInOut(span(back, 0.3, 1)));
      /** The icon's centre on the plane and its scale, before the hand-over (the phone's is set below). */
      let place = kind === 'phone' ? null : { x: L.iconX + (1 - iconIn) * -30 * u + close8, y: L.lanes[kind], m: (1 + 0.06 * lit + (portrait ? 0.08 : 0.16) * ack) * size8 };
      // The other lanes step aside during the close-up, so no word is ever cut
      // by the frame edge: their names go first (12.30–12.55, before the rush
      // moves anything), then their lanes as the rush begins.
      const aside = kind === 'phone' ? 0 : easeInOut(span(rush, 0.03, 0.3)) * (1 - easeInOut(span(back, 0.06, 0.5)));
      const nameAway = kind === 'phone' ? 0 : easeInOut(span(t, 12.3, 12.55)) * (1 - easeInOut(span(back, 0.35, 0.7)));
      l.name.style.opacity = String(easeOut(span(t, 10.68, 10.95)) * (1 - nameAway) * (1 - span(t, ...LABELS_OUT)));
      clipFrom(l.name, portrait ? NAME_R - 600 * u : NAME_X);
      clipFrom(l.rule, L.laneStart);
      // At the hand-over the lanes recede (to a fifth) so the travelling icons lead.
      l.rule.style.opacity = String((0.7 + 0.3 * ack) * (1 - aside) * (1 - 0.8 * easeInOut(span(t, ...HAND))));
      l.rule.style.background = ack > 0.01 ? `color-mix(in srgb, var(--accent) ${Math.round(55 * ack)}%, var(--text-faint))` : 'var(--text-faint)';
      // 9:16, tilted: the lanes stop just past T, so nothing runs to the frame's edge.
      const trimTo = (L.tX + 16 * u - L.laneStart) / (L.laneEnd - L.laneStart);
      const len0 = L.laneEnd - L.laneStart;
      /** The lane's two ends on the plane (set below, once the icon's place is known). */
      const ruleS = { x: L.laneStart + close8, y: L.lanes[kind] };
      const ruleE = { x: L.laneStart + len0 * lerp(1, trimTo, back), y: L.lanes[kind] };
      l.name.style.color = lit > 0.5 ? 'var(--text)' : 'var(--text-dim)';
      // A tick and a ring flash where T crosses the lane — on the line, never travelling along it.
      const tk = span(t, reach, reach + 0.18);
      l.tick.style.opacity = String((tk > 0 ? 1 : 0) * (1 - span(t, C7 + 0.3, C7 + 0.5)) * (1 - aside));
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
      // Composition 7: the phone's figure over its bar. Composition 8: each
      // figure joins its device's name ("TV · 210 ms") as its bar lands, so no
      // figure is ever nearer another device, and no label sits by T or a bar.
      // The phone's figure never leaves: as the pull back starts, the "90 ms"
      // over its bar hands over to "phone · 90 ms" beside it (15.40–15.50).
      const nmsOn = easeOut(span(t, growFrom + 0.12, growFrom + 0.35)) * (kind === 'phone' ? easeInOut(span(back, 0.03, 0.2)) : span(back, 0.6, 1));
      l.nms.style.opacity = String(nmsOn);
      // Tilted, the labels foreshorten; they grow so they read at ≥ 24 px.
      // 9:16 labels are counter-turned so they read screen-horizontal on the turned plane.
      l.ms.style.transform = portrait
        ? `scale(${lerp(1, 1.5, back)}) rotate(${-c.rot}deg)`
        : `translate(${-24 * u * back}px, ${-22 * u * back}px) scale(${lerp(1, 1.5, back)})`;
      // Gone before the plane lifts, so no label is ever seen over the house.
      l.ms.style.opacity = String(msOn * (1 - easeInOut(span(back, 0.03, 0.2))));

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
      // 9:16: every name is counter-turned so it reads screen-horizontal on the
      // turned plane (no-op while the plane is flat), and closes up with its icon.
      // 9:16, composition 8: the names (with their figures) grow to read on a
      // phone screen (~1.4×, from the left), stepping up clear of their lanes.
      const b8 = portrait ? easeInOut(span(back, 0.55, 1)) : 0;
      // (On an inner box that grows from its left, so the name's own turn is untouched.)
      l.nin.style.transform = b8 > 0 ? `translate(${NAME_DX[kind] * b8}px, ${-40 * u * b8}px) scale(${lerp(1, NAME_GROW, b8)})` : '';
      const tail = portrait ? `translateX(${close8}px) rotate(${-c.rot}deg)` : '';
      if (kind === 'phone') {
        // The phone is pinned only by the rush itself (not composition 6's
        // lean, so its name stays aligned with the others there), and shrinks
        // back into its slot in the first half of the pull back, before the
        // laptop and TV return.
        const wPin = rushOnly(t) * (1 - easeInOut(span(back, 0, 0.5)));
        const iconScreenH = portrait ? 470 * u : 400 * u;
        const iconScr = iconScreenH / ic.h;
        const sx = portrait ? 160 * u : 140 * u;
        const c6 = camA(t);
        const iy = c.py;
        const pa = pinAt(c, c6, ic.x, L.lanes.phone, sx, iy, iconScr, wPin);
        place = { x: pa.x + pa.m * close8, y: pa.y, m: pa.m * (1 + 0.16 * ack) * size8 };
        // The lane stays attached to the phone as it shrinks back: it starts at
        // the phone's edge wherever that is left of the lane's own start.
        // (Only from the rush on; once the phone is back in its slot the lane
        // draws back to its own start, 15.65–15.9.)
        const attach = rushOnly(t) * (1 - easeInOut(span(back, 0.5, 0.85)));
        const edge = place.x + (ic.w / 2) * place.m + 4 * u;
        if (attach > 0 && edge < ruleS.x) {
          const kk = Math.min(1, (ruleS.x - edge) / (40 * u));
          ruleS.y = lerp(ruleS.y, place.y, kk * attach);
          ruleS.x = lerp(ruleS.x, edge, attach);
        }
        const ns = portrait ? 1.6 : 1.45;
        if (portrait) {
          // 9:16: over the phone, ending at its right edge (the name's anchor is the end of "phone").
          pin(l.name, c, c6, NAME_R - NMS_W.phone, nameY('phone') + NAME_FS, sx + (ic.w * iconScr) / 2, iy - iconScreenH / 2 - 26 * u, ns, wPin, 1, tail);
        } else {
          // 16:9: on the lane side of the phone, above its lane — the same side
          // as in compositions 6 and 8, so it never crosses an icon or the heading.
          pin(l.name, c, c6, NAME_X, nameY('phone') + NAME_FS, sx + (ic.w * iconScr) / 2 + 36 * u, iy - 78 * u, ns, wPin);
        }
      } else l.name.style.transform = tail;

      // --- the hand-over: the icon travels onto its model and stands up ---
      const bw = kind === 'phone' ? ic.w : devW;
      const bh = kind === 'phone' ? ic.h : devH;
      let stand = 0;
      let uncover = 0;
      if (house && house[kind]) {
        const R = house[kind];
        const P = unproject(c, R.x, R.y);
        // Fitted inside the model's screen rectangle, facing the camera.
        const m1 = Math.min(R.w / bw, R.h / bh) / (c.s * P.k);
        place = { x: lerp(place.x, P.x, hand), y: lerp(place.y, P.y, hand), m: place.m * (m1 / place.m) ** hand };
        stand = hand;
        // Its lane's start runs with it; its end draws in to the start marker.
        ruleS.x = lerp(ruleS.x, P.x, hand);
        ruleS.y = lerp(ruleS.y, P.y, hand);
        ruleE.x = lerp(ruleE.x, L.tX - l.w, hand);
        // The icon dissolves into its model only as the lifting plane's edge uncovers it.
        if (lift) uncover = easeInOut(span(lift.top, R.y - R.h / 2 - 0.5 * FEATHER, R.y + R.h / 2));
      }
      const ax = kind === 'phone' ? ic.x : L.iconX;
      l.icon.style.transform =
        `translate(${place.x - ax}px, ${place.y - L.lanes[kind]}px) rotateZ(${-c.rot * stand}deg) rotateX(${-c.tilt * stand}deg) scale(${place.m})`;
      l.icon.style.opacity = String(iconK * (1 - uncover));
      const rl = Math.hypot(ruleE.x - ruleS.x, ruleE.y - ruleS.y);
      const ra = Math.atan2(ruleE.y - ruleS.y, ruleE.x - ruleS.x);
      l.rule.style.transform = `translate(${ruleS.x - L.laneStart}px, ${ruleS.y - L.lanes[kind]}px) rotate(${ra}rad) scaleX(${Math.max(0.0001, rl / len0)})`;
      // (Built fresh each frame — never read back — so nothing accumulates between frames.)
      void i;
    });
    // 9:16, tilted: T's line ends just below the TV lane.
    const tTrim = lerp(1, (L.lanes.tv + 16 * u - L.tTop) / tLen, back);
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
        const need = (125 * u - (top.top + top.height / 2)) * (1 - span(back, 0.75, 1));
        if (need <= 0) break;
        dy2 += need / (c.s * Math.max(0.3, Math.cos((c.tilt * Math.PI) / 180)));
        anchor.style.transform = `translateY(${dy + dy2}px)`;
      }
    }
    const tk7 = lerp(1, 1.25 / c.s, rush * flat);
    tlabel.style.opacity = String(span(t, 11.05, 11.3) * (1 - span(t, ...LABELS_OUT)));
    // The T line starts at the (held) dot, so nothing of it runs above T.
    const shift = dy + dy2;
    tline.style.transform = `translateY(${shift}px) scaleY(${Math.max(0, fallK(t) * tTrim - shift / tLen)})`;
    // Tilted (8), the label steps a little further from the dot, clear of its glow.
    tlabel.style.transform = `translateY(${dy + dy2}px) scale(${Math.max(tk7, 1 / c.s * 0.9)})${portrait ? ` rotate(${-c.rot}deg)` : ''} translate(${28 * u * back}px, ${-10 * u * back}px)`;
    // One "example values" tag for the figures: in 7 under the phone's start
    // marker (clear of T and the bar); in 8 just above the column of
    // "device · ms" names. It fades between the two, never slides.
    // It stays with the figures through the pull back (the phone's "90 ms" is
    // on screen throughout): out of 7's place by 15.62, into 8's by 15.75.
    // Through the pull back it sits over "phone · 90 ms", the figure on screen
    // then: in 7's place to 15.47, over the phone's name 15.49–15.65, in 8's from 15.68.
    const in7 = easeOut(span(t, C7 + 0.6, C7 + 0.8)) * (1 - span(back, 0, 0.12));
    const inP = span(back, 0.14, 0.24) * (1 - span(back, 0.42, 0.52));
    const in8 = span(back, 0.55, 0.7) * (1 - span(t, ...LABELS_OUT));
    let tagAt = null;
    if (in7 > 0) {
      const r = lanes.phone.start.getBoundingClientRect();
      tagAt = { x: r.left - 10 * u, y: r.bottom + 30 * u, o: in7 };
    } else if (inP > 0) {
      const n = lanes.phone.nin.getBoundingClientRect();
      tagAt = { x: n.left, y: n.top - exv.offsetHeight - 14 * u, o: inP };
    } else if (in8 > 0) {
      const r = lanes.laptop.nms.getBoundingClientRect();
      const n = lanes.laptop.nin.getBoundingClientRect();
      tagAt = portrait
        ? { x: r.right - exv.offsetWidth, y: Math.min(r.top, n.top) - exv.offsetHeight - 22 * u, o: in8 }
        : { x: n.left, y: n.top - exv.offsetHeight - 18 * u, o: in8 };
    }
    if (tagAt) tagAt.x = Math.min(Math.max(tagAt.x, 60 * u), W - 60 * u - exv.offsetWidth);
    exv.style.opacity = String(tagAt ? tagAt.o : 0);
    if (tagAt) exv.style.transform = `translate(${tagAt.x}px, ${tagAt.y}px)`;
    // T flashes when a pulse arrives on it: the phone's in 7, all three together in 8.
    const flash = (at) => (t >= at ? Math.exp(-(t - at) * 4) : 0);
    // Composition 6's hold: T gathers (11.55–12.1) and all three lanes answer it together at 12.1.
    const charge = sine(span(t, 11.45, ACK)) * (1 - span(t, ACK + 0.3, ACK + 1.0));
    const home = Math.max(1.4 * flash(FIRE7 + RUN7), flash(ARRIVE8), 0.9 * flash(GROW8.tv[1]), 0.35 * span(t, GROW8.tv[1], GROW8.tv[1] + 0.2), 0.9 * charge);
    tline.style.boxShadow = `0 0 ${home * 34 * u}px ${home * 6 * u}px #5aa9ffaa`;

    // Read where T is before the lift moves the plane; from LIFT_SPAN[0] on
    // the camera is frozen, so this is the same point on every later frame.
    const ar = anchor.getBoundingClientRect();
    restDot = { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2, d: Math.min(46 * u, Math.max(24 * u, (ar.width + ar.height) / 2)) };
    // The lift: the plane — lanes and its own opaque ground, one sheet —
    // comes up towards the camera (growing about T) and falls away out of the
    // bottom of the frame, its leading edge uncovering the lit house from the
    // top down. It never fades. The icons are not on it: they stay on the
    // models.
    if (lift) {
      sheet.style.transformOrigin = `${lift.o.x}px ${lift.o.y}px`;
      sheet.style.transform = `translate(0, ${lift.D}px) scale(${lift.g})`;
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
    // As the plane lifts away the dot starts to sink — still moving at the
    // release, so the house's drop continues one motion (never a stop).
    const sinkY = 220 * u * easeInOut(span(t, 17.45, 18.4));
    return { x: r.x, y: r.y + sinkY, d: r.d * (1 + 0.6 * pulse), glow: 0.2 + 0.9 * pulse };
  };
  hostDot(11.0, DOT_RELEASE, dotAt);
  // Composition 9 starts its dot from here: a pure function of t (from the
  // frozen constant). For t past the release it continues the same sinking
  // motion, so a reader that blends from liftDotAt(t) (not a fixed point)
  // hands over with the dot still moving.
  handoff.liftDotAt = (t) => {
    const p = dotAt(Math.max(t, LIFT_SPAN[0]));
    return { x: p.x, y: p.y, d: p.d };
  };
}
