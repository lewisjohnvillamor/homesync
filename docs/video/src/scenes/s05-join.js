/**
 * Composition 5: a phone joins by scanning the invite code.
 *
 * The dot falls out of the mark and the laptop's screen opens from where it
 * lands: the invite QR code (the code is real — it encodes the repository
 * URL). A phone filling the frame height arrives over the code and catches
 * the dot; the code slides into its viewfinder, a scan line crosses it and the
 * brackets flash (scan done, 8.75 s). The phone settles to the right while the
 * laptop moves left; its screen becomes the join screen; the camera pushes in;
 * the dot lands on "Enable audio & join" and presses it (9.375 s, the button
 * sinks, a ripple); the screen becomes the room, with "this device" and the
 * dot beside it (10.0 s).
 *
 * The only legible words are the interface's own (facts F25, F29). Then the
 * whole phone shrinks into the phone lane's icon of the next composition's
 * diagram while the lanes draw in underneath, and the dot rises to become T.
 */

import { span, lerp, BEAT } from '../shared/beats.js';
import { diagramLayout } from '../shared/diagram.js';

/** Visible from 7.98 s (composition 4's mark is gone by then) until the phone is the lane icon. */
export const pad = [0.19, 0.3];

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;

/** Times, on beats where an action happens. */
const REVEAL = 7.94; // the reveal opens as composition 4's arcs and wordmark finish leaving (gone by 7.98)
/** The phone comes in once the reveal has opened most of the frame. */
const ENTER = 8.12;
const SCAN = [8.4, 8.75]; // the scan completes on beat 14
const PRESS = 15 * BEAT; // 9.375
const JOINED = 16 * BEAT; // 10.0
/** The room is held, then the phone becomes the diagram's icon. */
const SHRINK = [10.45, 10.9];
export const ICON_LANDS = SHRINK[1];

/**
 * The diagram's layout for compositions 5–8, with this film's larger icons.
 * Composition 5's phone lands exactly on `phoneIcon`.
 */
export function laneLayout(W, H, u, portrait) {
  const L = diagramLayout(W, H, u, portrait);
  const iconScale = portrait ? 1.2 : 1.5;
  // The lanes end just past T, and the whole diagram — icons to T's label —
  // is centred in the frame, so nothing past T is left empty.
  const iconX0 = portrait ? 130 * u : L.iconX;
  const laneEnd0 = L.tX + (portrait ? 110 * u : 150 * u);
  const left = iconX0 - 90 * u * iconScale;
  const right = laneEnd0 + 30 * u;
  const dx = W / 2 - (left + right) / 2;
  const iconX = iconX0 + dx;
  return {
    ...L,
    iconX,
    iconScale,
    tX: L.tX + dx,
    laneStart: (portrait ? 250 * u : 390 * u) + dx,
    laneEnd: laneEnd0 + dx,
    // 9:16: the lanes spread down the frame, so its lower quarter is not left empty.
    ...(portrait ? { lanes: { laptop: H * 0.45, phone: H * 0.63, tv: H * 0.81 }, tTop: H * 0.45 - 150 * u } : {}),
    phoneIcon: { x: iconX, y: portrait ? H * 0.63 : L.lanes.phone, w: 48 * u * iconScale, h: 96 * u * iconScale },
  };
}

/**
 * A phone, drawn to match the 3D model: aluminium edge, rounded, glass.
 * `inner` is its screen's content. Exported so the diagram's icon is the
 * same object, at a smaller size.
 */
export function phoneHtml(w, h, inner = '') {
  const r = w * 0.17;
  return `<div class="phone" style="position:absolute;width:${w}px;height:${h}px;border-radius:${r}px;
      background:linear-gradient(145deg,var(--text-faint),var(--line-strong) 38%,var(--line) 70%,var(--line-strong));padding:${w * 0.035}px;box-sizing:border-box;
      box-shadow:0 ${w * 0.06}px ${w * 0.2}px #0009">
    <div class="glass" style="position:relative;width:100%;height:100%;border-radius:${r * 0.82}px;overflow:hidden;background:var(--surface)">
      ${inner}
    </div>
  </div>`;
}

/** The room screen: the device list with this device highlighted. Sizes are fractions of the phone's width `pw`. */
export function roomHtml(pw, text = true, textScale = 1) {
  const fs = pw * 0.088;
  return `<div class="room" style="position:absolute;inset:0;background:var(--bg)">
    <div style="position:absolute;left:10%;top:9%;width:38%;height:${fs * 0.5}px;border-radius:${fs}px;background:var(--line-strong)"></div>
    ${[0, 1]
      .map(
        (i) => `<div style="position:absolute;left:8%;right:8%;top:${24 + i * 14}%;height:11%;border-radius:${fs * 0.4}px;background:var(--surface);border:${pw * 0.003}px solid var(--line)">
          <div style="position:absolute;left:9%;top:38%;width:44%;height:${fs * 0.36}px;border-radius:${fs}px;background:var(--line-strong)"></div></div>`,
      )
      .join('')}
    <div class="me" style="position:absolute;left:8%;right:8%;top:52%;height:13%;border-radius:${fs * 0.4}px;background:var(--surface-2);border:${pw * 0.005}px solid var(--accent)">
      ${text ? `<div class="me-text" style="position:absolute;left:9%;top:50%;transform:translateY(-50%);font:600 ${fs * textScale}px/1 var(--sans);color:var(--text);white-space:nowrap">this device</div>` : `<div style="position:absolute;left:9%;top:40%;width:52%;height:${fs * 0.4}px;border-radius:${fs}px;background:var(--text-faint)"></div>`}
    </div>
  </div>`;
}

/**
 * The phone's track on screen, as a pure function of t: shared with composition 6,
 * which reveals its lanes behind the phone as it shrinks into the lane icon.
 */
export function joinTrack(W, H, u, portrait) {
  // --- geometry ------------------------------------------------------------
  const phoneH = portrait ? 1380 * u : 1000 * u;
  const phoneW = phoneH * 0.485;
  const inset = phoneW * 0.035;
  const glassW = phoneW - 2 * inset;
  const glassH = phoneH - 2 * inset;
  const laptop = portrait
    ? { x: 70 * u, y: 100 * u, w: W - 140 * u, h: H * 0.33 }
    : { x: W / 2 - 640 * u, y: 46 * u, w: 1280 * u, h: 840 * u };
  const qrSize = Math.min(laptop.w, laptop.h) * 0.64;
  const qrC0 = { x: laptop.x + laptop.w / 2, y: laptop.y + laptop.h / 2 };
  /** The laptop makes room for the phone after the scan. */
  const laptopShift = (t) => {
    const k = easeInOut(span(t, 8.72, 9.25));
    return portrait ? { x: 0, y: -40 * u * k } : { x: -60 * u * k, y: 0 };
  };

  const rest = portrait ? { x: W / 2 - phoneW / 2, y: H * 0.38 } : { x: 1480 * u - phoneW / 2, y: (H - phoneH) / 2 + 20 * u };
  const over = portrait
    ? { x: W / 2 - phoneW / 2, y: qrC0.y - (inset + 0.3 * glassH + 0.38 * phoneW) }
    : { x: qrC0.x - phoneW / 2, y: rest.y };
  const enter = portrait ? { x: over.x, y: H + 60 * u } : { x: W + 60 * u, y: rest.y };

  // Screen coordinates within the phone (fractions of the glass).
  const button = { x: 0.03, y: 0.65, w: 0.94, h: 0.11 };
  const face = { fx: 0.895, fy: button.y + button.h / 2 }; // where the dot presses: the button's free right end
  const wait = { fx: 0.895, fy: 0.84 }; // where it rides in, below where the button will be
  const indicator = { fx: 0.83, fy: 0.585 };
  const fs = phoneW * 0.088;

  // --- the phone's path, before the camera ----------------------------------
  const phonePose = (t) => {
    if (t < SCAN[0]) {
      const k = easeOut(span(t, ENTER, SCAN[0]));
      return { x: lerp(enter.x, over.x, k), y: lerp(enter.y, over.y, k) };
    }
    // Held over the code, lifting a little in the hand; then to rest.
    const lift = -8 * u * Math.sin(Math.PI * span(t, SCAN[0], 8.75));
    const k = easeInOut(span(t, 8.75, 9.2));
    return { x: lerp(over.x, rest.x, k), y: lerp(over.y + lift, rest.y, k) };
  };

  // The camera pushes in on the phone at rest so the interface's words are
  // ≥ 48 px, keeps creeping in through the hold, and lets go as the phone
  // shrinks. It pushes about a fixed point low on the phone.
  // 16:9 pushes less than before, so the phone reads as a phone (both edges and
  // ground around it), centred in frame; its words are set larger to stay ≥ 48 px.
  const PUSH = portrait ? 1.17 : 1.35;
  const push = (t) => lerp(1, PUSH, easeInOut(span(t, 9.0, 9.6))) * lerp(1, 1.04, span(t, 9.6, SHRINK[0]));
  const O = portrait
    ? { x: rest.x + phoneW / 2, y: rest.y + phoneH * 0.62 }
    : { x: (1060 * u - PUSH * (rest.x + phoneW / 2)) / (1 - PUSH), y: rest.y + phoneH * 0.62 };
  const L = laneLayout(W, H, u, portrait);
  const icon = L.phoneIcon;

  /** The phone on screen: top-left and scale. */
  const phoneRect = (t) => {
    const at = (tt) => {
      const p = phonePose(tt);
      const s = push(tt);
      return { x: O.x + (p.x - O.x) * s, y: O.y + (p.y - O.y) * s, s };
    };
    if (t < SHRINK[0]) return at(t);
    const a = at(SHRINK[0]);
    const s1 = icon.h / phoneH;
    const k = easeInOut(span(t, ...SHRINK));
    const s = a.s * (s1 / a.s) ** k;
    // The centre travels with the same easing, so the phone lands slowly on its slot.
    const c0 = { x: a.x + (phoneW * a.s) / 2, y: a.y + (phoneH * a.s) / 2 };
    const c = { x: lerp(c0.x, icon.x, k), y: lerp(c0.y, icon.y, k) };
    return { x: c.x - (phoneW * s) / 2, y: c.y - (phoneH * s) / 2, s };
  };

  /** A point on the phone's glass, as a fraction of it, in frame pixels. */
  const onGlass = (t, fx, fy) => {
    const r = phoneRect(t);
    return { x: r.x + (inset + fx * glassW) * r.s, y: r.y + (inset + fy * glassH) * r.s, s: r.s };
  };

  return { phoneW, phoneH, inset, glassW, glassH, laptop, qrSize, qrC0, laptopShift, button, face, wait, indicator, fs, push, O, phonePose, phoneRect, onGlass };
}

export function build({ el, u, W, H, portrait, t0, onFrame, hostDot }) {
  const { phoneW, phoneH, inset, glassW, glassH, laptop, qrSize, qrC0, laptopShift, button, face, wait, indicator, fs, push, O, phoneRect, onGlass } = joinTrack(W, H, u, portrait);
  /** 16:9 sets the interface words larger (its push-in is smaller). */
  const tScale = portrait ? 1 : 1.04;
  const roomScale = portrait ? 1 : 1.12;
  /** The press ring's circle: around the dot, inside the button's free right end. */
  const well = button.h * glassH * 0.75;

  // --- the laptop ----------------------------------------------------------
  const lid = 14 * u;
  const laptopHtml = `
    <div class="laptop" style="position:absolute;left:${laptop.x}px;top:${laptop.y}px;width:${laptop.w}px;height:${laptop.h}px">
      <div style="position:absolute;inset:0;border-radius:${24 * u}px;background:linear-gradient(160deg,var(--line-strong),var(--line) 55%,var(--surface-2));
           box-shadow:0 ${20 * u}px ${60 * u}px #000a"></div>
      <div style="position:absolute;inset:${lid}px;border-radius:${14 * u}px;background:radial-gradient(80% 70% at 50% 45%, var(--surface-2), var(--surface));
           box-shadow:inset 0 0 ${50 * u}px #0008"></div>
      <div style="position:absolute;left:50%;top:${lid / 2 - 3 * u}px;width:${6 * u}px;height:${6 * u}px;margin-left:${-3 * u}px;border-radius:50%;background:var(--bg-sunken)"></div>
      <div style="position:absolute;left:${-30 * u}px;right:${-30 * u}px;top:${laptop.h}px;height:${16 * u}px;border-radius:0 0 ${8 * u}px ${8 * u}px;
           background:linear-gradient(var(--line-strong),var(--line))"></div>
      <div style="position:absolute;left:${-30 * u}px;right:${-30 * u}px;top:${laptop.h + 16 * u}px;height:${portrait ? 40 * u : 160 * u}px;
           background:linear-gradient(var(--surface-2),var(--bg));clip-path:polygon(0 0,100% 0,${portrait ? 102 : 106}% 100%,${portrait ? -2 : -6}% 100%)">
        <div style="position:absolute;left:43%;right:43%;top:0;height:${6 * u}px;border-radius:0 0 ${6 * u}px ${6 * u}px;background:var(--line-strong)"></div>
      </div>
    </div>`;

  el.innerHTML = `
    <div class="world" style="position:absolute;inset:0;transform-origin:0 0">
      ${laptopHtml}
      <img class="qr" src="/src/assets/qr-repo.svg" style="position:absolute;left:${qrC0.x - qrSize / 2}px;top:${qrC0.y - qrSize / 2}px;width:${qrSize}px;height:${qrSize}px;
           border-radius:${14 * u}px;image-rendering:pixelated">
    </div>
    <div class="phone-wrap" style="position:absolute;left:0;top:0;transform-origin:0 0">
      ${phoneHtml(
        phoneW,
        phoneH,
        `
        <div class="viewfinder" style="position:absolute;inset:0;overflow:hidden;background:var(--bg-sunken)">
          <div style="position:absolute;inset:0;background:radial-gradient(90% 60% at 50% 45%, var(--surface-2), var(--bg-sunken))"></div>
          <img class="vf-qr" src="/src/assets/qr-repo.svg" style="position:absolute;left:50%;top:30%;width:${phoneW * 0.58}px;height:${phoneW * 0.58}px;margin:${phoneW * 0.09}px 0 0 ${-phoneW * 0.29}px;image-rendering:pixelated;border-radius:${8 * u}px">
          <div class="vf-frame" style="position:absolute;left:12%;right:12%;top:30%;height:${phoneW * 0.76}px;border:${5 * u}px solid var(--text);border-radius:${18 * u}px;box-sizing:border-box"></div>
          <div class="scanline" style="position:absolute;left:10%;right:10%;height:${4 * u}px;background:var(--accent);box-shadow:0 0 ${20 * u}px var(--accent)"></div>
        </div>
        <div class="join" style="position:absolute;inset:0;background:var(--bg)">
          <div style="position:absolute;left:10%;top:9%;width:38%;height:${fs * 0.5}px;border-radius:${fs}px;background:var(--line-strong)"></div>
          <div style="position:absolute;left:10%;top:16%;width:62%;height:${fs * 0.36}px;border-radius:${fs}px;background:var(--line)"></div>
          <div class="btn" style="position:absolute;left:${button.x * 100}%;top:${button.y * 100}%;width:${button.w * 100}%;height:${button.h * 100}%;
               border-radius:${fs * 0.5}px;background:var(--accent);color:var(--accent-ink);box-sizing:border-box;padding-left:${glassW * 0.035}px;
               display:flex;align-items:center;font:600 ${fs * 0.92 * tScale}px/1 var(--sans);white-space:nowrap;letter-spacing:-0.03em;overflow:hidden">Enable audio &amp; join
          <div class="socket" style="position:absolute;left:${((face.fx - button.x) / button.w) * 100}%;top:50%;width:${42 * u}px;height:${42 * u}px;margin:${-21 * u}px 0 0 ${-21 * u}px;
               border-radius:50%;background:var(--accent-ink);opacity:0"></div>
          <div style="position:absolute;left:${((face.fx - button.x) / button.w) * 100}%;top:50%;width:${well}px;height:${well}px;margin:${-well / 2}px 0 0 ${-well / 2}px;
               border-radius:50%;overflow:hidden">
            <div class="ripple" style="position:absolute;left:50%;top:50%;width:${well}px;height:${well}px;margin:${-well / 2}px 0 0 ${-well / 2}px;
               border-radius:50%;border:${4 * u}px solid var(--text);box-sizing:border-box;opacity:0"></div></div></div>
        </div>
        ${roomHtml(phoneW, true, roomScale)}`,
      )}
    </div>`;

  const world = el.querySelector('.world');
  const wrap = el.querySelector('.phone-wrap');
  const viewfinder = el.querySelector('.viewfinder');
  const vfQr = el.querySelector('.vf-qr');
  const vfFrame = el.querySelector('.vf-frame');
  const scanline = el.querySelector('.scanline');
  const join = el.querySelector('.join');
  const btn = el.querySelector('.btn');
  const ripple = el.querySelector('.ripple');
  const socket = el.querySelector('.socket');
  const room = el.querySelector('.room');
  const meText = el.querySelector('.me-text');

  // --- the dot ----------------------------------------------------------------
  // It falls out of the mark to just below the code, is caught by the phone as
  // it arrives, rides in below where the button will be, presses the button's
  // face, then becomes this device's indicator in the list; as the phone
  // shrinks away it rises to become T.
  const HOST = [8.0, SHRINK[0] + 0.05];
  const P0 = portrait ? { x: W / 2, y: 980 * u } : { x: 700 * u, y: 830 * u };
  const D = 36 * u;
  const dotAt = (t) => {
    const catchK = easeInOut(span(t, HOST[0], SCAN[0] + 0.02));
    const onPhone = (() => {
      const toFace = easeInOut(span(t, PRESS - 0.24, PRESS - 0.02));
      const toList = easeInOut(span(t, PRESS + 0.3, JOINED));
      const fy = lerp(lerp(wait.fy, face.fy, toFace), indicator.fy, toList);
      const fx = lerp(lerp(wait.fx, face.fx, toFace), indicator.fx, toList);
      return onGlass(t, fx, fy);
    })();
    const sink = Math.sin(Math.PI * span(t, PRESS - 0.02, PRESS + 0.2));
    return {
      x: lerp(P0.x, onPhone.x, catchK),
      y: lerp(P0.y, onPhone.y, catchK) + sink * 3 * u * onPhone.s,
      d: D * (1 - 0.12 * sink) * lerp(1, 1.1, span(t, JOINED - 0.1, JOINED + 0.1)),
      glow: 0.25 + 0.4 * sink,
    };
  };
  hostDot(HOST[0], HOST[1], dotAt);
  // The laptop's screen opens from where the dot lands, after composition 4 has cleared.
  const irisC = dotAt(HOST[0]);
  // Just far enough to clear the farthest corner, so the opening is seen growing for its whole 0.32 s.
  const irisR = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - irisC.x, y - irisC.y))) + 260 * u;

  onFrame((t) => {
    el.style.opacity = t < REVEAL ? '0' : '1';
    const r = phoneRect(t);
    wrap.style.transform = `translate(${r.x}px, ${r.y}px) scale(${r.s})`;

    // The laptop: opened by an iris from the dot, moved aside, pushed with the camera, then out fast.
    const sh = laptopShift(t);
    const s = push(t);
    const out = span(t, 10.3, 10.55);
    world.style.transform =
      `translate(${O.x}px, ${O.y}px) scale(${s}) translate(${-O.x}px, ${-O.y}px) translate(${sh.x - out * out * 300 * u}px, ${sh.y}px)`;
    // Once the phone has the code, the laptop steps back (dimmed) so the phone leads.
    world.style.opacity = String((1 - out) * lerp(1, 0.38, easeInOut(span(t, 8.95, 9.5))));
    // A soft-edged reveal over 0.32 s; the phone is inside it, so nothing appears outside the opening.
    const ik = span(t, REVEAL, 8.3);
    const ir = lerp(80 * u, irisR, 1 - (1 - ik) ** 2);
    const soft = 260 * u;
    const mask = ik < 1 ? `radial-gradient(circle at ${irisC.x}px ${irisC.y}px, #000 ${Math.max(0, ir - soft)}px, transparent ${ir + 1}px)` : 'none';
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;

    // The viewfinder sees the code where it is relative to the phone: it
    // slides into the brackets as the phone arrives over it, and out as the
    // phone moves on. A little hand shake.
    const vf = onGlass(t, 0.5, 0.3 + (0.38 * phoneW) / glassH);
    const qrC = { x: qrC0.x + sh.x, y: qrC0.y + sh.y };
    const k = 0.9 / r.s;
    vfQr.style.transform =
      `translate(${(qrC.x - vf.x) * k + Math.sin(t * 5) * 4 * u}px, ${(qrC.y - vf.y) * k + Math.cos(t * 4) * 3 * u}px) rotate(${Math.sin(t * 3) * 1.2}deg)`;
    const scanK = easeInOut(span(t, ...SCAN));
    scanline.style.top = `${lerp(31, 29 + (phoneW * 0.76 * 100) / glassH, scanK)}%`;
    scanline.style.opacity = String(t > SCAN[0] - 0.04 && t < SCAN[1] + 0.03 ? 1 : 0);
    // Scan done: the brackets turn accent and snap tight around the code.
    const found = span(t, SCAN[1], SCAN[1] + 0.08);
    vfFrame.style.borderColor = found > 0 ? 'var(--accent)' : 'var(--text)';
    vfFrame.style.transform = `scale(${1 - 0.06 * easeOut(found)})`;

    // Screens, on their beats.
    viewfinder.style.opacity = String(1 - span(t, 8.92, 9.05));
    join.style.opacity = String(span(t, 8.92, 9.05) * (1 - span(t, JOINED - 0.08, JOINED + 0.06)));
    room.style.opacity = String(span(t, JOINED - 0.08, JOINED + 0.06));
    // The press: the button sinks 3 px and a ripple spreads from the dot.
    const sink = Math.sin(Math.PI * span(t, PRESS - 0.02, PRESS + 0.2));
    btn.style.transform = `translateY(${sink * 3 * u}px) scale(${1 - 0.012 * sink})`;
    // Where the dot lands on the button a dark well opens, so the accent dot reads on the accent button.
    const well = span(t, PRESS - 0.16, PRESS - 0.04) * (1 - span(t, PRESS + 0.3, PRESS + 0.45));
    socket.style.opacity = String(well);
    socket.style.transform = `scale(${0.6 + 0.4 * easeOut(well)})`;
    const rip = span(t, PRESS, PRESS + 0.45);
    ripple.style.opacity = String(rip > 0 && rip < 1 ? 0.7 * (1 - rip) : 0);
    // The ring stays inside a circle around the dot, at the button's free end, never over the words.
    ripple.style.transform = `scale(${0.35 + 0.65 * easeOut(rip)})`;
    // As the phone becomes an icon its words go before they would be too small to read.
    if (meText) meText.style.opacity = String(1 - span(t, 10.66, 10.8));
  });
  void t0;
}
