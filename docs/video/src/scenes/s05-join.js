/**
 * Composition 5: a phone joins by scanning the invite code.
 *
 * Close: a laptop screen showing the invite QR code fills the left of frame
 * (the code is real — it encodes the repository URL); a phone filling the
 * frame height comes in from the right, passes over the code with the code in
 * its viewfinder while a scan line crosses it, then settles to the right. Its
 * screen becomes the join screen; the dot — which rode in with the phone,
 * waiting where the button would be — presses "Enable audio & join"; the
 * screen becomes the room, with "this device" and the dot beside it.
 *
 * The only legible words are the interface's own (facts F25, F29). Then the
 * phone shrinks into the phone lane's icon of the next composition's diagram.
 */

import { span, lerp, BEAT } from '../shared/beats.js';
import { diagramLayout } from '../shared/diagram.js';

export const pad = [0.15, 0.25];

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;

/** Times, on beats where an action happens. */
const SCAN = [8.32, 8.75]; // the scan completes on beat 14
const PRESS = 15 * BEAT; // 9.375
const JOINED = 16 * BEAT; // 10.0

/**
 * A phone, drawn to match the 3D model: dark aluminium edge, rounded, glass.
 * `inner` is its screen's content. Exported so the diagram's icon is the
 * same object, at a smaller size.
 */
export function phoneHtml(w, h, inner = '') {
  const r = w * 0.17;
  return `<div class="phone" style="position:absolute;width:${w}px;height:${h}px;border-radius:${r}px;
      background:linear-gradient(145deg,#4a5563,#2a313b 40%,#3a434f);padding:${w * 0.035}px;box-sizing:border-box;
      box-shadow:0 ${w * 0.06}px ${w * 0.2}px #0009">
    <div class="glass" style="position:relative;width:100%;height:100%;border-radius:${r * 0.82}px;overflow:hidden;background:#12171f">
      ${inner}
    </div>
  </div>`;
}

export function build({ el, tl, u, W, H, portrait, t0, t1, onFrame, hostDot }) {
  // --- geometry ------------------------------------------------------------
  const phoneH = portrait ? 1380 * u : 1000 * u;
  const phoneW = phoneH * 0.485;
  const rest = portrait ? { x: W * 0.5 - phoneW / 2, y: H * 0.38 } : { x: W * 0.64, y: (H - phoneH) / 2 + 20 * u };
  const laptop = portrait
    ? { x: 70 * u, y: 110 * u, w: W - 140 * u, h: H * 0.34 }
    : { x: -60 * u, y: 70 * u, w: W * 0.6, h: H - 140 * u };
  const qrSize = Math.min(laptop.w, laptop.h) * 0.66;
  const qr = { x: laptop.x + laptop.w / 2 - qrSize / 2, y: laptop.y + laptop.h / 2 - qrSize / 2 };

  // Screen coordinates within the phone (fractions of the glass).
  const button = { x: 0.5, y: 0.7, w: 0.9, h: 0.1 };
  // Interface type, sized so that with the push-in below it is ≥ 48 px on screen.
  const fs = phoneW * 0.088;

  el.innerHTML = `
    <div class="world" style="position:absolute;inset:0">
      <div class="laptop" style="position:absolute;left:${laptop.x}px;top:${laptop.y}px;width:${laptop.w}px;height:${laptop.h}px;
           border-radius:${22 * u}px;background:#0e131a;border:${10 * u}px solid #2a313b;box-sizing:border-box;
           box-shadow:inset 0 0 ${60 * u}px #00000080">
        <div style="position:absolute;inset:0;background:radial-gradient(80% 70% at 50% 45%, #182029, #12171f)"></div>
      </div>
      <img class="qr" src="/src/assets/qr-repo.svg" style="position:absolute;left:${qr.x}px;top:${qr.y}px;width:${qrSize}px;height:${qrSize}px;
           border-radius:${14 * u}px;image-rendering:pixelated">
      <div class="phone-wrap" style="position:absolute;left:0;top:0;transform-origin:0 0">
        ${phoneHtml(
          phoneW,
          phoneH,
          `
          <div class="viewfinder" style="position:absolute;inset:0;overflow:hidden;background:#05070a">
            <div style="position:absolute;inset:0;background:radial-gradient(90% 60% at 50% 45%, #1a2230, #05070a)"></div>
            <img class="vf-qr" src="/src/assets/qr-repo.svg" style="position:absolute;left:50%;top:${30 + 38 * 0.0}%;width:${phoneW * 0.58}px;height:${phoneW * 0.58}px;margin:${phoneW * 0.09}px 0 0 ${-phoneW * 0.29}px;image-rendering:pixelated;border-radius:${8 * u}px">
            <div class="vf-frame" style="position:absolute;left:12%;right:12%;top:30%;height:${phoneW * 0.76}px;border:${4 * u}px solid #e9eef5cc;border-radius:${18 * u}px"></div>
            <div class="scanline" style="position:absolute;left:10%;right:10%;height:${4 * u}px;background:#5aa9ff;box-shadow:0 0 ${20 * u}px #5aa9ff"></div>
          </div>
          <div class="join" style="position:absolute;inset:0;background:#0b0e13">
            <div style="position:absolute;left:10%;top:9%;width:38%;height:${fs * 0.5}px;border-radius:${fs}px;background:#2f3b4a"></div>
            <div style="position:absolute;left:10%;top:16%;width:62%;height:${fs * 0.36}px;border-radius:${fs}px;background:#232c38"></div>
            <div class="btn" style="position:absolute;left:${(button.x - button.w / 2) * 100}%;top:${(button.y - button.h / 2) * 100}%;
                 width:${button.w * 100}%;height:${button.h * 100}%;border-radius:${fs * 0.5}px;background:#5aa9ff;color:#041322;
                 display:flex;align-items:center;justify-content:center;font:600 ${fs * 0.78}px/1 var(--sans);white-space:nowrap;letter-spacing:-0.015em">Enable audio &amp; join</div>
          </div>
          <div class="room" style="position:absolute;inset:0;background:#0b0e13">
            <div style="position:absolute;left:10%;top:9%;width:38%;height:${fs * 0.5}px;border-radius:${fs}px;background:#2f3b4a"></div>
            ${[0, 1]
              .map(
                (i) => `<div style="position:absolute;left:8%;right:8%;top:${24 + i * 14}%;height:11%;border-radius:${fs * 0.4}px;background:#12171f;border:1px solid #232c38">
                  <div style="position:absolute;left:9%;top:38%;width:44%;height:${fs * 0.36}px;border-radius:${fs}px;background:#2f3b4a"></div></div>`,
              )
              .join('')}
            <div class="me" style="position:absolute;left:8%;right:8%;top:52%;height:13%;border-radius:${fs * 0.4}px;background:#182029;border:${2 * u}px solid #5aa9ff66">
              <div style="position:absolute;left:9%;top:50%;transform:translateY(-50%);font:600 ${fs}px/1 var(--sans);color:#e9eef5;white-space:nowrap">this device</div>
            </div>
          </div>`,
        )}
      </div>
    </div>`;

  const world = el.querySelector('.world');
  const wrap = el.querySelector('.phone-wrap');
  const viewfinder = el.querySelector('.viewfinder');
  const vfQr = el.querySelector('.vf-qr');
  const scanline = el.querySelector('.scanline');
  const join = el.querySelector('.join');
  const btn = el.querySelector('.btn');
  const room = el.querySelector('.room');
  const laptopEl = el.querySelector('.laptop');
  const qrEl = el.querySelector('.qr');

  // --- the phone's path ------------------------------------------------------
  // In from the right, over the code (8.15–8.35), hold while the scan runs,
  // then across to rest (8.9–9.2), then — at the end — shrink into the
  // diagram's phone icon (10.35–10.75).
  const icon = diagramLayout(W, H, u, portrait).phoneIcon;
  const over = portrait
    ? { x: W * 0.5 - phoneW / 2, y: qr.y + qrSize / 2 - phoneH * 0.42 }
    : { x: qr.x + qrSize / 2 - phoneW / 2, y: rest.y };
  const enter = portrait ? { x: rest.x, y: H + 40 * u } : { x: W + 60 * u, y: rest.y };
  const phonePose = (t) => {
    let p;
    if (t < 8.35) {
      const k = easeOut(span(t, t0 - 0.1, 8.35));
      p = { x: lerp(enter.x, over.x, k), y: lerp(enter.y, over.y, k), s: 1 };
    } else if (t < 8.9) {
      p = { x: over.x, y: over.y + Math.sin((t - 8.35) * 3) * 4 * u, s: 1 };
    } else if (t < 10.35) {
      const k = easeInOut(span(t, 8.9, 9.25));
      p = { x: lerp(over.x, rest.x, k), y: lerp(over.y, rest.y, k), s: 1 };
    } else {
      // Into the icon: the phone's top-left goes to the icon's, at its scale.
      const k = easeInOut(span(t, 10.35, 10.78));
      const s = lerp(1, icon.h / phoneH, k);
      const target = { x: icon.x - icon.w / 2, y: icon.y - icon.h / 2 };
      p = { x: lerp(rest.x, target.x, k), y: lerp(rest.y, target.y, k), s };
    }
    return p;
  };

  // The camera pushes in on the phone once it is at rest, so the interface's
  // labels are large enough to read (≥ 48 px), and lets go before the shrink.
  const PUSH = portrait ? 1.12 : 1.32;
  const push = (t) => lerp(1, PUSH, easeInOut(span(t, 9.0, 9.55))) * lerp(1, 1 / PUSH, easeInOut(span(t, 10.25, 10.5)));
  // The push is about the phone's centre at rest, so it grows in place.
  const origin = { x: rest.x + phoneW / 2, y: rest.y + phoneH / 2 };

  onFrame((t) => {
    const p = phonePose(t);
    wrap.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.s})`;
    world.style.transformOrigin = `${origin.x}px ${origin.y}px`;
    world.style.transform = `scale(${push(t)})`;

    // The viewfinder shows the code as the phone passes over it: the code's
    // position relative to the phone, magnified a little, as a camera would.
    // The camera's view: the code, small and centred in the brackets, drifting
    // a little with the hand — the way a phone sees a code, not a window
    // through the phone.
    vfQr.style.transform = `translate(${Math.sin(t * 5) * 6 * u}px, ${Math.cos(t * 4) * 5 * u}px) rotate(${Math.sin(t * 3) * 1.5}deg)`;
    const scanK = easeInOut(span(t, ...SCAN));
    scanline.style.top = `${lerp(30, 30 + (phoneW * 0.76 * 100) / (phoneH - phoneW * 0.07), scanK)}%`;
    scanline.style.opacity = String(t > SCAN[0] - 0.05 && t < SCAN[1] + 0.05 ? 1 : 0);

    // Screens, on their beats.
    viewfinder.style.opacity = String(1 - span(t, 8.95, 9.1));
    join.style.opacity = String(span(t, 8.95, 9.1) * (1 - span(t, JOINED - 0.08, JOINED + 0.06)));
    room.style.opacity = String(span(t, JOINED - 0.08, JOINED + 0.06));
    const pressK = span(t, PRESS - 0.02, PRESS + 0.22);
    btn.style.transform = `scale(${1 - 0.07 * Math.sin(Math.PI * pressK)})`;
    btn.style.filter = `brightness(${1 + 0.35 * Math.sin(Math.PI * pressK)})`;

    // The laptop leaves as the phone shrinks away.
    const out = span(t, 10.3, 10.6);
    laptopEl.style.opacity = qrEl.style.opacity = String(1 - out);
  });

  /** A point on the phone's glass, as a fraction of it, in frame pixels. */
  const onGlass = (t, fx, fy) => {
    const p = phonePose(t);
    const s = push(t);
    const inset = phoneW * 0.035;
    const gx = p.x + (inset + fx * (phoneW - 2 * inset)) * p.s;
    const gy = p.y + (inset + fy * (phoneH - 2 * inset)) * p.s;
    // The world scales about the phone's resting centre.
    const ox = origin.x;
    const oy = origin.y;
    return { x: ox + (gx - ox) * s, y: oy + (gy - oy) * s, s: s * p.s };
  };

  // The dot: rides in with the phone waiting where the button will be,
  // presses it, then becomes this device's indicator in the list.
  const indicator = { fx: 0.83, fy: 0.585 };
  hostDot(t0 + 0.1, t1 + 0.12, (t) => {
    // Waits below the button — never over its words — and touches the
    // button's lower edge on the press.
    const touch = Math.sin(Math.PI * span(t, PRESS - 0.16, PRESS + 0.16));
    const atButton = onGlass(t, button.x, lerp(button.y + 0.1, button.y + button.h / 2 - 0.004, touch));
    const atIndicator = onGlass(t, indicator.fx, indicator.fy);
    const toList = easeInOut(span(t, PRESS + 0.25, JOINED + 0.05));
    const press = Math.sin(Math.PI * span(t, PRESS - 0.08, PRESS + 0.2));
    const base = 30 * u * atButton.s;
    return {
      x: lerp(atButton.x, atIndicator.x, toList),
      y: lerp(atButton.y, atIndicator.y, toList),
      d: lerp(base * (1 - 0.25 * press), 26 * u * atIndicator.s, toList),
      glow: 0.5 * press,
    };
  });
}
