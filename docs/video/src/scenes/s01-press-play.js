/**
 * Compositions 1 and 2: three devices on one floor, pressed together, each
 * still starting at its own moment.
 *
 * One continuous camera: at ~35° and easing in through composition 1, rising
 * across the cut to ~52° over the same floor for composition 2, so the
 * devices themselves carry the shot.
 *
 * At the shared press, an accent bar grows on the floor in front of each
 * device until that device's sound actually starts — laptop short, phone
 * longer, TV longest, in the ratio 40 : 90 : 210, slowed eight times so it can
 * be read while the camera rises. Each bar ends in a marker: that device's own "now". Rings spread
 * from a device only from its marker's moment. The markers are published to
 * `handoff` so composition 3 can fly them into its full stop.
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
/** Metres of bar per second of lateness. */
const BAR_SPEED = 0.3;
/** The song's pulse — deliberately not the film's beat. */
const PULSE = 0.56;
const RING_LIFE = 1.5;
/** Visible until composition 3's ground has covered it. */
export const pad = [0, 4 * BEAT];
const VISIBLE_UNTIL = 6 * BEAT + 0.5;

const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) ** 3;

/** A dim paused player: what a screen shows before anybody presses play. */
function paintPlayer(screen, { lit = 0, press = 0, glyph = 1 }) {
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
  // Title line and progress line: the shape of a player, not words.
  ctx.fillStyle = `rgba(148,163,180,${0.55 - 0.25 * lit})`;
  ctx.fillRect(w * 0.12, h * 0.16, w * 0.46, m * 0.035);
  ctx.fillStyle = 'rgba(100,116,139,0.45)';
  ctx.fillRect(w * 0.12, h * 0.84, w * 0.76, m * 0.018);
  ctx.fillStyle = '#5aa9ff';
  ctx.fillRect(w * 0.12, h * 0.84, w * 0.76 * lerp(0.0, 0.18, lit), m * 0.018);
  // The play button: a disc that visibly sinks when pressed.
  if (glyph > 0) {
    const r = m * 0.17 * (1 - 0.22 * press);
    ctx.save();
    ctx.globalAlpha = glyph;
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = `rgba(90,169,255,${0.16 + 0.3 * press})`;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5aa9ff';
    ctx.beginPath();
    ctx.moveTo(-r * 0.36, -r * 0.5);
    ctx.lineTo(r * 0.52, 0);
    ctx.lineTo(-r * 0.36, r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  texture.needsUpdate = true;
}

export function build({ el, tl, u, W, H, portrait, onFrame }) {
  const renderer = makeRenderer(W, H);
  el.appendChild(renderer.domElement);
  const { scene } = makeStage(renderer, { groundTint: GROUND, fogNear: 3.4, fogFar: 9 });

  // A model's proportions, not a spec sheet's: at true scale the phone would
  // be a speck beside the TV.
  const placement = portrait
    ? { tv: [0.05, -1.3, 1.35], laptop: [-0.05, -0.45, 1.5], phone: [0.0, 0.32, 2.4] }
    : { laptop: [-0.85, 0.0, 1.6], phone: [0.0, 0.1, 2.5], tv: [0.88, -0.06, 1.3] };
  // The shared press line the bars grow from: z in landscape, x in portrait.
  const barStart = portrait ? -0.75 : 0.36;
  const devices = Object.entries(placement).map(([kind, [x, z, s]]) => {
    const d = MAKE[kind]();
    d.group.position.set(x, 0, z);
    d.group.scale.setScalar(s);
    d.group.rotation.y = portrait ? 0 : -x * 0.16;
    scene.add(d.group);
    return { ...d, late: LATE[kind], x, z };
  });

  const accent = (opacity = 1) =>
    new THREE.MeshBasicMaterial({ color: BRAND.accent, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false });

  // The press line: one line across the floor, the moment all three were pressed.
  const lineGeo = portrait ? new THREE.PlaneGeometry(0.012, 2.6) : new THREE.PlaneGeometry(2.6, 0.012);
  const pressLine = new THREE.Mesh(lineGeo, accent(0));
  pressLine.rotation.x = -Math.PI / 2;
  pressLine.position.set(portrait ? barStart : 0, 0.002, portrait ? -0.45 : barStart);
  scene.add(pressLine);

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

  const camera = new THREE.PerspectiveCamera(portrait ? 40 : 27, W / H, 0.05, 50);

  el.insertAdjacentHTML(
    'beforeend',
    `<div class="headline" style="position:absolute;left:${portrait ? 80 * u : 128 * u}px;top:${portrait ? 150 * u : 104 * u}px;
       font:700 ${portrait ? 88 * u : 80 * u}px/1.05 var(--sans);letter-spacing:-0.025em;color:var(--text)">Press play on all three.</div>`,
  );
  const headline = el.querySelector('.headline');
  tl.fromTo(headline, { y: 0, opacity: 1 }, { y: -50 * u, opacity: 0, duration: 0.3, ease: 'power2.in' }, 1.6);

  /** The camera's pose at time t — a pure function of t. */
  function poseCamera(cam, t) {
    const target = new THREE.Vector3();
    const rise = smooth(span(t, 1.45, 2.3));
    const elevation = lerp(35, 52, rise) * (Math.PI / 180);
    const ease = easeOut(span(t, 0, 1.9));
    const distance = lerp(lerp(portrait ? 4.4 : 3.0, portrait ? 4.1 : 2.8, ease), portrait ? 4.3 : 3.35, rise);
    const orbit = lerp(0, portrait ? 0.03 : -0.08, span(t, 0, 3.75));
    target.set(0, lerp(0.2, 0.0, rise), portrait ? -0.35 : lerp(-0.12, 0.2, rise));
    cam.position.set(
      target.x + Math.sin(orbit) * distance * Math.cos(elevation),
      target.y + distance * Math.sin(elevation),
      target.z + Math.cos(orbit) * distance * Math.cos(elevation),
    );
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }

  /** Where each device's lag marker sits on the floor at time t. */
  function markerWorld(d, t) {
    const length = Math.max(0.0001, clamp01((t - PRESS) / d.late) * d.late * BAR_SPEED);
    return portrait ? new THREE.Vector3(barStart + length, 0.004, d.z + 0.32) : new THREE.Vector3(d.x, 0.004, barStart + length);
  }

  // Composition 3 asks where the markers are in the frame at a given time.
  // Computed with a camera of its own, so asking never disturbs this one.
  const probe = camera.clone();
  handoff.markersAt = (t) => {
    poseCamera(probe, t);
    return devices.map((d) => {
      const world = markerWorld(d, t);
      const p = toScreen(world, probe, W, H);
      const pxPerMetre = H / (2 * Math.tan((probe.fov * Math.PI) / 360) * probe.position.distanceTo(world));
      return { x: p.x, y: p.y, d: 0.09 * pxPerMetre };
    });
  };

  onFrame((t) => {
    // Nothing of this scene is on screen after its layer is gone; skip the
    // texture painting and rendering rather than pay for them every frame.
    if (t >= VISIBLE_UNTIL) return;
    poseCamera(camera, t);

    const pressK = clamp01((t - PRESS) / 0.22);
    const press = t >= PRESS ? Math.sin(Math.PI * pressK) : 0;
    const lit = smooth(span(t, PRESS + 0.08, PRESS + 0.4));
    const glyph = t < PRESS + 0.1 ? 1 : 1 - smooth(span(t, PRESS + 0.1, PRESS + 0.45));
    pressLine.material.opacity = 0.55 * smooth(span(t, PRESS, PRESS + 0.15));

    for (const d of devices) {
      paintPlayer(d.screen, { lit, press, glyph });

      // The lag bar: grows from the press until this device's sound starts.
      const grown = clamp01((t - PRESS) / d.late) * d.late;
      const length = Math.max(0.0001, grown * BAR_SPEED);
      const width = 0.05;
      if (portrait) {
        d.bar.scale.set(length, width, 1);
        d.bar.position.set(barStart + length / 2, 0.003, d.z + 0.32);
        d.marker.position.set(barStart + length, 0.004, d.z + 0.32);
      } else {
        d.bar.scale.set(width, length, 1);
        d.bar.position.set(d.x, 0.003, barStart + length / 2);
        d.marker.position.set(d.x, 0.004, barStart + length);
      }
      d.bar.material.opacity = t >= PRESS ? 0.9 : 0;
      const arrived = t >= PRESS + d.late;
      d.marker.scale.setScalar(arrived ? 1 + 0.6 * Math.exp(-(t - PRESS - d.late) * 9) : 0.0001);
      d.marker.material.opacity = arrived ? 1 : 0;

      // Rings: only from this device's own moment.
      const start = PRESS + d.late;
      d.rings.forEach((ring, n) => {
        const index = Math.floor((t - start) / PULSE) - n;
        const age = t - (start + index * PULSE);
        if (t < start || index < 0 || age > RING_LIFE) {
          ring.material.opacity = 0;
          return;
        }
        const k = age / RING_LIFE;
        const r = 0.2 + easeOut(k) * 0.8;
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(r, r + lerp(0.022, 0.006, k), 128);
        ring.material.opacity = 0.5 * (1 - k) ** 1.6;
      });

    }
    renderer.render(scene, camera);
  });
}
