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
 *     arrive on T together. Three lanes stay three lanes, each running out of
 *     its device. The labels go; the sheet's ground goes as the house starts
 *     to come up beneath it; the sheet — icons, lanes, bars, markers, T and
 *     composition 8's line, one piece — grows towards the camera about T and
 *     rises out of the top of the frame while the house comes up underneath.
 *     The icons belong to the diagram and leave with it; the dot stays (the
 *     sheet never crosses it) and is let go into the house.
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

/** Read by the builder's checks only (never by another scene): the sheet's lines and icons on the last frame drawn. */
export const debug = {};
/**
 * The lift, for composition 8's line (s08), which rides the same sheet: set at
 * build. `at(t)` gives the lift's growth g about (ox, oy), its rise dy and its
 * opacity o (null before it), and the clear disc round the dot (x, y, r, f:
 * fully clear inside r, solid again at r + f), or null outside the lift.
 */
export const sheetLift = { at: null };

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
 * The hand-over into the house. Composition 9 is drawn underneath, a solid
 * model that emerges evenly from the ground colour from 17.15 (every house
 * pixel equals the ground then; ~10 % at 17.27, ~38 % at 17.40, full at
 * 17.75). Nothing of the diagram travels into the house: any path from
 * outside it to a model inside would cross a wall on screen. The dot is what
 * carries across; the icons belong to the diagram and leave with it.
 *
 *  17.06–17.21  The names, figures, T label and example tag leave.
 *  17.15        The sheet's own ground goes in one frame (1 → 0, nothing in
 *               between): the house under it is exactly the ground colour, so
 *               from here it comes up under the lanes.
 *  17.20–17.45  The sheet — icons, lanes, bars, markers, T and composition
 *               8's line, one piece, nothing on it moving on its own — leaves
 *               towards the camera: it grows 1.5× about T (where the dot
 *               stays) and rises up and out of the top of the frame (ease-in),
 *               holding its brightness and fading only in its last third. By
 *               the first frame the house is past 10 % no lane, bar or icon
 *               lies on another device's model. Whatever of it passes within
 *               ~44 px of the dot is cleared there (a soft disc round the dot,
 *               opening over the lift's first frames), so nothing crosses it;
 *               and each lane (rule, bar and start marker, one piece) fades
 *               out whole as it nears that disc, so no lane is ever seen
 *               running on either side of the dot like a bead on a bar.
 *               Composition 8's line (s08) is gone by 17.27, before the house
 *               is past ~10 %.
 */
/** The sheet's ground goes in one frame, here (the house underneath is exactly the ground colour). */
const GROUND_OFF = 17.15;
/** The lift: the sheet grows LIFT_GROW× about T and rises LIFT_RISE frame heights (progress k^LIFT_EASE), gone by LIFT[1]. */
const LIFT = [17.2, 17.45];
const LIFT_GROW = 1.5;
const LIFT_EASE = 1.4;
/** 9:16's line sits lower under T, so its sheet rises further (in px) to carry the line out of the top too. */
const LIFT_RISE = { landscape: 1.5, portrait: 1.2 };
/** The clear disc round the dot: past its rim by this much (design px), soft over CLEAR_F; it opens over CLEAR_IN. */
const CLEAR_R = 44;
const CLEAR_F = 16;
const CLEAR_IN = [17.2, 17.26];
/** The camera freezes here (composition 9's liftDotAt is read from this frozen camera: unchanged). */
const LIFT0 = 17.32;
/** The camera's drift through composition 8's hold eases to rest here. */
const DRIFT_END = LIFT0;
/** The labels, the T label and the example tag leave before the sheet or any icon moves. */
const LABELS_OUT = [17.06, 17.21];
/**
 * The dot stays where T was as the sheet lifts away about it (everything of
 * the diagram moves away from it, nothing crosses it), then is let go and the
 * film flies it into the house's host.
 */
const DOT_RELEASE = 17.9;

/** Composition 7 → 8: the phone's "90 ms" moves and scales into "phone · 90 ms", the example tag sliding with it. */
const LABEL_MOVE = [15.36, 15.61];
/** 16:9, composition 6: the lane names fade in from here, once the shrinking phone has reached its lane. */
const NAMES_IN = 10.78;
/** Composition 7: the phone's "90 ms" fades in from here. */
const MS7_IN = 13.3;

/** Composition 6: the T line falls from the dot through the lanes. */
const FALL = [11.0, 11.8];
/** Composition 7: the phone's start fires, and its pulse takes 90 ms × 8 to reach T. */
const FIRE7 = 14.2;
const RUN7 = 0.72;
/** Composition 8: the bars land one after another, then all three pulses arrive on T together. */
const GROW8 = { laptop: [15.95, 16.3], tv: [16.32, 16.95] };
// (Before the sheet lifts at 17.33, so the arrival is seen; the TV fires just after its bar lands at 16.95.)
const ARRIVE8 = 17.3;
const RUN8 = (kind) => (DELAY_MS[kind] / 1000) * 1.4;
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
  const NAME_GROW = 1.8;
  /** Each name's full width ("TV · 210 ms"), measured once the fonts are in (a constant). */
  const textW = { laptop: 0, phone: 0, tv: 0 };
  /** Width of each name's " · NN ms" (JetBrains Mono advances 0.6 em): computed, never read from the layout. */
  const NMS_W = Object.fromEntries(Object.entries(DELAY_MS).map(([k, v]) => [k, ` · ${v} ms`.length * 0.6 * NAME_FS]));
  // Above the lane, like its ms label, so a name and its delay share one side of one lane.
  const nameY = (kind) => L.lanes[kind] - (portrait ? 118 : 66) * u;
  const ackD = devW * 0.72;
  /** The device icons live on their own copy of the plane (same camera, drawn above it); they lift with the sheet. */
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
             font:600 ${30 * u}px/1 var(--sans);color:var(--text-dim);white-space:nowrap"><span class="nin" style="display:inline-block;transform-origin:0 100%">${label[kind]}<span class="nms" style="font:500 ${30 * u}px/1 var(--mono);opacity:0"><span class="ndot"> · </span><span class="nnum">${DELAY_MS[kind]} ms</span></span></span></div>
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
             font:500 ${34 * u}px/1 var(--mono);color:var(--text-dim);white-space:nowrap;${kind === 'phone' ? '' : 'display:none'}"><span class="mst">${DELAY_MS[kind]} ms</span></div>
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
  el.innerHTML = `
    <style>.scene-6 .icon svg [stroke]{stroke:var(--text-faint)}</style>
    <div class="ground" style="position:absolute;inset:0;background:var(--bg)"></div>
    <div class="sheet" style="position:absolute;inset:0">
      <div class="lifter" style="position:absolute;inset:0">
        <div class="persp" style="position:absolute;inset:0;perspective:${persp}px;perspective-origin:50% 50%">
          <div class="world" style="position:absolute;inset:0;transform-style:preserve-3d;transform-origin:0 0">
            ${order.map(lane).join('')}
          <div class="tline" style="position:absolute;left:${L.tX - 3 * u}px;top:${L.tTop}px;width:${6 * u}px;height:${L.lanes.tv + 70 * u - L.tTop}px;
               background:var(--accent);transform-origin:50% 0;border-radius:${3 * u}px"></div>
          <div class="tlabel" style="position:absolute;left:${L.tX + 30 * u}px;top:${L.tTop - 30 * u}px;transform-origin:${-30 * u}px ${30 * u}px;font:700 ${56 * u}px/1 var(--sans);color:var(--accent)">T</div>
          <div class="anchor" style="position:absolute;left:${L.tX - 13 * u}px;top:${L.tTop - 13 * u}px;width:${26 * u}px;height:${26 * u}px"></div>
          </div>
        </div>
        <div class="persp2" style="position:absolute;inset:0;perspective:${persp}px;perspective-origin:50% 50%">
          <div class="world2" style="position:absolute;inset:0;transform-style:preserve-3d;transform-origin:0 0">
            ${order.map(iconHtml).join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="exv example-tag" style="position:absolute;z-index:3;left:0;top:0;--tag-size:${(portrait ? 22 : 24) * u}px;opacity:0">example values</div>
    <div class="line6" style="position:absolute;z-index:2;left:${portrait ? 70 * u : 128 * u}px;top:${portrait ? 150 * u : 96 * u}px;
         font:700 ${portrait ? 84 * u : 76 * u}px/1.08 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">${portrait ? 'Every device is told<br>one instant…' : 'Every device is told one instant…'}</div>`;

  const perspEl = el.querySelector('.persp');
  const lifter = el.querySelector('.lifter');
  const world2 = el.querySelector('.world2');
  const sheet = el.querySelector('.sheet');
  const line6 = el.querySelector('.line6');
  // The diagram's own ground. Transparent while composition 5's phone is
  // still shrinking into its icon underneath; opaque after, so the house
  // (composition 9, at a lower z) is hidden until the ground opens on it.
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
        root, icon, ackring: q('.ackring'), name: q('.name'), nin: q('.nin'), nms: q('.nms'), rule: q('.rule'), tick: q('.tick'), flash: q('.flash'), bar: q('.bar'),
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
  // 9:16: the close-up's push starts as the rush lands (no settle to rest), so the close-up never sits still.
  const push7 = (t) => (portrait ? 0.5 * Math.sin((Math.PI / 2) * span(t, C7, C8)) + 0.5 * sine(span(t, C7, C8)) : sine(span(t, C7 + 0.2, C8)));
  const camB = (t) => ({
    // 9:16: the lane fills the width, high in the frame (the line sits under it).
    s: (portrait ? 570 * u : 1300 * u) / barPhone * lerp(1, 1.06, push7(t)),
    fx: L.tX,
    fy: L.lanes.phone,
    px: (portrait ? W - 125 * u : 1650 * u) - 40 * u * push7(t),
    // 9:16 sits lower, so the group and the line below it share the frame's height.
    py: portrait ? 900 * u : 470 * u,
    tilt: 0,
    rot: 0,
  });
  const camC = (t) => {
    const k = sine(span(t, C8 + 0.6, DRIFT_END));
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
  /** Where the dot (T) sits once the camera is frozen for the lift: a constant, measured once at build (below). */
  let frozenDot = null;
  /** Where the dot (T) sits on the resting plane: set each frame, the same value from LIFT0 on. */
  let restDot = null;
  /**
   * The lift at time t: the sheet's growth g about T (ox, oy), its rise dy,
   * and its opacity; null before it. Each point of the sheet moves on a
   * straight line away from T and up, with progress k^LIFT_EASE: it starts
   * gently and accelerates up and out of the top. It holds its brightness for
   * two thirds of the way (so the frame never dips while the house comes up)
   * and fades only in the last third, gone by LIFT[1].
   */
  const liftAt = (t) => {
    const k = span(t, ...LIFT);
    if (k <= 0) return null;
    const m = k ** LIFT_EASE;
    const O = frozenDot ?? restDot ?? { x: W / 2, y: 0 };
    const o = k < 2 / 3 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (3 * k - 2));
    return { g: 1 + (LIFT_GROW - 1) * m, ox: O.x, oy: O.y, dy: -LIFT_RISE[portrait ? 'portrait' : 'landscape'] * H * m, o };
  };
  /** A screen point carried by the lift. */
  const lifted = (lf, p) => (lf ? { x: lf.ox + (p.x - lf.ox) * lf.g, y: lf.oy + (p.y - lf.oy) * lf.g + lf.dy } : p);
  /**
   * The clear disc round the dot during the lift (null outside it): whatever
   * of the sheet passes within CLEAR_R of the dot's rim is not drawn there, so
   * nothing on the sheet ever crosses the dot. It opens from the dot's own rim
   * over the lift's first frames, while the sheet has hardly moved.
   */
  const clearAt = (t) => {
    if (t < LIFT[0] || t >= LIFT[1]) return null;
    const p = dotAt(t);
    const e = sine(span(t, ...CLEAR_IN));
    return { x: p.x, y: p.y, r: p.d / 2 + CLEAR_R * u * e, f: Math.max(0.01, CLEAR_F * u * e) };
  };
  const maskOf = (cl) => (cl ? `radial-gradient(circle at ${cl.x}px ${cl.y}px, transparent ${cl.r}px, #000 ${cl.r + cl.f}px)` : 'none');
  sheetLift.at = (t) => {
    if (t < LIFT[0]) return null;
    if (t >= LIFT[1]) return { g: 1, ox: 0, oy: 0, dy: 0, o: 0, clear: null, mask: 'none' };
    const lift = liftAt(t) ?? { g: 1, ox: 0, oy: 0, dy: 0, o: 1 };
    return { ...lift, clear: clearAt(t), mask: maskOf(clearAt(t)) };
  };
  /**
   * A solid thing on the sheet (an icon; composition 8's line) is never cut
   * round the dot as a lane is: as the lift carries it towards the clear disc
   * it fades out whole, and stays out once it has passed. `q` is its outline
   * on screen before the lift (a convex polygon); the result is its opacity
   * factor at t — the least, over the lift so far, of how far its lifted
   * outline was from the disc (a pure function of t: the lift is re-evaluated
   * at fixed steps from its start, never remembered).
   */
  const nearFade = (t, q, nearPx) => {
    if (t < LIFT[0]) return 1;
    let f = 1;
    const n = 16;
    for (let i = 0; i <= n + 1; i += 1) {
      const ti = Math.min(t, LIFT[0] + ((LIFT[1] - LIFT[0]) * i) / n);
      const cl = clearAt(ti);
      if (cl) {
        const lf = liftAt(ti);
        const Q = q.map((p) => lifted(lf, p));
        const side = (a, b2) => (b2.x - a.x) * (cl.y - a.y) - (b2.y - a.y) * (cl.x - a.x);
        const inQ = Q.every((a, j) => side(a, Q[(j + 1) % Q.length]) >= 0) || Q.every((a, j) => side(a, Q[(j + 1) % Q.length]) <= 0);
        const segD = (a, b2) => {
          const dx = b2.x - a.x, dy = b2.y - a.y;
          const k = Math.max(0, Math.min(1, ((cl.x - a.x) * dx + (cl.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
          return Math.hypot(cl.x - a.x - k * dx, cl.y - a.y - k * dy);
        };
        const d = inQ ? 0 : Math.min(...Q.map((a, j) => segD(a, Q[(j + 1) % Q.length])));
        f = Math.min(f, sine(span(d - cl.r - cl.f, 0, nearPx)));
      }
      if (ti >= t) break;
    }
    return f;
  };
  sheetLift.nearFade = nearFade;
  /** How far before the clear disc an icon starts to fade out whole. */
  const ICON_NEAR = 160 * u;
  /**
   * How far before the clear disc a lane (its rule, bar and start marker, one
   * piece) starts to fade out whole: it is gone by the disc's solid rim, ~60 px
   * from the dot's own, so a lane is never seen running on through the dot
   * as a bead on a bar.
   */
  const LANE_NEAR = 70 * u;

  /** Each icon's drawing: how far right of its centre it reaches, in its own pixels (its lane starts just past this). */
  const SVG_BOX = { laptop: { vb: [300, 200], right: 288 }, tv: { vb: [324, 200], right: 318 } };
  const iconBox = (kind) => (kind === 'phone' ? [ic.w, ic.h] : [devW, devH]);
  const iconRight = (kind) => {
    const [bw, bh] = iconBox(kind);
    if (kind === 'phone') return bw / 2;
    const { vb, right } = SVG_BOX[kind];
    const sc = Math.min(bw / vb[0], bh / vb[1]);
    return (right - vb[0] / 2) * sc;
  };
  /** Exposed for the builder's overlap checks only: each icon's outline on screen at the last frame drawn. */
  debug.quads = {};

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

  /** The phone's "90 ms" (over its bar) and its " · 90 ms" (in its name) on the untransformed plane: measured once at build. */
  let MS_BOX = null;
  let NMS_BOX = null;

  const frame = (t) => {
    // The camera holds still for the lift, so the lift alone moves the plane.
    const c = cam(Math.min(t, LIFT0));
    const camTf = `translate(${c.px}px, ${c.py}px) rotateX(${c.tilt}deg) rotateZ(${c.rot}deg) scale3d(${c.s}, ${c.s}, ${c.s}) translate(${-c.fx}px, ${-c.fy}px)`;
    world.style.transform = camTf;
    // The icons ride the same camera, on the same sheet.
    world2.style.transform = camTf;
    // The diagram's own opaque ground: transparent while composition 5's phone
    // is still shrinking into its icon underneath, opaque after, and gone in
    // one frame at GROUND_OFF — never a partial value: a half-opaque layer in
    // the ground colour over an identical ground rounds a level off. The house
    // underneath is unlit (the ground colour) then and comes up with light.
    ground.style.opacity = t >= ICON_LANDS && t < GROUND_OFF ? '1' : '0';
    // '' (inherit), never 'visible': an explicit 'visible' would show through the layer while the film hides it.
    sheet.style.visibility = t < LIFT[1] ? '' : 'hidden';
    // Set at the end of the frame, after T has been measured on the resting plane.
    lifter.style.transform = 'none';
    sheet.style.opacity = '1';
    // While composition 5's phone shrinks into its icon, the lanes and names
    // draw in behind it: none of them is drawn left of the phone's edge. (The
    // camera is still flat and unmoved then, so world x is frame x.) The laptop
    // and TV icons are not clipped: they arrive whole beside the landing phone.
    const clipX = t < ICON_LANDS - 0.04 ? (() => { const r = track.phoneRect(t); return r.x + track.phoneW * r.s + 14 * u; })() : null;
    const clipFrom = (elx, left) => {
      elx.style.clipPath = clipX === null ? 'none' : `inset(0 0 0 ${Math.max(0, clipX - left)}px)`;
    };
    perspEl.style.clipPath = 'none';
    const lift = liftAt(t);
    /** Each lane's ends and each icon's place on the plane this frame (for the builder's overlap check only). */
    const planeSegs = {};
    const iconPlace = {};

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
      // 16:9: the names come in only once the shrinking phone has reached its lane (~10.78), so it never passes over one.
      const nameIn = portrait ? span(t, 10.68, 10.95) : span(t, NAMES_IN, NAMES_IN + 0.25);
      l.name.style.opacity = String(easeOut(nameIn) * (1 - nameAway) * (1 - span(t, ...LABELS_OUT)));
      clipFrom(l.name, portrait ? NAME_R - 600 * u : NAME_X);
      clipFrom(l.rule, L.laneStart);
      l.rule.style.opacity = String((0.7 + 0.3 * ack) * (1 - aside));
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
      const grow = kind === 'phone' ? easeInOut(span(t, C7 + 0.3, C7 + 0.9)) : easeInOut(span(t, ...GROW8[kind]));
      l.bar.style.transform = `scaleX(${Math.max(0.0001, grow)})`;
      l.bar.style.opacity = String(grow > 0 ? 1 : 0);
      // The start marker is never seen at T: it appears out at the bar's far end
      // as the bar reaches the device's own start, and pops in there.
      const pop = span(grow, 0.82, 1);
      // At the hand-over each marker stays on its lane and leaves with the sheet.
      l.start.style.transform = `translateX(${-l.w * grow}px) scale(${pop > 0 ? Math.max(0.0001, 0.4 + 0.6 * easeOut(pop) + 0.25 * Math.sin(Math.PI * pop)) : 0.0001})`;
      l.start.style.opacity = String(pop > 0 ? 1 : 0);
      const landed = kind === 'phone' ? C7 + 0.9 : GROW8[kind][1];
      // The value comes in with its bar and holds (facts.md values only).
      const growFrom = kind === 'phone' ? C7 + 0.3 : GROW8[kind][0];
      // The phone's "90 ms" comes in from 13.30 (as the rush settles), so the close-up never sits still.
      const msFrom = kind === 'phone' ? MS7_IN : growFrom;
      const msOn = easeOut(span(t, msFrom, msFrom + 0.2));
      void landed;
      // Composition 7: the phone's figure over its bar. Composition 8: each
      // figure joins its device's name ("TV · 210 ms") as its bar lands, so no
      // figure is ever nearer another device, and no label sits by T or a bar.
      // The phone's figure never leaves: as the pull back starts, the one
      // "90 ms" over its bar moves and scales into its place in "phone · 90 ms"
      // (LABEL_MOVE, below); only on arriving, on the same pixels, is it the name's.
      const nmsOn = easeOut(span(t, growFrom + 0.12, growFrom + 0.35)) * (kind === 'phone' ? easeOut(span(t, ...LABEL_MOVE)) : span(back, 0.6, 1));
      l.nms.style.opacity = String(nmsOn);
      // The phone's: only its " · " fades in as the figure travels; the figure itself is the travelling one until it lands.
      if (kind === 'phone') l.nms.querySelector('.nnum').style.opacity = t >= LABEL_MOVE[1] ? '1' : '0';
      // Tilted, the labels foreshorten; they grow so they read at ≥ 24 px.
      // 9:16 labels are counter-turned so they read screen-horizontal on the turned plane.
      // The phone's "90 ms" rises a little into place as it fades in.
      const msRise = kind === 'phone' && t < C8 ? `translateY(${(1 - msOn) * 26 * u}px) ` : '';
      l.ms.style.transform = msRise + (portrait
        ? `scale(${lerp(1, 1.5, back)}) rotate(${-c.rot}deg)`
        : `translate(${-24 * u * back}px, ${-22 * u * back}px) scale(${lerp(1, 1.5, back)})`);
      // Gone before the plane lifts, so no label is ever seen over the house.
      l.ms.style.opacity = String(kind === 'phone' ? (t < LABEL_MOVE[1] ? msOn : 0) : msOn * (1 - easeInOut(span(back, 0.03, 0.2))));

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
      l.pulse.style.opacity = String(0.85 * fillOn);
      l.pulse.style.transform = `scaleX(${Math.max(0.0001, easeInOut(rk))})`;

      // In composition 7 the phone stays in shot, pinned enlarged at the lane's left edge.
      // 9:16: every name is counter-turned so it reads screen-horizontal on the
      // turned plane (no-op while the plane is flat), and closes up with its icon.
      // 9:16, composition 8: the names (with their figures) grow to read on a
      // phone screen (~1.4×, from the left), stepping up clear of their lanes.
      const b8 = easeInOut(span(back, 0.55, 1));
      // 16:9: each name sits a little higher over its lane in 8 (clear of it by ~16 px).
      l.nin.style.transform = !portrait && b8 > 0 ? `translateY(${-11 * u * b8}px)` : '';
      // 9:16: in 6 and 7 each name is right-aligned left of its lane, turned
      // to read level; in 8 it moves on to its own lane, as in 16:9 — starting
      // at the lane's start, lying along it on the plane, just above it — and
      // grows so its capitals stand ~30 px tall. One transform about the name's
      // own origin (the end of "phone" for the phone, else its right end).
      let tail = '';
      if (portrait) {
        const g = lerp(1, NAME_GROW, b8);
        const ox = NAME_R - (kind === 'phone' ? NMS_W.phone : 0);
        const oy = nameY(kind) + NAME_FS;
        const left = NAME_R - textW[kind];
        // The laptop's and phone's names start a little left of their lanes'
        // starts, so each "NN ms" ends ≥ 24 px clear of the T line.
        const P = { x: L.laneStart + close8 + { tv: 40, laptop: -26, phone: -22 }[kind] * u, y: L.lanes[kind] - 34 * u };
        const dx = lerp(close8, P.x - ox - NAME_GROW * (left - ox), b8);
        const dy = lerp(0, P.y - oy, b8);
        tail = `translate(${dx}px, ${dy}px) rotate(${-c.rot * (1 - b8)}deg) scale(${g})`;
      }
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
      // The phone's "90 ms" moving into its name (its whole pose — place, size,
      // turn — eased out from where it sits over the bar to where " · 90 ms"
      // sits in the name this frame, both in the plane's own coordinates).
      const mk = kind === 'phone' && MS_BOX ? easeOut(span(t, ...LABEL_MOVE)) : 0;
      if (mk > 0 && mk < 1) {
        const at = (str, o, q) => {
          const m = new DOMMatrix(str || 'none');
          const p = m.transformPoint(new DOMPoint(q.x - o.x, q.y - o.y));
          return { x: o.x + p.x, y: o.y + p.y, s: Math.hypot(m.a, m.b), r: Math.atan2(m.b, m.a) };
        };
        const Q = { x: MS_BOX.right, y: MS_BOX.bottom };
        const a0 = at(l.ms.style.transform, MS_BOX.origin, Q);
        // Through the name's own transform, then its inner span's.
        const n0 = at(l.nin.style.transform, NMS_BOX.ninOrigin, { x: NMS_BOX.right, y: NMS_BOX.bottom });
        const a1 = at(l.name.style.transform, NMS_BOX.origin, n0);
        a1.s *= NMS_BOX.h / MS_BOX.h;
        let dr = a1.r - a0.r;
        while (dr > Math.PI) dr -= 2 * Math.PI;
        while (dr < -Math.PI) dr += 2 * Math.PI;
        const P = { x: lerp(a0.x, a1.x, mk), y: lerp(a0.y, a1.y, mk) };
        const sc = a0.s * (a1.s / a0.s) ** mk;
        const r = a0.r + dr * mk;
        const O = MS_BOX.origin;
        const tx = P.x - O.x - sc * (Math.cos(r) * (Q.x - O.x) - Math.sin(r) * (Q.y - O.y));
        const ty = P.y - O.y - sc * (Math.sin(r) * (Q.x - O.x) + Math.cos(r) * (Q.y - O.y));
        l.ms.style.transform = `translate(${tx}px, ${ty}px) rotate(${r}rad) scale(${sc})`;
      }
      // And takes on the name's colour as it goes, so nothing changes on the hand-over.
      if (kind === 'phone') l.ms.style.color = mk > 0 ? `color-mix(in srgb, ${l.name.style.color} ${(100 * mk).toFixed(1)}%, var(--text-dim))` : '';

      // Composition 8: each lane runs out of its own device, as in 6 and 7 —
      // its grey start touches the icon's edge (the lane only grows leftwards,
      // under nothing). It stays there: at the hand-over the lanes do not move.
      const toEdge = easeInOut(span(back, 0.5, 0.95));
      if (toEdge > 0) ruleS.x = lerp(ruleS.x, Math.min(ruleS.x, place.x + iconRight(kind) * place.m + 12 * u), toEdge);

      // The icon stays on its lane: at the hand-over it leaves with the sheet.
      const ax = kind === 'phone' ? ic.x : L.iconX;
      const [bw, bh] = iconBox(kind);
      l.icon.style.transformOrigin = '50% 50%';
      l.icon.style.transform = `translate(${place.x - ax}px, ${place.y - L.lanes[kind]}px) scale(${place.m})`;
      l.icon.style.opacity = String(iconK);
      // (Its outline on the plane, for the builder's overlap check.)
      iconPlace[kind] = { x: place.x, y: place.y, hw: (bw / 2) * place.m, hh: (bh / 2) * place.m, o: iconK };
      planeSegs[kind] = { ruleS: { ...ruleS }, ruleE: { ...ruleE }, grow, ro: Number(l.rule.style.opacity), so: Number(l.start.style.opacity) };
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
    // One "example values" tag for the figures; in 8 just above the column of
    // "device · ms" names. In 7 it rides just above the phone's "90 ms" and
    // slides with it into the name (LABEL_MOVE); it then sits over
    // "phone · 90 ms" and fades across to 8's place (never sliding over the
    // laptop's name).
    // It rides just above the phone's "90 ms" in 7 and slides with it as it moves into the name (LABEL_MOVE).
    // It comes in with the figure, so the figure is never shown without it.
    const in7 = t < LABEL_MOVE[1] ? easeOut(span(t, MS7_IN, MS7_IN + 0.2)) : 0;
    const inP = t >= LABEL_MOVE[1] ? 1 - span(back, 0.42, 0.52) : 0;
    const slide = easeOut(span(t, ...LABEL_MOVE));
    const in8 = span(back, 0.55, 0.7) * (1 - span(t, ...LABELS_OUT));
    let tagAt = null;
    if (in7 > 0) {
      // Just above the phone's "90 ms", riding with it as it moves into the name.
      const m = lanes.phone.ms.querySelector('.mst').getBoundingClientRect();
      const n = lanes.phone.nin.getBoundingClientRect();
      tagAt = { x: lerp(m.left, n.left, slide), y: lerp(m.top - exv.offsetHeight - 16 * u, n.top - exv.offsetHeight - 14 * u, slide), o: in7 };
    } else if (inP > 0) {
      const n = lanes.phone.nin.getBoundingClientRect();
      tagAt = { x: n.left, y: n.top - exv.offsetHeight - 14 * u, o: inP };
    } else if (in8 > 0) {
      const r = lanes.laptop.nms.getBoundingClientRect();
      const n = lanes.laptop.nin.getBoundingClientRect();
      tagAt = portrait
        ? { x: n.left, y: n.top - exv.offsetHeight - 16 * u, o: in8 }
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

    // Read where T is before the lift moves the plane; from LIFT0 on the
    // camera is frozen, so this is the same point on every later frame.
    const ar = anchor.getBoundingClientRect();
    restDot = { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2, d: Math.min(46 * u, Math.max(24 * u, (ar.width + ar.height) / 2)) };
    // The lift: the sheet — lanes, bars, markers and T together — comes up
    // towards the camera, growing about a point below the frame and rising
    // out of the top, over the house coming up underneath; it holds its
    // brightness at first and fades as it speeds up. (The dot stays where T
    // was: it is measured above, before the lift moves anything.)
    if (lift) {
      lifter.style.transformOrigin = `${lift.ox}px ${lift.oy}px`;
      lifter.style.transform = `translateY(${lift.dy}px) scale(${lift.g})`;
      sheet.style.opacity = String(lift.o);
    }
    // The clear disc round the dot, on the sheet's unmoving frame (screen pixels).
    const clear = clearAt(t);
    sheet.style.maskImage = maskOf(clear);
    sheet.style.webkitMaskImage = maskOf(clear);
    // Each lane's outline on screen (rule, bar and start marker together); the
    // sheet carries every lane up past the dot, and each fades out whole
    // before it reaches the clear disc, staying out once past it (nearFade).
    const laneNear = {};
    for (const kind of order) {
      const g = planeSegs[kind];
      const y = L.lanes[kind];
      const bx = L.tX - lanes[kind].w * g.grow;
      const x0 = Math.min(g.ruleS.x, bx - 15 * u);
      const x1 = Math.max(g.ruleE.x, L.tX);
      const hh = Math.max(barH / 2, 15 * u, ruleH / 2) + Math.abs(g.ruleS.y - y);
      const q0 = [[x0, y - hh], [x1, y - hh], [x1, y + hh], [x0, y + hh]].map(([x, yy]) => project(c, x, yy));
      laneNear[kind] = nearFade(t, q0, LANE_NEAR);
      lanes[kind].root.style.opacity = laneNear[kind] < 1 ? String(laneNear[kind]) : '';
    }
    // Each icon's outline on screen; an icon the sheet carries towards the
    // dot fades out whole before it reaches the clear disc (nearFade).
    for (const kind of order) {
      const P = iconPlace[kind];
      const q0 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => project(c, P.x + sx * P.hw, P.y + sy * P.hh));
      const q = q0.map((p) => lifted(lift, p));
      const near = nearFade(t, q0, ICON_NEAR);
      lanes[kind].icon.style.opacity = String(P.o * near);
      P.q = q;
      P.near = near;
    }
    // For the builder's overlap check only (never read by the film): every
    // line of the sheet still drawn, on screen, with its half-width and opacity.
    debug.segs = [];
    if (t >= GROUND_OFF) {
      const lf = lift ?? { g: 1, o: 1 };
      const S = (x, y) => lifted(lift, project(c, x, y));
      const hw = (px) => (px / 2) * c.s * lf.g;
      for (const kind of order) {
        const g = planeSegs[kind];
        const y = L.lanes[kind];
        const bx = L.tX - lanes[kind].w * g.grow;
        const ln = laneNear[kind];
        debug.segs.push({ kind, what: 'lane', a: S(g.ruleS.x, g.ruleS.y), b: S(g.ruleE.x, g.ruleE.y), r: hw(ruleH), o: g.ro * lf.o * ln });
        debug.segs.push({ kind, what: 'bar', a: S(bx, y), b: S(L.tX, y), r: hw(barH), o: (g.grow > 0 ? 1 : 0) * lf.o * ln });
        debug.segs.push({ kind, what: 'start', a: S(bx, y), b: S(bx, y), r: hw(30 * u), o: g.so * lf.o * ln });
      }
      debug.segs.push({ kind: 'T', what: 'T', a: S(L.tX, L.tTop + shift), b: S(L.tX, L.tTop + tLen * fallK(t) * tTrim), r: hw(6 * u), o: lf.o });
      for (const kind of order) debug.quads[kind] = { o: iconPlace[kind].o * iconPlace[kind].near * lf.o, q: iconPlace[kind].q };
    }
    debug.clear = clear;
  };
  onFrame(frame);

  // Where T is once the camera is frozen for the lift (from LIFT0) — frozenDot,
  // declared above: a constant, measured once per worker at build time, before
  // any frame is drawn, by laying this scene out at the release. Nothing that
  // needs it reads the page layout while frames are drawn.
  waitFor(
    document.fonts.ready.then(() => {
      const prev = el.style.display;
      el.style.display = 'block';
      for (const kind of order) textW[kind] = lanes[kind].nin.offsetWidth;
      // The phone's "90 ms" over its bar and " · 90 ms" in its name, measured
      // once on the untransformed plane (world px): constants.
      const keep = [world, sheet, lanes.phone.ms, lanes.phone.name, lanes.phone.nin].map((e) => e.style.transform);
      for (const e of [world, sheet, lanes.phone.ms, lanes.phone.name, lanes.phone.nin]) e.style.transform = 'none';
      const ox = el.getBoundingClientRect();
      const rel = (r) => ({ left: r.left - ox.left, top: r.top - ox.top, right: r.right - ox.left, bottom: r.bottom - ox.top, h: r.height, w: r.width });
      const pcs = (e, b) => { const [x, y] = getComputedStyle(e).transformOrigin.split(' ').map(parseFloat); return { x: b.left + x, y: b.top + y }; };
      const msText = rel(lanes.phone.ms.querySelector('.mst').getBoundingClientRect());
      MS_BOX = { ...msText, origin: pcs(lanes.phone.ms, rel(lanes.phone.ms.getBoundingClientRect())) };
      const nms = rel(lanes.phone.nms.querySelector('.nnum').getBoundingClientRect());
      NMS_BOX = { ...nms, origin: pcs(lanes.phone.name, rel(lanes.phone.name.getBoundingClientRect())), ninOrigin: pcs(lanes.phone.nin, rel(lanes.phone.nin.getBoundingClientRect())) };
      [world, sheet, lanes.phone.ms, lanes.phone.name, lanes.phone.nin].forEach((e, i) => { e.style.transform = keep[i]; });
      frame(DOT_RELEASE);
      frozenDot = { ...restDot };
      el.style.display = prev;
    }),
  );

  // The dot is the instant T: it lands at the top of the T line and rides the
  // camera exactly, because its place is read from an element in the diagram
  // (the same frame's layout before the lift; the frozen constant from it on).
  const dotAt = (t) => {
    const r = t >= LIFT0 && frozenDot ? frozenDot : restDot;
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
    const p = dotAt(Math.max(t, LIFT0));
    return { x: p.x, y: p.y, d: p.d };
  };
}
