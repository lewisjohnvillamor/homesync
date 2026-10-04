/**
 * Composition 11: the terminal.
 *
 * A terminal window fills most of the frame, `$ cargo run --release` already
 * typed, and the dot is its cursor. Enter is pressed on 25.000 s: the cursor
 * dips and drops to the next line. A caption in the film's own type, on its
 * own band over the window, says the build takes a few minutes (F28). On
 * 25.625 s the coordinator prints its LAN address — the README's line with
 * its own padding (F21), tagged as an example — and the cursor drops again.
 * The window pushes in slowly the whole time.
 *
 * Leaving, the printed line collapses into the cursor, the window falls away
 * towards the camera, and the dot is left where it was for composition 12.
 *
 * The window's geometry is a pure function of the frame size (JetBrains Mono
 * advances 0.6 em per character), so composition 12 can ask where the cursor
 * is without this scene having been built.
 */

import { span, lerp, clamp01 } from '../shared/beats.js';

export const pad = [0.18, 0];

const T0 = 24.375;
const ENTER = 25.0;
const PRINT = 25.625;
const COLLAPSE = 26.6;
const GONE = 26.69; // the window starts to fall away
const HOST_END = 26.865;

const CMD = 'cargo run --release';
const LABEL = 'Open on the LAN      : ';
const URL = 'http://192.168.1.50:8080';
const CW = 0.6; // JetBrains Mono advance, in em

const expoOut = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
const cubicOut = (k) => 1 - (1 - k) ** 3;
const cubicIn = (k) => k * k * k;

/** The terminal's layout in frame px, unscaled. */
export function terminalGeo(W, H, u, portrait) {
  const winW = portrait ? 1000 * u : 1680 * u;
  const winH = portrait ? 800 * u : 560 * u;
  const winX = (W - winW) / 2;
  const winY = (H - winH) / 2 + (portrait ? -40 * u : 8 * u);
  const bar = portrait ? 64 * u : 72 * u;
  // In 9:16 the address wraps on to its own line, as it would in a narrow
  // terminal, so the type can be large enough to fill the frame.
  const f = portrait ? 50 * u : 48 * u;
  const padX = portrait ? 48 * u : 72 * u;
  const lineH = f * (portrait ? 2.0 : 1.7);
  const textX = winX + padX;
  const textY = winY + bar + (portrait ? 44 * u : 64 * u);
  // The cursor is about the text's cap height, not a blob beside it.
  return { W, H, u, portrait, winW, winH, winX, winY, bar, f, padX, lineH, textX, textY, cw: f * CW, d: f * 0.66, outRows: portrait ? 2 : 1 };
}

/** The window's scale about the frame centre at time t: arrives, pushes, falls away. */
export function windowScale(t) {
  const arrive = lerp(0.93, 1, expoOut(span(t, T0 - 0.18, T0 + 0.45)));
  const push = lerp(1, 1.09, span(t, T0, COLLAPSE));
  const leave = lerp(1, 2.8, cubicIn(span(t, GONE, 26.875)));
  return arrive * push * leave;
}

/** Where the cursor would sit, unscaled, on line `row` at column `col`. */
function cell(g, row, col) {
  return { x: g.textX + col * g.cw + g.d / 2, y: g.textY + row * g.lineH + g.lineH / 2 };
}

/** The cursor (the film's dot) at time t, in frame px. */
export function cursorAt(t, g) {
  const tt = Math.min(t, GONE);
  // The command ends at column 21 ("$ " + 19 characters); the cursor sits
  // one space after it.
  const a = cell(g, 0, 2 + CMD.length + 0.35);
  const b = cell(g, 1, 0);
  const c = cell(g, 1 + g.outRows, 0);
  const k1y = cubicOut(span(tt, ENTER + 0.02, ENTER + 0.14));
  const k1x = cubicOut(span(tt, ENTER + 0.1, ENTER + 0.3));
  const k2 = cubicOut(span(tt, PRINT - 0.12, PRINT + 0.04));
  let x = lerp(a.x, b.x, k1x);
  let y = lerp(lerp(a.y, b.y, k1y), c.y, k2);
  const s = windowScale(tt);
  x = g.W / 2 + (x - g.W / 2) * s;
  y = g.H / 2 + (y - g.H / 2) * s;
  // The key press: a dip on Enter, a smaller one as the line prints.
  const dip = 1 - 0.22 * Math.sin(Math.PI * span(tt, ENTER - 0.03, ENTER + 0.14)) - 0.1 * Math.sin(Math.PI * span(tt, PRINT - 0.12, PRINT));
  // Waiting for output, the cursor pulses on the beat, as a cursor blinks.
  const blink = 1 + 0.14 * Math.sin(Math.PI * 2 * ((tt - T0) / 0.625)) ** 2 * span(tt, T0 + 0.1, T0 + 0.2) * (1 - span(tt, ENTER - 0.1, ENTER - 0.03))
    + 0.12 * Math.sin(Math.PI * 2 * ((tt - ENTER) / 0.625)) ** 2 * span(tt, ENTER + 0.3, ENTER + 0.4) * (1 - span(tt, PRINT - 0.2, PRINT - 0.12))
    + 0.12 * Math.sin(Math.PI * 2 * ((tt - PRINT) / 0.625)) ** 2 * span(tt, PRINT + 0.15, PRINT + 0.25);
  // Swallowing the printed line, it swells a little and glows.
  const swell = 1 + 0.2 * cubicOut(span(t, COLLAPSE + 0.06, COLLAPSE + 0.24));
  const drift = Math.sin(t * 2.2) * 1.2 * g.u;
  return { x: x + drift, y, d: g.d * s * dip * swell * blink, glow: 0.12 + 0.35 * span(t, COLLAPSE, COLLAPSE + 0.15) };
}

export function build({ el, u, W, H, portrait, t0, hostDot, onFrame }) {
  const g = terminalGeo(W, H, u, portrait);
  const tagSize = Math.round(g.f * 0.6);
  const dotR = portrait ? 9 * u : 10 * u;
  const dots = ['var(--line-strong)', 'var(--line-strong)', 'var(--line-strong)']
    .map((c, i) => `<i style="position:absolute;left:${(portrait ? 30 : 36) * u + i * dotR * 3.2 - dotR}px;top:${g.bar / 2 - dotR}px;width:${dotR * 2}px;height:${dotR * 2}px;border-radius:50%;background:${c}"></i>`)
    .join('');
  const capSize = portrait ? 44 * u : 48 * u;
  el.innerHTML = `
    <div class="win" style="position:absolute;left:${g.winX}px;top:${g.winY}px;width:${g.winW}px;height:${g.winH}px;border-radius:${22 * u}px;
         background:var(--surface);border:${1.5 * u}px solid var(--line);box-sizing:border-box;overflow:hidden;
         box-shadow:0 ${40 * u}px ${120 * u}px ${-20 * u}px var(--bg-sunken)">
      <div style="position:absolute;left:0;right:0;top:0;height:${g.bar}px;background:var(--surface-2);border-bottom:${1.5 * u}px solid var(--line)">${dots}</div>
    </div>
    <div class="txt" style="position:absolute;left:0;top:0;font:400 ${g.f}px/${g.lineH}px var(--mono);white-space:pre;color:var(--text)">
      <div class="l0" style="position:absolute;left:${g.textX}px;top:${g.textY}px"><span style="color:var(--text-dim)">$ </span>${CMD}</div>
      <div class="l1" style="position:absolute;left:${g.textX}px;top:${g.textY + g.lineH}px;display:flex;align-items:center;gap:${g.f * 0.55}px">
        ${
          portrait
            ? `<span><span style="color:var(--text-dim)">${LABEL.trimEnd()}</span><br><span style="color:var(--accent)">${URL}</span></span>
               <span class="example-tag" style="--tag-size:${tagSize}px;position:absolute;left:${(URL.length + 0.8) * g.cw}px;top:${g.lineH * 1.5}px;transform:translateY(-50%)">example</span>`
            : `<span><span style="color:var(--text-dim)">${LABEL}</span><span style="color:var(--accent)">${URL}</span></span>
               <span class="example-tag" style="--tag-size:${tagSize}px">example</span>`
        }
      </div>
    </div>
    <div class="cap band" style="left:50%;top:${g.textY + g.lineH * (portrait ? 3.3 : 3.0)}px;padding:${capSize * 0.5}px ${capSize * 0.95}px;
         border:${1.5 * u}px solid var(--line-strong);border-radius:999px;font:500 ${capSize}px/1 var(--sans);letter-spacing:0.005em;color:var(--text-dim);white-space:nowrap">a few minutes later</div>`;

  const win = el.querySelector('.win');
  const txt = el.querySelector('.txt');
  const l1 = el.querySelector('.l1');
  const cap = el.querySelector('.cap');

  onFrame((t) => {
    const s = windowScale(t);
    const fade = 1 - clamp01((t - 26.8) / 0.075);
    const appear = clamp01((t - (t0 - 0.18)) / 0.2);
    // The window waits under the leaving words; its text comes up once
    // they have cleared, so no word passes over another.
    win.style.opacity = String(appear * fade);
    txt.style.opacity = String(clamp01((t - 24.36) / 0.1) * fade);
    txt.style.transformOrigin = `${W / 2}px ${H / 2}px`;
    win.style.transformOrigin = `${W / 2 - g.winX}px ${H / 2 - g.winY}px`;
    win.style.transform = `scale(${s})`;
    const grow = expoOut(span(t, PRINT - 0.12, PRINT + 0.3));
    win.style.height = `${g.winH * lerp(0.8, 1, grow)}px`;
    txt.style.transform = `scale(${s})`;

    // The printed line: appears whole, as terminal output does, with the
    // briefest settle; then collapses into the cursor below its first cell.
    const shown = t >= PRINT;
    const kc = cubicIn(span(t, COLLAPSE, COLLAPSE + 0.22));
    const settle = 1 - expoOut(span(t, PRINT, PRINT + 0.25));
    l1.style.visibility = shown && kc < 1 ? 'visible' : 'hidden';
    l1.style.opacity = String(clamp01((t - PRINT) / 0.05) * (1 - clamp01((kc - 0.55) / 0.35)));
    l1.style.transformOrigin = `0px ${g.lineH / 2}px`;
    l1.style.transform = `translate(${-6 * u * settle}px, ${g.lineH * g.outRows * kc}px) scale(${1 - 0.92 * kc})`;

    // The caption: in the film's type, on its own band, between the two.
    const C0 = ENTER - 0.06;
    const ci = expoOut(span(t, C0, C0 + 0.4));
    const co = cubicIn(span(t, COLLAPSE, COLLAPSE + 0.12));
    cap.style.visibility = t > C0 && co < 1 ? 'visible' : 'hidden';
    cap.style.opacity = String(clamp01((t - C0) / 0.14) * (1 - co) * fade);
    const capDrift = lerp(0, -8 * u, span(t, C0 + 0.4, COLLAPSE));
    cap.style.transformOrigin = `50% 50%`;
    // Sits inside the window's lower edge as the window grows, scaled with it.
    const capTop = g.winY + g.winH * lerp(0.8, 1, grow) - cap.offsetHeight - 30 * u;
    cap.style.top = `${H / 2 + (capTop - H / 2) * s}px`;
    cap.style.transform = `translate(-50%, ${22 * u * (1 - ci) + capDrift}px)`;
  });

  hostDot(24.45, HOST_END, (t) => cursorAt(t, g));
}
