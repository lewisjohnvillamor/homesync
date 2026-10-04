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
const SUNK = LIFT + 0.22;

const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) ** 3;

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
function paintPlayer(screen, { lit = 0, press = 0, ring = 0, glyph = 1 }) {
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
    ctx.strokeStyle = `rgba(90,169,255,${0.9 * glyph * (1 - ring) ** 1.5})`;
    ctx.lineWidth = m * 0.02 * (1 - ring) + 1;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2 + m * 0.045 * press, r0 * (1 + 0.15 * easeOut(ring)), 0, Math.PI * 2);
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
    const sink = m * 0.045 * press;
    ctx.save();
    ctx.globalAlpha = glyph;
    ctx.translate(w / 2, h / 2);
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

export function build({ el, tl, u, W, H, portrait, onFrame }) {
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
        c1: { el: 40, tg: [0.06, 0.15, 0.0], d0: 3.95, d1: 3.6, orb0: 0.06, orb1: 0.0 },
        c2: { el: 52, tg: [0.04, 0.0, 0.12], d: 4.45, orbDrift: 0.035 },
      }
    : {
        fov: 30,
        c1: { el: 38, tx0: 0.62, tg: [0.25, 0.25, 0.0], d0: 3.95, d1: 3.75, orb0: 0.42, orb1: 0.35 },
        c2: { el: 42, tg: [0.1, 0.0, -0.2], d: 4.6, orbDrift: -0.04 },
      };
  const camera = new THREE.PerspectiveCamera(CAM.fov, W / H, 0.05, 50);

  /** The camera's pose at time t — a pure function of t. */
  function poseCamera(cam, t) {
    const { c1, c2 } = CAM;
    const intro = easeOut(span(t, 0, 1.9));
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

  // --- the devices, one behind another ----------------------------------------
  const LAYOUT = portrait
    ? { x0: -0.55, speed: 0.22, clear: 0.12, dx: { laptop: 0.12, phone: -0.06, tv: 0 }, rows: { laptop: [0, 1.5], phone: [0.95, 2.4], tv: [-1.0, 1.25] }, turn: 0 }
    : { x0: -0.8, speed: 0.5, clear: 0.14, dx: { laptop: 0.28, phone: -0.25, tv: 0 }, rows: { laptop: [0, 1.8], phone: [0.8, 2.6], tv: [-1.0, 1.7] }, turn: 0.2 };
  // Distance from composition 2's camera to each row decides how long a bar
  // must be in metres to look its true length on screen.
  const probe = camera.clone();
  poseCamera(probe, 3.0);
  const depthOf = (z) => -new THREE.Vector3(LAYOUT.x0, 0, z).applyMatrix4(probe.matrixWorldInverse).z;
  const refDepth = depthOf(LAYOUT.rows.laptop[0]);

  // A bar's length is time, never distance. The devices stand in a column
  // clear of the longest bar, and how far each is from the press line has
  // nothing to do with its bar: the laptop (shortest bar) stands farthest
  // away, the TV (longest) no farther than the others, and each marker stops
  // short of its device by a different amount.
  const perSecondOf = (z) => LAYOUT.speed * (depthOf(z) / refDepth);
  const [tvZ, tvS] = LAYOUT.rows.tv;
  const column = LAYOUT.x0 + LATE.tv * perSecondOf(tvZ) + LAYOUT.clear + HALF.tv * tvS;
  const devices = Object.entries(LAYOUT.rows).map(([kind, [z, s]]) => {
    const d = MAKE[kind]();
    const perSecond = perSecondOf(z);
    const x = column + LAYOUT.dx[kind];
    d.group.position.set(x, 0, z);
    d.group.scale.setScalar(s);
    d.group.rotation.y = LAYOUT.turn;
    scene.add(d.group);
    return { ...d, kind, late: LATE[kind], perSecond, x, z, s };
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
  const FOOT = { laptop: [0.34, 0.235], phone: [0.09, 0.06], tv: [0.5, 0.11] };
  for (const d of devices) {
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

  // The press line: one line across the floor, the moment all three were pressed.
  const zs = devices.map((d) => d.z);
  const zMin = Math.min(...zs) - 0.16;
  const zMax = Math.max(...zs) + 0.1;
  const pressLine = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 1), accent(0));
  pressLine.rotation.x = -Math.PI / 2;
  pressLine.renderOrder = 3;
  scene.add(pressLine);
  // The shared start, made explicit: a play mark at the head of the line,
  // pointing the way time runs, and a tick where each bar begins.
  const playShape = new THREE.Shape();
  playShape.moveTo(-0.035, -0.045);
  playShape.lineTo(0.05, 0);
  playShape.lineTo(-0.035, 0.045);
  playShape.closePath();
  const playMark = new THREE.Mesh(new THREE.ShapeGeometry(playShape), accent(0));
  playMark.rotation.x = -Math.PI / 2;
  playMark.position.set(LAYOUT.x0, 0.003, zMin - 0.1);
  playMark.renderOrder = 3;
  scene.add(playMark);
  const ticks = devices.map((d) => {
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.13), accent(0));
    tick.rotation.x = -Math.PI / 2;
    tick.position.set(LAYOUT.x0, 0.0025, d.z);
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
    // The moment this device's sound starts: a burst at its marker.
    d.burst = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.06, 64), accent(0));
    d.burst.rotation.x = -Math.PI / 2;
    d.burst.renderOrder = 4;
    scene.add(d.burst);
    d.rings = Array.from({ length: 3 }, () => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.11, 96), accent(0));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(d.x, 0.002, d.z);
      ring.renderOrder = 2;
      scene.add(ring);
      return ring;
    });
  }

  el.insertAdjacentHTML(
    'beforeend',
    `<div class="dim" style="position:absolute;inset:0;background:var(--bg);opacity:0"></div>
     <div class="headline" style="position:absolute;left:${portrait ? 80 * u : 128 * u}px;top:${portrait ? 150 * u : 104 * u}px;
       font:700 ${portrait ? 88 * u : 80 * u}px/1.05 var(--sans);letter-spacing:-0.025em;color:var(--text)">Press play on all three.</div>`,
  );
  const headline = el.querySelector('.headline');
  const dim = el.querySelector('.dim');
  // Never still while it is read: the line drifts with the camera's ease-in.
  tl.fromTo(headline, { x: 0 }, { x: 14 * u, duration: 1.4, ease: 'sine.out' }, 0);
  tl.fromTo(headline, { y: 0, opacity: 1 }, { y: -60 * u, opacity: 0, duration: 0.24, ease: 'power2.in', immediateRender: false }, 1.38);

  /** Where each device's lag marker sits on the floor at time t. */
  const barLength = (d, t) => Math.max(0.0001, clamp01((t - PRESS) / d.late) * d.late * d.perSecond);
  const markerWorld = (d, t) => new THREE.Vector3(LAYOUT.x0 + barLength(d, t), 0.004, d.z);

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
    t = Math.min(t, LIFT);
    poseCamera(camera, t);
    canvasEl.style.transform = sink > 0 ? `translateY(${90 * u * sink}px) scale(${1 - 0.05 * sink})` : '';
    dim.style.opacity = String(sink);

    // The press: down fast, held a moment, up again as the screens come up.
    const down = easeOut(span(t, PRESS, PRESS + 0.06));
    const up = smooth(span(t, PRESS + 0.16, PRESS + 0.36));
    const press = down * (1 - up);
    const ring = span(t, PRESS, PRESS + 0.45);
    // The shared start line draws in across the press (7 frames, from the
    // back), pulses once at the press, then stays as the origin of every bar.
    const drawn = easeOut(span(t, PRESS - 0.07, PRESS + 0.05));
    const flash = t >= PRESS ? Math.exp(-(t - PRESS) * 7) : 0;
    const lineLen = Math.max(0.0001, (zMax - zMin) * drawn);
    pressLine.scale.set(1 + 2.2 * flash, lineLen, 1);
    pressLine.position.set(LAYOUT.x0, 0.002, zMin + lineLen / 2);
    pressLine.material.opacity = drawn > 0 ? Math.min(1, 0.6 + 0.4 * flash) : 0;
    playMark.material.opacity = 0.85 * smooth(span(t, PRESS - 0.07, PRESS + 0.05));
    playMark.scale.setScalar(1 + 0.6 * flash);
    for (const tick of ticks) tick.material.opacity = 0.75 * smooth(span(t, PRESS, PRESS + 0.1));

    for (const d of devices) {
      // Each screen comes up only when its own sound starts (its marker
      // lands): picture-on is sound-on. Until then its button stays pressed.
      const start = PRESS + d.late;
      const lit = smooth(span(t, start, start + 0.25));
      const glyph = 1 - smooth(span(t, start + 0.05, start + 0.35));
      const held = t < start ? Math.max(press, 0.6 * down) : press * (1 - lit);
      paintPlayer(d.screen, { lit, press: held, ring: t >= PRESS ? ring : 0, glyph });

      // The lag bar: grows from the press line until this device's sound starts.
      const length = barLength(d, t);
      const width = 0.05;
      d.bar.scale.set(length, width, 1);
      d.bar.position.set(LAYOUT.x0 + length / 2, 0.003, d.z);
      d.marker.position.copy(markerWorld(d, t));
      d.bar.material.opacity = t >= PRESS ? 0.9 : 0;
      const arrived = t >= PRESS + d.late && t < LIFT;
      d.marker.scale.setScalar(arrived ? 1 + 0.6 * Math.exp(-(t - PRESS - d.late) * 9) : 0.0001);
      d.marker.material.opacity = arrived ? 1 : 0;
      const b = span(t, PRESS + d.late, PRESS + d.late + 0.4);
      d.burst.position.copy(markerWorld(d, t));
      d.burst.scale.setScalar(1 + 3.5 * easeOut(b));
      d.burst.material.opacity = t >= PRESS + d.late && b < 1 ? 0.9 * (1 - b) ** 1.5 : 0;

      // Rings: only from this device's own moment.
      d.rings.forEach((r, n) => {
        const index = Math.floor((t - start) / PULSE) - n;
        const age = t - (start + index * PULSE);
        if (t < start || index < 0 || age > RING_LIFE) {
          r.material.opacity = 0;
          return;
        }
        const k = age / RING_LIFE;
        const radius = 0.16 + easeOut(k) * 0.62 * Math.sqrt(d.s / 1.6);
        r.geometry.dispose();
        r.geometry = new THREE.RingGeometry(radius, radius + lerp(0.02, 0.006, k), 128);
        r.material.opacity = 0.45 * (1 - k) ** 1.6;
      });
    }
    renderer.render(scene, camera);
  });
}
