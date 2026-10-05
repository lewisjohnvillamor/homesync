/**
 * Compositions 1 and 2: three devices on one floor, pressed together, each
 * still starting at its own moment.
 *
 * The devices stand one behind another on a lit studio floor — TV at the
 * back, laptop in the middle, phone in front — so that their lag bars can
 * all run the same way, across the picture, from one shared press line. One
 * continuous camera: ~35° and easing in through composition 1, seen a little
 * from the side; rising across the cut to ~50° and swinging square to the
 * floor for composition 2, so the devices themselves carry the shot.
 *
 * At the shared press every play button sinks (with a small ring), and an
 * accent bar grows from the press line towards each device until that
 * device's sound actually starts — laptop short, phone longer, TV longest, in
 * the ratio 40 : 90 : 210, slowed eight times so it can be read while the
 * camera rises. Each bar's world length is corrected for its distance from the
 * camera, so on screen the three lengths keep that ratio. Each bar ends in a
 * marker at its device: that device's own "now". Rings spread from a device
 * only from its marker's moment. The markers are published to `handoff` so
 * composition 3 can lift them off the floor and fly them into its full stop;
 * as it does, the floor sinks and darkens away underneath.
 *
 * s02-echo.js adds only composition 2's line.
 */

import * as THREE from 'three';
import { BEAT, span, lerp, clamp01 } from '../shared/beats.js';
import { makeRenderer, makeStage, MAKE, BRAND, toScreen } from '../shared/three-kit.js';
import { handoff } from '../shared/handoff.js';
import { DEVICE_SVG, ASPECT } from '../shared/devices.js';

export const PRESS = 1 * BEAT;
/** Late starts: 40, 90 and 210 ms, shown eight times slower so the growth spans the camera's rise. */
export const LATE = { laptop: 0.32, phone: 0.72, tv: 1.68 };
/** Floor albedo, tuned by measuring the rendered frame against #0b0e13. */
export const GROUND = '#1d1d1f';
/** The song's pulse — deliberately not the film's beat. */
const PULSE = 0.56;
const RING_LIFE = 1.5;
/** Visible until composition 3's ground has covered it. */
export const pad = [0, 4 * BEAT];
const VISIBLE_UNTIL = 6 * BEAT + 0.5;
/** Composition 3 takes the markers from here on; the floor sinks away. */
const LIFT = 6 * BEAT - 0.35;
/** The floor stays visible under the incoming words until the beat. */
const SUNK = 6 * BEAT - 0.01;

const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) ** 3;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/** Half-widths and footprint depths of the models at scale 1 (three-kit.js). */
const HALF = { laptop: 0.17, phone: 0.045, tv: 0.31 };
const DEPTH = { laptop: 0.24, phone: 0.06, tv: 0.11 };

/** A radial gradient on a canvas, for the floor's light pool and the contact shadows. */
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [at, colour] of stops) grad.addColorStop(at, colour);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** A dim paused player: what a screen shows before anybody presses play. */
function paintPlayer(screen, { lit = 0, press = 0, dip = 1, ring = 0, glyph = 1 }) {
  const { ctx, canvas, texture } = screen;
  const w = canvas.width;
  const h = canvas.height;
  const m = Math.min(w, h);
  ctx.fillStyle = `rgb(${Math.round(lerp(14, 22, lit))}, ${Math.round(lerp(18, 30, lit))}, ${Math.round(lerp(25, 44, lit))})`;
  ctx.fillRect(0, 0, w, h);
  if (lit > 0) {
    const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
    g.addColorStop(0, `rgba(90,169,255,${0.42 * lit})`);
    g.addColorStop(1, 'rgba(90,169,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // The press ring, behind the player's lines so it never crosses them.
  if (glyph > 0 && ring > 0 && ring < 1) {
    const r0 = m * 0.17 * 1.35;
    // Fades in over 3 frames once the button is down, so the press reads as
    // a sink first, then a ring.
    ctx.strokeStyle = `rgba(90,169,255,${0.9 * glyph * smooth(Math.min(1, ring / 0.12)) * (1 - ring) ** 1.5})`;
    ctx.lineWidth = m * 0.02 * (1 - ring) + 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2 + m * 0.045 * press, r0 * (1 + 0.05 * easeOut(ring)), 0, Math.PI * 2);
    ctx.stroke();
  }
  // Title line and progress line: the shape of a player, not words.
  ctx.fillStyle = `rgba(148,163,180,${0.55 - 0.25 * lit})`;
  ctx.fillRect(w * 0.12, h * 0.16, w * 0.46, m * 0.035);
  ctx.fillStyle = 'rgba(100,116,139,0.45)';
  ctx.fillRect(w * 0.12, h * 0.84, w * 0.76, m * 0.018);
  ctx.fillStyle = '#5aa9ff';
  ctx.fillRect(w * 0.12, h * 0.84, w * 0.76 * lerp(0.0, 0.18, lit), m * 0.018);
  // The play button: a raised disc that visibly sinks when pressed — it
  // drops, loses its raised edge and darkens — and sends out one ring.
  if (glyph > 0) {
    const r = m * 0.17;
    const sink = m * 0.07 * press;
    ctx.save();
    ctx.globalAlpha = glyph;
    ctx.translate(w / 2, h / 2);
    ctx.scale(dip, dip);
    // The raised edge: a lighter rim under the disc that the press closes.
    ctx.fillStyle = `rgba(148,163,180,${0.32 * (1 - press)})`;
    ctx.beginPath();
    ctx.arc(0, m * 0.045, r * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgb(${Math.round(lerp(24, 16, press))}, ${Math.round(lerp(46, 34, press))}, ${Math.round(lerp(76, 60, press))})`;
    ctx.beginPath();
    ctx.arc(0, sink, r * 1.35 * (1 - 0.06 * press), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = press > 0 ? `rgb(${Math.round(lerp(90, 160, press))}, ${Math.round(lerp(169, 205, press))}, 255)` : '#5aa9ff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.36, sink - r * 0.5);
    ctx.lineTo(r * 0.52, sink);
    ctx.lineTo(-r * 0.36, sink + r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  texture.needsUpdate = true;
}

export function build({ el, tl, u, W, H, portrait, onFrame, waitFor }) {
  const renderer = makeRenderer(W, H);
  el.appendChild(renderer.domElement);
  const canvasEl = renderer.domElement;
  const { scene, key, rim, ground } = makeStage(renderer, { groundTint: GROUND, fogNear: 3.6, fogFar: 8.5 });
  // A stronger rim, behind and to the right, so every silhouette is drawn off the floor.
  rim.intensity = 5;
  rim.position.set(4, 4.5, -7);
  // The key, higher and nearer overhead than the shared rig's, so each
  // device's shadow falls under it rather than off to one side.
  key.position.set(-3.5, 9, 3.5);

  // A studio floor: a soft pool of light under the devices that falls off to
  // exactly the measured ground colour, so the edge of frame is still the
  // brand background. The map multiplies a brighter albedo; its rim is the
  // tuned ground.
  const POOL = 2.4;
  /** The pool's rim, darker than 1 to take back what the stronger rim light adds to the floor. */
  const EDGE = 170;
  const albedo = new THREE.Color(GROUND);
  ground.material.color = albedo.clone().multiplyScalar(POOL);
  const pool = radialTexture([
    [0, `rgb(255,255,255)`],
    [0.45, `rgb(${Math.round(255 * 0.62)},${Math.round(255 * 0.62)},${Math.round(255 * 0.62)})`],
    [1, `rgb(${Math.round(EDGE / POOL)},${Math.round(EDGE / POOL)},${Math.round(EDGE / POOL)})`],
  ]);
  // The pool covers ~5 m of the 80 m ground, centred under the devices.
  const poolSize = portrait ? 4.2 : 4.4;
  pool.repeat.set(80 / poolSize, 80 / poolSize);
  pool.offset.set(0.5 - (0.5 * 80) / poolSize, 0.5 - (0.5 * 80) / poolSize);
  ground.material.map = pool;
  ground.material.needsUpdate = true;

  // --- the camera: a pure function of t ------------------------------------
  const CAM = portrait
    ? {
        fov: 40,
        c1: { el: 46, tg: [-0.12, 0.15, -0.28], d0: 4.15, d1: 3.85, orb0: 0.06, orb1: 0.0 },
        c2: { el: 52, tg: [-0.12, 0.0, -0.3], d: 4.4, orbDrift: 0.035 },
      }
    : {
        fov: 30,
        c1: { el: 34, tg: [0.2, 0.3, -0.2], d0: 3.95, d1: 3.6, orb0: 0.1, orb1: 0.04 },
        c2: { el: 44, tg: [0.2, 0.05, -0.2], d: 4.15, orbDrift: -0.03 },
      };
  const camera = new THREE.PerspectiveCamera(CAM.fov, W / H, 0.05, 50);

  /** The camera's pose at time t — a pure function of t. */
  function poseCamera(cam, t) {
    const { c1, c2 } = CAM;
    // A clear ease-in from frame one: most of it in the first 0.6 s.
    const intro = easeOut(span(t, 0, 1.2));
    // The rise starts early, while the bars grow, so they are read from above.
    const rise = smooth(span(t, 1.05, 2.3));
    const after = span(t, 2.3, 3.75);
    const elevation = lerp(c1.el, c2.el, rise) * (Math.PI / 180);
    const distance = lerp(lerp(c1.d0, c1.d1, intro), c2.d * lerp(1, 0.965, after), rise);
    const orbit = lerp(lerp(c1.orb0, c1.orb1, intro), c2.orbDrift * after, rise);
    // Frame one is framed on the devices; the camera drifts across to take in
    // the floor where the press line will be drawn, arriving as it is.
    const tx1 = lerp(c1.tx0 ?? c1.tg[0], c1.tg[0], smooth(span(t, 0, 0.56)));
    const target = new THREE.Vector3(lerp(tx1, c2.tg[0], rise), lerp(c1.tg[1], c2.tg[1], rise), lerp(c1.tg[2], c2.tg[2], rise));
    cam.position.set(
      target.x + Math.sin(orbit) * distance * Math.cos(elevation),
      target.y + distance * Math.sin(elevation),
      target.z + Math.cos(orbit) * distance * Math.cos(elevation),
    );
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }

  // --- the devices and their lag bars ---------------------------------------
  const LAYOUT = portrait
    ? {
        // 9:16: the devices in a centred column, TV at the back; each lane
        // lies on the floor directly in front of its own device, running
        // across from one shared press line at the left. No bar points at
        // or ends at any device.
        shared: true,
        x0: -0.5,
        tvBar: 0.42 * LATE.tv,
        icon: 0.05,
        place: { tv: [0.12, -1.18, 1.15], laptop: [0.12, -0.1, 1.4], phone: [0.12, 0.85, 2.35] },
        rows: { tv: -0.86, laptop: 0.22, phone: 1.07 },
        turn: 0,
      }
    : {
        // 16:9: the three devices stand side by side across the floor, the
        // TV at the back. Each one's lag bar starts at its own left foot and
        // runs along the floor just in front of it, ending well short of the
        // next device: one subject, each "now" under its own device.
        shared: false,
        tvBar: 0.98,
        place: { tv: [-0.92, -0.66, 2.0], laptop: [0.5, -0.3, 2.15], phone: [1.22, 0.22, 3.3] },
        turn: 0,
      };
  /** Each model's left foot (x) and front edge (z), at scale 1. */
  const FOOT_X = { tv: 0.22, laptop: 0.17, phone: 0.045 };
  const FRONT_Z = { tv: 0.055, laptop: 0.1175, phone: 0.03 };
  /** Where a device's bar starts on the floor, and which line it runs along. */
  const laneOf = (kind) => {
    const [x, z, s] = LAYOUT.place[kind];
    if (LAYOUT.shared) return { bx0: LAYOUT.x0, lane: LAYOUT.rows[kind] };
    return { bx0: x - FOOT_X[kind] * s, lane: z + FRONT_Z[kind] * s + 0.075 };
  };

  // A bar's length is time, never distance. Its length in metres is solved
  // so that, seen by composition 2's camera, the three bars measure exactly
  // 210 : 40 : 90 on screen, whatever their distance from the camera.
  const probe = camera.clone();
  poseCamera(probe, 3.0);
  const screenLen = (bx0, lane, len) => {
    const a = toScreen(new THREE.Vector3(bx0, 0, lane), probe, W, H);
    const b = toScreen(new THREE.Vector3(bx0 + len, 0, lane), probe, W, H);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const tvLane = laneOf('tv');
  const pxPerLate = screenLen(tvLane.bx0, tvLane.lane, LAYOUT.tvBar) / LATE.tv;
  const solveLength = (kind) => {
    const { bx0, lane } = laneOf(kind);
    const want = pxPerLate * LATE[kind];
    let lo = 0;
    let hi = 4;
    for (let n = 0; n < 60; n += 1) {
      const mid = (lo + hi) / 2;
      if (screenLen(bx0, lane, mid) < want) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const devices = Object.keys(LAYOUT.place).map((kind) => {
    const d = MAKE[kind]();
    const [x, z, s] = LAYOUT.place[kind];
    d.group.position.set(x, 0, z);
    d.group.scale.setScalar(s);
    d.group.rotation.y = LAYOUT.turn;
    scene.add(d.group);
    const { bx0, lane } = laneOf(kind);
    return { ...d, kind, late: LATE[kind], full: solveLength(kind), x, z, s, bx0, lane };
  });

  const accent = (opacity = 1) =>
    new THREE.MeshBasicMaterial({ color: BRAND.accent, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false });

  // Contact shadows: a soft dark footprint under each device, so nothing
  // seems to float even where the key light's shadow falls behind it.
  const contact = radialTexture([
    [0, 'rgba(0,0,0,1)'],
    [0.5, 'rgba(0,0,0,0.8)'],
    [0.8, 'rgba(0,0,0,0.25)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  contact.colorSpace = THREE.SRGBColorSpace;
  for (const d of devices) {
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false, color: '#000000', opacity: 1 }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.rotation.z = LAYOUT.turn;
    blob.position.set(d.x, 0.0008, d.z);
    blob.scale.set(HALF[d.kind] * d.s * 2.25, DEPTH[d.kind] * d.s * 2.1 + 0.05, 1);
    // The TV's footprint is mostly air between its legs: a softer pool there.
    if (d.kind === 'tv') blob.material.opacity = 0.55;
    blob.renderOrder = 1;
    scene.add(blob);
  }
  // And a tight, dark contact line right under the laptop's base and the
  // phone's stand: a softened rectangle exactly the footprint's size.
  const tightCanvas = document.createElement('canvas');
  tightCanvas.width = tightCanvas.height = 256;
  const tc = tightCanvas.getContext('2d');
  tc.filter = 'blur(9px)';
  tc.fillStyle = 'rgba(0,0,0,0.95)';
  tc.fillRect(22, 22, 212, 212);
  const tight = new THREE.CanvasTexture(tightCanvas);
  tight.colorSpace = THREE.SRGBColorSpace;
  const FOOT = { laptop: [0.34, 0.235], phone: [0.09, 0.06] };
  for (const d of devices.filter((q) => FOOT[q.kind])) {
    const [fw, fd] = FOOT[d.kind];
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tight, transparent: true, depthWrite: false, color: '#000000' }),
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = LAYOUT.turn;
    line.position.set(d.x, 0.001, d.z);
    line.scale.set(fw * d.s * 1.12, fd * d.s * 1.18, 1);
    line.renderOrder = 1;
    scene.add(line);
  }

  // The press line. 9:16: one line across the floor, the moment all three
  // were pressed, dim from frame one, with a tick where each row begins.
  // 16:9: a short line across each bar's start, at each device's left foot,
  // all three drawn at the same instant.
  const zs = devices.map((d) => d.lane);
  const zMin = Math.min(...zs) - 0.16;
  const zMax = Math.max(...zs) + 0.1;
  /** Half the length of a 16:9 start line, across its bar. */
  const STUB = 0.11;
  const pressLines = (LAYOUT.shared ? [{ bx0: LAYOUT.x0, from: zMin, len: zMax - zMin }] : devices.map((d) => ({ bx0: d.bx0, from: d.lane - STUB, len: 2 * STUB }))).map((p) => {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 1), accent(0));
    line.rotation.x = -Math.PI / 2;
    line.renderOrder = 3;
    scene.add(line);
    const base = new THREE.Mesh(new THREE.PlaneGeometry(0.01, p.len), accent(0.22));
    base.rotation.x = -Math.PI / 2;
    base.position.set(p.bx0, 0.0018, p.from + p.len / 2);
    base.renderOrder = 3;
    scene.add(base);
    return { ...p, line };
  });
  const ticks = devices.map((d) => {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.13), accent(0));
    tick.rotation.x = -Math.PI / 2;
    tick.position.set(d.bx0, 0.0025, d.lane);
    tick.renderOrder = 3;
    scene.add(tick);
    return tick;
  });

  for (const d of devices) {
    d.bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), accent(0.9));
    d.bar.rotation.x = -Math.PI / 2;
    d.bar.renderOrder = 3;
    scene.add(d.bar);
    d.marker = new THREE.Mesh(new THREE.CircleGeometry(0.045, 48), accent(1));
    d.marker.rotation.x = -Math.PI / 2;
    d.marker.renderOrder = 4;
    scene.add(d.marker);
    d.rings = Array.from({ length: 3 }, () => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.11, 96), accent(0));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d.x, 0.002, d.z);
      ring.renderOrder = 2;
      scene.add(ring);
      return ring;
    });
  }

  // Each lane's device icon, printed on the floor at the lane's start (the
  // film's own device drawings, strokes lifted to the dim text colour), so the
  // lane reads as that device's own start time, in the same perspective.
  const ICON_DEPTH = 0.13;
  for (const d of LAYOUT.shared ? devices : []) {
    const svg = DEVICE_SVG[d.kind]().replaceAll('#2f3b4a', '#94a3b4').replaceAll('#3a4757', '#94a3b4');
    const ch = 256;
    const cw = Math.round(ch * ASPECT[d.kind]);
    const cnv = document.createElement('canvas');
    cnv.width = cw;
    cnv.height = ch;
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const img = new Image();
    waitFor(
      new Promise((resolve) => {
        img.onload = () => {
          cnv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          tex.needsUpdate = true;
          resolve();
        };
        img.onerror = resolve;
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', `<svg width="${cw}" height="${ch}" xmlns="http://www.w3.org/2000/svg" `))}`;
      }),
    );
    const w = ICON_DEPTH * ASPECT[d.kind];
    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(w, ICON_DEPTH),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0.85 }),
    );
    icon.rotation.x = -Math.PI / 2;
    icon.position.set(LAYOUT.x0 - LAYOUT.icon - w / 2, 0.0022, d.lane);
    icon.renderOrder = 3;
    scene.add(icon);
  }

  /** The "starts" tag's height, fixed so placing it never reads layout. */
  const TAG_H = 32 * u;
  /** The marker's radius in metres, and its largest scale (the landing overshoot). */
  const MARKER_R = 0.045;
  const OVERSHOOT = 1.6;
  /** Clear space between a tag and its marker at the marker's largest. */
  const TAG_GAP = 16 * u;
  el.insertAdjacentHTML(
    'beforeend',
    `<div class="lbl lbl-press" style="position:absolute;left:0;top:0;font:500 ${22 * u}px/1 var(--mono);letter-spacing:0.04em;color:var(--text-dim);white-space:nowrap">pressed</div>
     ${devices.map(() => `<div class="lbl lbl-start" style="position:absolute;left:0;top:0;font:500 ${22 * u}px/1 var(--mono);letter-spacing:0.04em;color:var(--text-dim);white-space:nowrap;box-sizing:border-box;height:${TAG_H}px;padding:${5 * u}px ${8 * u}px;border-radius:${6 * u}px;background:rgba(11,14,19,0.88)">starts</div>`).join('')}
     <div class="dim" style="position:absolute;inset:0;background:var(--bg);opacity:0"></div>
     <div class="headline" style="position:absolute;left:${portrait ? 80 * u : 128 * u}px;${portrait ? `top:${150 * u}px` : `bottom:${104 * u}px`};
       font:700 ${portrait ? 88 * u : 80 * u}px/1.05 var(--sans);letter-spacing:-0.025em;color:var(--text)">Press play on all three.</div>`,
  );
  const headline = el.querySelector('.headline');
  const dim = el.querySelector('.dim');
  const lblPress = el.querySelector('.lbl-press');
  const lblStart = [...el.querySelectorAll('.lbl-start')];
  // Never still while it is read: the line drifts with the camera's ease-in.
  tl.fromTo(headline, { x: 0 }, { x: 18 * u, duration: 1.5, ease: 'sine.out' }, 0);
  tl.fromTo(headline, { y: 0, opacity: 1 }, { y: (portrait ? -60 : 60) * u, opacity: 0, duration: 0.2, ease: 'power2.in', immediateRender: false }, 1.5);

  /** Where each device's lag marker sits on the floor at time t. */
  const barLength = (d, t) => Math.max(0.0001, clamp01((t - PRESS) / d.late) * d.full);
  const markerWorld = (d, t) => new THREE.Vector3(d.bx0 + barLength(d, t), 0.004, d.lane);

  // Composition 3 asks where the markers are in the frame at a given time.
  // Computed with a camera of its own, so asking never disturbs this one.
  const ask = camera.clone();
  handoff.markersAt = (t) => {
    poseCamera(ask, t);
    return devices.map((d) => {
      const world = markerWorld(d, t);
      const p = toScreen(world, ask, W, H);
      const pxPerMetre = H / (2 * Math.tan((ask.fov * Math.PI) / 360) * ask.position.distanceTo(world));
      return { x: p.x, y: p.y, d: 0.09 * pxPerMetre };
    });
  };

  onFrame((t) => {
    // Nothing of this scene is on screen after its layer is gone; skip the
    // texture painting and rendering rather than pay for them every frame.
    if (t >= VISIBLE_UNTIL) return;
    // The floor sinks and darkens away as composition 3 lifts the markers off
    // it; the picture itself holds its last state while it goes.
    const sink = smooth(span(t, LIFT, SUNK));
    // Every label is gone before any marker lifts (by 3.36 s).
    const labelsOut = 1 - smooth(span(t, LIFT - 0.22, LIFT - 0.04));
    t = Math.min(t, LIFT);
    poseCamera(camera, t);
    canvasEl.style.transform = sink > 0 ? `translateY(${90 * u * sink}px) scale(${1 - 0.05 * sink})` : '';
    devices.forEach((d, i) => {
      // Interface-style labels, not claims: where each row's sound starts.
      // Right after its own marker, on the lane's line, arriving with it —
      // and always clear of the marker at its largest (the landing
      // overshoot), measured in frame pixels at this frame's camera.
      const mw = markerWorld(d, t);
      const m = toScreen(mw, camera, W, H);
      const edge = toScreen(mw.clone().add(new THREE.Vector3(MARKER_R * OVERSHOOT, 0, 0)), camera, W, H);
      const ls = lblStart[i];
      ls.style.transform = `translate(${edge.x + TAG_GAP}px, ${m.y - TAG_H / 2}px)`;
      ls.style.opacity = String(smooth(span(t, PRESS + d.late, PRESS + d.late + 0.15)) * labelsOut);
    });
    if (LAYOUT.shared) {
      // "pressed" at the far end of the shared start line.
      const head = toScreen(new THREE.Vector3(LAYOUT.x0, 0, zMin), camera, W, H);
      lblPress.style.transform = `translate(${head.x - 50 * u}px, ${head.y - 40 * u}px)`;
    } else {
      // 16:9: centred under the TV's start line, the first of the three.
      const tv = devices[0];
      const head = toScreen(new THREE.Vector3(tv.bx0, 0, tv.lane + STUB), camera, W, H);
      lblPress.style.transform = `translate(${head.x}px, ${head.y + 10 * u}px) translateX(-50%)`;
    }
    lblPress.style.opacity = String(smooth(span(t, PRESS, PRESS + 0.2)) * labelsOut);
    // The floor stays at ~40 % until the beat; the incoming words sweep it away.
    dim.style.opacity = String(0.6 * sink);

    // The press: the button eases down over ~5 frames while the whole
    // button dips 3 % in scale, holds, then eases back up with a small
    // rebound; only once it is fully down does the ring go out.
    const down = easeInOut(span(t, PRESS - 0.05, PRESS + 0.035));
    const up = easeInOut(span(t, PRESS + 0.13, PRESS + 0.33));
    const press = down * (1 - up);
    const dip = 1 - 0.03 * press + 0.015 * Math.sin(Math.PI * up);
    const ring = span(t, PRESS + 0.05, PRESS + 0.5);
    // The shared start line draws in across the press (7 frames, from the
    // back), pulses once at the press, then stays as the origin of every bar.
    const drawn = easeOut(span(t, PRESS - 0.07, PRESS + 0.05));
    const flash = t >= PRESS ? Math.exp(-(t - PRESS) * 7) : 0;
    for (const p of pressLines) {
      const lineLen = Math.max(0.0001, p.len * drawn);
      p.line.scale.set(1 + 2.2 * flash, lineLen, 1);
      p.line.position.set(p.bx0, 0.002, p.from + lineLen / 2);
      p.line.material.opacity = drawn > 0 ? Math.min(1, 0.6 + 0.4 * flash) : 0;
    }
    for (const tick of ticks) tick.material.opacity = lerp(0.3, 0.8, smooth(span(t, PRESS, PRESS + 0.1)));

    for (const d of devices) {
      // Each screen comes up only when its own sound starts (its marker
      // lands): picture-on is sound-on. Until then its button stays pressed.
      const start = PRESS + d.late;
      const lit = smooth(span(t, start, start + 0.2));
      // The paused button clears on the frame the marker lands.
      const glyph = t < start ? 1 : 0;
      // A visible sink-and-return on every button at the press.
      const held = press;
      paintPlayer(d.screen, { lit, press: held, dip, ring: t >= PRESS ? ring : 0, glyph });

      // The lag bar: grows from the press line until this device's sound starts.
      const length = barLength(d, t);
      const width = 0.05;
      d.bar.scale.set(length, width, 1);
      d.bar.position.set(d.bx0 + length / 2, 0.003, d.lane);
      d.marker.position.copy(markerWorld(d, t));
      d.bar.material.opacity = t >= PRESS ? 0.9 : 0;
      const arrived = t >= PRESS + d.late && t < LIFT;
      d.marker.scale.setScalar(arrived ? 1 + (OVERSHOOT - 1) * Math.exp(-(t - PRESS - d.late) * 9) : 0.0001);
      d.marker.material.opacity = arrived ? 1 : 0;

      // Rings: only from this device's own moment.
      d.rings.forEach((r, n) => {
        const index = Math.floor((t - start) / PULSE) - n;
        const age = t - (start + index * PULSE);
        if (t < start || index < 0 || age > RING_LIFE) {
          r.material.opacity = 0;
          return;
        }
        const k = age / RING_LIFE;
        const radius = 0.16 + easeOut(k) * (portrait ? 0.42 : 0.62) * Math.sqrt(d.s / 1.6);
        r.geometry.dispose();
        r.geometry = new THREE.RingGeometry(radius, radius + lerp(0.02, 0.006, k), 128);
        r.material.opacity = 0.45 * (1 - k) ** 1.6;
      });
    }
    renderer.render(scene, camera);
  });
}
