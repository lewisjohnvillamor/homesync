/**
 * The film: every scene on one paused GSAP timeline, seeked frame by frame.
 *
 * Scenes are modules under ./scenes/. Each exports `build(ctx)` and adds its
 * tweens to the shared timeline at absolute times. Nothing animates on its
 * own: the renderer calls `seek(t)` and every pixel is a function of `t`.
 *
 * The dot — the film's carried object — belongs to no scene. Scenes that hold
 * it for a stretch register a host: a time range and a function giving its
 * position, diameter and glow at any `t` in that range. Between hosts the
 * dot flies on an eased path from where the last host left it to where the
 * next one picks it up. Because both ends of every flight are read from the
 * hosts themselves, the dot cannot land on different pixels either side of a
 * handover.
 *
 * Query parameters:
 *   solo=N   show only scene N (component test pages)
 *   debug=1  draw the frame-time and scene number in a corner
 */

import { SCENES, DURATION, clamp01 } from './shared/beats.js';

const params = new URLSearchParams(location.search);
const solo = params.has('solo') ? Number(params.get('solo')) : null;

const W = window.innerWidth;
const H = window.innerHeight;
const portrait = H > W;
/** One unit: a 1080 px design height in landscape, a 1080 px design width in portrait. */
const u = portrait ? W / 1080 : H / 1080;

const stage = document.getElementById('stage');
const dotEl = document.getElementById('dot');
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });

/** Per-frame callbacks, run after the timeline has been seeked. */
const frameHooks = [];
/** Ranges in which a scene owns the dot's position. */
const hosts = [];
/** Ranges in which the dot is hidden (before it is born). */
const ready = [];

function makeScene(scene) {
  const el = document.createElement('div');
  el.className = `scene scene-${scene.id}`;
  el.dataset.scene = String(scene.id);
  stage.appendChild(el);
  return el;
}

const ctx = {
  W,
  H,
  u,
  portrait,
  tl,
  /** Register a callback run on every frame with the frame time. */
  onFrame(fn) {
    frameHooks.push(fn);
  },
  /**
   * Give a scene the dot from `t0` to `t1`. `at(t)` returns
   * `{ x, y, d, glow?, opacity? }` in frame pixels.
   */
  hostDot(t0, t1, at) {
    hosts.push({ t0, t1, at });
  },
  /** Promise a scene can add to before the first frame is drawn. */
  waitFor(promise) {
    ready.push(promise);
  },
};

// --- the dot ----------------------------------------------------------------

const dotInner = dotEl.firstElementChild;

/** Smooth in, smooth out: the dot accelerates away and settles as it arrives. */
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

function dotAt(t) {
  if (!hosts.length) return null;
  const sorted = hosts;
  const inside = sorted.find((h) => t >= h.t0 && t < h.t1);
  if (inside) return inside.at(t);
  if (t < sorted[0].t0) return null;
  // Between two hosts: fly from the end of the earlier to the start of the later.
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.t1 && t < b.t0) {
      const from = a.at(a.t1 - 1e-6);
      const to = b.at(b.t0);
      const k = easeInOut(clamp01((t - a.t1) / (b.t0 - a.t1)));
      const mix = (key, fallback) => (from[key] ?? fallback) + ((to[key] ?? fallback) - (from[key] ?? fallback)) * k;
      // A slight arc rather than a straight line: a carried object that moves
      // in a straight line between two points reads as a cursor, not a thing.
      const lift = Math.sin(Math.PI * k) * Math.min(80 * u, Math.hypot(to.x - from.x, to.y - from.y) * 0.18);
      return { x: mix('x', 0), y: mix('y', 0) - lift, d: mix('d', 20 * u), glow: mix('glow', 0), opacity: mix('opacity', 1) };
    }
  }
  return sorted[sorted.length - 1].at(Math.min(t, sorted[sorted.length - 1].t1 - 1e-6));
}

function drawDot(t) {
  const p = dotAt(t);
  if (!p || (p.opacity ?? 1) <= 0) {
    dotEl.style.visibility = 'hidden';
    return;
  }
  dotEl.style.visibility = 'visible';
  dotEl.style.transform = `translate(${p.x}px, ${p.y}px)`;
  dotInner.style.setProperty('--d', `${p.d}px`);
  dotInner.style.setProperty('--glow', String(p.glow ?? 0));
  dotInner.style.opacity = String(p.opacity ?? 1);
}

// --- scenes -----------------------------------------------------------------

const sceneEls = new Map();

async function build() {
  const { BUILT } = await import('./scenes/index.js');
  for (const scene of SCENES) {
    if (!BUILT.includes(scene.id)) continue;
    const module = await import(`./scenes/s${String(scene.id).padStart(2, '0')}-${scene.name}.js`);
    const el = makeScene(scene);
    sceneEls.set(scene.id, { el, scene, pad: module.pad ?? [0, 0] });
    module.build({ ...ctx, el, scene, t0: scene.t0, t1: scene.t1 });
  }
  hosts.sort((a, b) => a.t0 - b.t0);
  await Promise.all(ready);
  await document.fonts.ready;
}

function showScenes(t) {
  for (const { el, scene, pad } of sceneEls.values()) {
    // `pad` lets a scene be visible a little before its slot or after it,
    // which is how one scene's layer can sit underneath the one in front of
    // it while that one leaves.
    const on = t >= scene.t0 - pad[0] && t < scene.t1 + pad[1];
    const allowed = solo === null || solo === scene.id;
    el.style.visibility = on && allowed ? 'visible' : 'hidden';
  }
}

let debugEl = null;
if (params.get('debug') === '1') {
  debugEl = document.createElement('div');
  debugEl.style.cssText = 'position:absolute;right:16px;bottom:12px;z-index:99;font:500 18px/1 Mono,monospace;color:#64748b';
  document.body.appendChild(debugEl);
}

const built = build();

window.__film = {
  duration: DURATION,
  ready: built,
  seek(t) {
    tl.seek(t, false);
    showScenes(t);
    for (const hook of frameHooks) hook(t);
    if (solo === null || hosts.some((h) => h.t0 <= t && t < h.t1)) drawDot(t);
    else dotEl.style.visibility = 'hidden';
    if (debugEl) {
      const current = SCENES.find((s) => t >= s.t0 && t < s.t1);
      debugEl.textContent = `${t.toFixed(3)} s · comp ${current?.id ?? '-'}`;
    }
  },
};
