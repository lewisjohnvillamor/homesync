/**
 * Composition 9: "Play the same music, in time, on every device in your
 * house." — the cure, replayed in a real house (signature moment 3).
 *
 * A small two-room architectural model on a plinth, roof off, seen from the
 * house camera (HOUSE_VIEW) that composition 8 tilts to. Inside, the same
 * three device models as compositions 1–2: the laptop on the kitchen table,
 * the TV on a low cabinet, the phone on the bedroom nightstand.
 *
 * The dot drops in and hovers above the middle of the house; beneath it a
 * level plane of light at its height is the instant T. Above each device a
 * bar rises at one shared speed, its length that device's delay (the 8×
 * slowed 40 : 90 : 210 of composition 1), each starting from its own disc —
 * the TV's first and lowest, then the phone's, then the laptop's — so all
 * three tops touch the plane together at HOUSE_TOUCH. Vertical, because it is
 * time, never distance across the floor. Then the dot rises towards the
 * camera and composition 10 takes it.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { span, lerp, clamp01, rng } from '../shared/beats.js';
import { makeRenderer, makeStage, MAKE, BRAND, toScreen } from '../shared/three-kit.js';
import { HOUSE_VIEW, HOUSE_VIEW_PORTRAIT, HOUSE_TOUCH } from '../shared/house-view.js';
import { LATE } from './s01-press-play.js';
import { handoff } from '../shared/handoff.js';

/** Visible from 17.825 s, when composition 8's plane lifts off it, to just past the cut. */
/** Drawn from 17.4 s, fully lit, underneath composition 8's diagram, so the diagram lifts off a scene that is already there. */
export const pad = [0.725, 0.075];

const DEG = Math.PI / 180;
const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - (1 - k) ** 3;
const easeIn = (k) => k * k * k;

/** The dot's host range. */
const HOST = [17.9, 21.875];
/** The dot has dropped and settled. */
const SETTLE = 18.6;

// --- the model, in model units -------------------------------------------------

const PLINTH_TOP = 0.2;
const FLOOR_T = 0.04;
/** Top of the floor boards. */
const Y0 = PLINTH_TOP + FLOOR_T;
const WALL_H = 0.7;
const WALL_T = 0.08;
const HOUSE_W = 4.6;
const HOUSE_D = 2.5;
/** The partition between kitchen (−x) and bedroom (+x). */
const PART_X = 0.1;
/** The instant T: the plane of light, above the floor. */
const T_HEIGHT = 2.2;
const T_Y = Y0 + T_HEIGHT;

/** Model units of bar per second of (slowed) delay — one speed for all three. */
const RISE = 0.72;
/** Bar radius, model units. */
const BAR_R = 0.045;

/** Warm matte off-white, like a card or plaster model. */
const wallMat = () => new THREE.MeshStandardMaterial({ color: '#d8d1c4', roughness: 0.93, metalness: 0 });

function box(w, h, d, mat, x, y, z, { radius = 0, cast = true } = {}) {
  const geo = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

/** Oak boards, drawn once from a seeded generator over the whole floor: one image, never tiled. */
function oakFloor() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = Math.round((2048 * HOUSE_D) / HOUSE_W);
  const g = canvas.getContext('2d');
  const r = rng(9);
  const pxPerUnit = canvas.width / HOUSE_W;
  const row = 0.13 * pxPerUnit;
  g.fillStyle = '#b8936a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += row) {
    let x = -r() * 1.2 * pxPerUnit;
    while (x < canvas.width) {
      const len = (0.6 + r() * 0.9) * pxPerUnit;
      const l = 0.93 + r() * 0.14;
      g.fillStyle = `rgb(${Math.round(184 * l)}, ${Math.round(140 * l)}, ${Math.round(96 * l)})`;
      g.fillRect(x, y, len, row);
      // Grain: a few faint lengthwise strokes.
      for (let i = 0; i < 5; i += 1) {
        g.fillStyle = `rgba(110, 78, 46, ${0.05 + r() * 0.07})`;
        g.fillRect(x, y + r() * row, len, 1 + r() * 1.5);
      }
      // Board end joint.
      g.fillStyle = 'rgba(80, 56, 34, 0.45)';
      g.fillRect(x, y, 2, row);
      x += len;
    }
    // Long seam.
    g.fillStyle = 'rgba(80, 56, 34, 0.5)';
    g.fillRect(0, y, canvas.width, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0 });
}

/** A lit player, as the screens stood at the end of composition 2: same progress on all three. */
function paintPlaying(screen, progress) {
  const { ctx, canvas, texture } = screen;
  const w = canvas.width;
  const h = canvas.height;
  const m = Math.min(w, h);
  ctx.fillStyle = 'rgb(22, 30, 44)';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(90,169,255,0.42)');
  g.addColorStop(1, 'rgba(90,169,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(148,163,180,0.3)';
  ctx.fillRect(w * 0.12, h * 0.16, w * 0.46, m * 0.035);
  ctx.fillStyle = 'rgba(100,116,139,0.45)';
  ctx.fillRect(w * 0.12, h * 0.84, w * 0.76, m * 0.03);
  ctx.fillStyle = '#5aa9ff';
  ctx.fillRect(w * 0.12, h * 0.84, w * 0.76 * progress, m * 0.03);
  texture.needsUpdate = true;
}

/** The plane of light: a soft-edged level with a brighter rim, drawn once. */
function planeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.round((1024 * HOUSE_D) / HOUSE_W);
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
  // three.js reads an alpha map from its green channel: grey on black.
  grad.addColorStop(0, 'rgb(40,40,40)');
  grad.addColorStop(1, 'rgb(16,16,16)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // A glowing edge: a soft halo inside a bright line.
  for (let i = 0; i < 14; i += 1) {
    g.strokeStyle = `rgba(255,255,255,${0.06 + (i === 13 ? 0.9 : 0)})`;
    g.lineWidth = i === 13 ? 5 : 30 - i * 2;
    g.strokeRect(0, 0, w, h);
  }
  return new THREE.CanvasTexture(canvas);
}

export function build({ el, tl, u, W, H, portrait, t0, t1, onFrame, hostDot }) {
  /** Where the dot hovers on T, in plan: over open floor (16:9: the kitchen's
   * front corner; 9:16: the doorway), never over furniture. */
  const DOT_XZ = portrait ? [1.45, 0.05] : [0.6, -0.45];
  // Underneath composition 6's diagram, which lifts away to reveal the house.
  el.style.zIndex = '-1';
  const renderer = makeRenderer(W, H);
  el.appendChild(renderer.domElement);
  const { scene, ground, key, rim } = makeStage(renderer);
  // A stronger, warmer-edged rim than the device shots: it draws the walls'
  // top edges off the dark ground like a lit architectural model.
  rim.intensity = 6.5;
  rim.position.set(-2.5, 3.2, -7);
  // A warm, low grazing light from behind-right catches the wall tops and
  // bevels, so the model reads as a lit object rather than flat card.
  const graze = new THREE.DirectionalLight('#ffd9a8', 2.4);
  graze.position.set(5, 2.2, -4);
  scene.add(graze);
  // No fog: the model sits in a seamless brand-coloured room. The floor only
  // takes the plinth's shadow, so everything around the model is exactly the
  // background colour.
  // Fog in the ground colour, used only for the house's entry (see the frame
  // hook); far past everything once it has emerged.
  scene.fog = new THREE.Fog(BRAND.bg.clone(), 1000, 2000);
  ground.material = new THREE.ShadowMaterial({ opacity: 0.32 });
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 9;

  const house = new THREE.Group();
  scene.add(house);

  // Plinth: a darker base under the whole model, softly bevelled.
  const plinthMat = new THREE.MeshStandardMaterial({ color: '#2b2722', roughness: 0.42, metalness: 0.08 });
  house.add(box(HOUSE_W + 0.5, PLINTH_TOP, HOUSE_D + 0.5, plinthMat, 0, 0, 0, { radius: 0.05 }));

  // Floor slab, boards on top; the walls stand on the plinth around it, so no seam shows.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(HOUSE_W - 0.02, FLOOR_T, HOUSE_D - 0.02), [
    wallMat(), wallMat(), oakFloor(), wallMat(), wallMat(), wallMat(),
  ]);
  floor.position.set(0, PLINTH_TOP + FLOOR_T / 2, 0);
  floor.receiveShadow = true;
  house.add(floor);

  const wall = wallMat();
  const wh = WALL_H + FLOOR_T;
  const xL = -HOUSE_W / 2 + WALL_T / 2;
  const xR = HOUSE_W / 2 - WALL_T / 2;
  const zB = -HOUSE_D / 2 + WALL_T / 2;
  const zF = HOUSE_D / 2 - WALL_T / 2;
  const innerD = HOUSE_D - 2 * WALL_T;
  // Back wall.
  house.add(box(HOUSE_W, wh, WALL_T, wall, 0, PLINTH_TOP, zB, { radius: 0.018 }));
  // Front wall.
  house.add(box(HOUSE_W, wh, WALL_T, wall, 0, PLINTH_TOP, zF, { radius: 0.018 }));
  // Side walls.
  house.add(box(WALL_T, wh, innerD, wall, xL, PLINTH_TOP, 0, { radius: 0.018 }));
  house.add(box(WALL_T, wh, innerD, wall, xR, PLINTH_TOP, 0, { radius: 0.018 }));
  // Partition, with a doorway near the front.
  const pd = [0.35, 0.8];
  const zIn0 = -HOUSE_D / 2 + WALL_T;
  const zIn1 = HOUSE_D / 2 - WALL_T;
  const pt = 0.07;
  house.add(box(pt, wh, pd[0] - zIn0, wall, PART_X, PLINTH_TOP, (pd[0] + zIn0) / 2));
  house.add(box(pt, wh, zIn1 - pd[1], wall, PART_X, PLINTH_TOP, (pd[1] + zIn1) / 2));

  // --- furniture: simple model-maker's blocks -----------------------------------
  const oak = new THREE.MeshStandardMaterial({ color: '#9c7a55', roughness: 0.6 });
  const walnut = new THREE.MeshStandardMaterial({ color: '#5a4332', roughness: 0.55 });
  const paleCab = new THREE.MeshStandardMaterial({ color: '#c9c2b6', roughness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: '#8a8782', roughness: 0.45 });
  const linen = new THREE.MeshStandardMaterial({ color: '#ebe7df', roughness: 0.95 });
  const throwMat = new THREE.MeshStandardMaterial({ color: '#4d5b6b', roughness: 0.95 });
  const rugMat = new THREE.MeshStandardMaterial({ color: '#9d968a', roughness: 1 });

  // Kitchen: a counter along the left wall, a TV on a low cabinet, a table.
  const kLeft = -HOUSE_W / 2 + WALL_T;
  const counterD = 0.34;
  const cab = { x: -1.2, z: zIn0 + 0.17, w: 0.95, h: 0.14, d: 0.3 };
  house.add(box(cab.w, cab.h, cab.d, walnut, cab.x, Y0, cab.z, { radius: 0.01 }));
  const table = { x: -0.78, z: 0.42, w: 0.82, d: 0.52, h: 0.34 };
  house.add(box(table.w, 0.03, table.d, oak, table.x, Y0 + table.h - 0.03, table.z, { radius: 0.006 }));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      house.add(box(0.035, table.h - 0.03, 0.035, oak, table.x + sx * (table.w / 2 - 0.05), Y0, table.z + sz * (table.d / 2 - 0.05)));
    }
  }
  // Two chairs, at the table's ends.
  for (const sx of [-1, 1]) {
    const cx = table.x + sx * (table.w / 2 + 0.17);
    house.add(box(0.24, 0.025, 0.24, oak, cx, Y0 + 0.19, table.z));
    for (const ax of [-1, 1]) {
      for (const az of [-1, 1]) house.add(box(0.025, 0.19, 0.025, oak, cx + ax * 0.1, Y0, table.z + az * 0.1));
    }
    house.add(box(0.025, 0.2, 0.24, oak, cx + sx * 0.108, Y0 + 0.215, table.z));
  }

  // Bedroom: a bed against the back wall, a nightstand beside it, a rug.
  const bed = { x: 1.25, w: 1.0, l: 1.32 };
  const bedZ = zIn0 + bed.l / 2;
  house.add(box(bed.w + 0.04, 0.3, 0.05, oak, bed.x, Y0, zIn0 + 0.025));
  house.add(box(bed.w, 0.1, bed.l, oak, bed.x, Y0, bedZ, { radius: 0.01 }));
  house.add(box(bed.w - 0.04, 0.08, bed.l - 0.06, linen, bed.x, Y0 + 0.1, bedZ + 0.01, { radius: 0.025 }));
  for (const px of [-0.22, 0.22]) house.add(box(0.36, 0.06, 0.2, linen, bed.x + px, Y0 + 0.18, zIn0 + 0.18, { radius: 0.025 }));
  house.add(box(bed.w + 0.02, 0.085, 0.55, throwMat, bed.x, Y0 + 0.1, bedZ + bed.l / 2 - 0.3, { radius: 0.02 }));
  const stand = { x: 2.0, z: zIn0 + 0.17, w: 0.3, h: 0.24, d: 0.28 };
  house.add(box(stand.w, stand.h, stand.d, walnut, stand.x, Y0, stand.z, { radius: 0.01 }));
  const rug = box(1.5, 0.008, 0.62, rugMat, bed.x, Y0, 0.72, { cast: false });

  // --- the three devices, the same models as compositions 1–2 ------------------
  const facing = -0.32;
  const devices = [
    // `top`: the top edge of each model, in its own units (TV frame, laptop lid, phone body).
    { kind: 'tv', scale: 1.55, pos: [cab.x, Y0 + cab.h, cab.z + 0.02], rot: -0.18, top: [0, 0.42, 0] },
    { kind: 'laptop', scale: 1.2, pos: [table.x, Y0 + table.h, table.z + 0.02], rot: facing, top: [0, 0.23, -0.186] },
    { kind: 'phone', scale: 2.1, pos: [stand.x, Y0 + stand.h, stand.z + 0.02], rot: facing, top: [0, 0.163, -0.034] },
  ].map((spec) => {
    const d = MAKE[spec.kind]();
    d.group.position.set(...spec.pos);
    d.group.scale.setScalar(spec.scale);
    d.group.rotation.y = spec.rot;
    house.add(d.group);
    d.group.updateMatrixWorld(true);
    const anchor = d.group.localToWorld(new THREE.Vector3(...spec.top));
    return { ...spec, ...d, anchor, late: LATE[spec.kind] };
  });

  // --- T: the plane of light, the bars, their start discs ---------------------
  const barShadeCanvas = document.createElement('canvas');
  barShadeCanvas.width = 32; barShadeCanvas.height = 1;
  {
    const bg = barShadeCanvas.getContext('2d');
    const gr = bg.createLinearGradient(0, 0, 32, 0);
    gr.addColorStop(0, '#9ccbff'); gr.addColorStop(0.3, '#5aa9ff'); gr.addColorStop(0.7, '#5aa9ff'); gr.addColorStop(1, '#3b7fcc');
    bg.fillStyle = gr; bg.fillRect(0, 0, 32, 1);
  }
  const barShade = new THREE.CanvasTexture(barShadeCanvas);
  barShade.colorSpace = THREE.SRGBColorSpace;
  const accent = (opacity) =>
    new THREE.MeshBasicMaterial({ color: BRAND.accent, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false });

  const planeMat = new THREE.MeshBasicMaterial({
    color: BRAND.accent, alphaMap: planeTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(HOUSE_W, HOUSE_D), planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = T_Y;
  plane.renderOrder = 5;
  scene.add(plane);

  const ringMat = accent(0);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 96), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(DOT_XZ[0], T_Y + 0.004, DOT_XZ[1]);
  ring.renderOrder = 9;
  scene.add(ring);

  for (const d of devices) {
    d.len = d.late * RISE;
    d.start = HOUSE_TOUCH - d.late;
    d.baseY = T_Y - d.len;
    // A bar whose top rises; geometry has its origin at the bottom.
    // A flat ribbon turned to face the camera: square ends, so what shows on
    // screen is exactly the bar's length — a round cylinder's foot would add
    // the same few pixels to every bar and flatten the ratio.
    const geo = new THREE.PlaneGeometry(BAR_R * 2, 1);
    geo.translate(0, 0.5, 0);
    d.bar = new THREE.Mesh(geo, accent(1));
    d.bar.material.side = THREE.DoubleSide;
    // Shaded across its width like a lit rod — lighter edge to the key,
    // darker to the far side — with its middle exactly the brand accent.
    d.bar.material.color.set('#ffffff');
    d.bar.material.map = barShade;
    // Drawn over the model: a device must never hide part of its own bar,
    // or the bar would read shorter than its delay.
    d.bar.material.depthTest = false;
    const { x: ax, y: ay, z: az } = d.anchor;
    d.bar.position.set(ax, d.baseY, az);
    d.bar.renderOrder = 6;
    scene.add(d.bar);
    // Its own start: a small level disc.
    d.disc = new THREE.Mesh(new THREE.CircleGeometry(0.075, 40), accent(1));
    d.disc.rotation.x = -Math.PI / 2;
    d.disc.position.set(ax, d.baseY, az);
    d.disc.renderOrder = 7;
    scene.add(d.disc);
    // Where its top meets T: marked on the plane the moment it arrives.
    d.contact = new THREE.Mesh(new THREE.RingGeometry(0.052, 0.066, 48), accent(1));
    d.contact.rotation.x = -Math.PI / 2;
    d.contact.position.set(ax, T_Y + 0.003, az);
    d.contact.renderOrder = 8;
    scene.add(d.contact);
    // A solid, dim stem from the device up to its disc, so each bar plainly
    // stands on its own device rather than floating.
    const from = ay + 0.03;
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 12);
    stemGeo.translate(0, 0.5, 0);
    d.guide = new THREE.Group();
    // Very faint, so only the bright bar carries length.
    const stem = new THREE.Mesh(stemGeo, new THREE.MeshBasicMaterial({ color: '#161c25', toneMapped: false, fog: false }));
    stem.position.set(ax, from, az);
    d.stem = stem;
    d.stemFrom = from;
    d.guide.add(stem);
    scene.add(d.guide);
  }

  // --- camera --------------------------------------------------------------------
  const camera = new THREE.PerspectiveCamera(HOUSE_VIEW.fov, W / H, 0.1, 80);
  // 9:16: the model sits lower in the frame, under the three-line headline,
  // without changing the camera's angle or distance.
  if (portrait) camera.setViewOffset(W, H, -36 * u, -200 * u, W, H);
  const frame = portrait
    ? { distance: 18.5, elevation: 54, target: new THREE.Vector3(0.1, 0.45, -0.02) }
    : { distance: 9.9, elevation: HOUSE_VIEW.elevation, target: new THREE.Vector3(-0.62, 1.95, -0.05) };

  /** The camera at time t: HOUSE_VIEW at the start, a slow orbit and push, a quicker push as the dot leaves. */
  function poseCamera(cam, t) {
    const x = clamp01((t - 17.8) / (t1 - 17.8));
    const k = x * (1.4 - 0.4 * x);
    const azimuth = ((portrait ? HOUSE_VIEW_PORTRAIT.azimuth : HOUSE_VIEW.azimuth) + 6 * k + 6 * smooth(span(t, HOUSE_TOUCH, 21.5))) * DEG;
    const elevation = frame.elevation * DEG;
    const distance = frame.distance * (1 - (portrait ? 0.1 : 0.06) * k);
    const tg = frame.target;
    cam.position.set(
      tg.x + Math.sin(azimuth) * distance * Math.cos(elevation),
      tg.y + distance * Math.sin(elevation),
      tg.z + Math.cos(azimuth) * distance * Math.cos(elevation),
    );
    cam.lookAt(tg);
    cam.updateMatrixWorld();
  }

  // --- the dot ---------------------------------------------------------------------
  // Over the bedroom's open floor: clear of every bar top and its label.
  const DOT_HOME = new THREE.Vector3(DOT_XZ[0], T_Y, DOT_XZ[1]);
  const plumbGeo = new THREE.CylinderGeometry(0.008, 0.008, T_Y - Y0, 8);
  plumbGeo.translate(0, (T_Y - Y0) / 2, 0);
  // Fades out on its way down, so it never lands on the furniture below.
  const plumbFade = document.createElement('canvas');
  plumbFade.width = 1; plumbFade.height = 64;
  const pf = plumbFade.getContext('2d');
  const pg = pf.createLinearGradient(0, 0, 0, 64);
  pg.addColorStop(0, '#fff'); pg.addColorStop(0.2, '#fff'); pg.addColorStop(0.5, '#000'); pg.addColorStop(1, '#000');
  pf.fillStyle = pg; pf.fillRect(0, 0, 1, 64);
  const plumb = new THREE.Mesh(plumbGeo, accent(0));
  plumb.material.alphaMap = new THREE.CanvasTexture(plumbFade);
  plumb.position.set(DOT_XZ[0], Y0, DOT_XZ[1]);
  // A hairline down to the floor, so the dot plainly hangs at T's height.
  if (portrait) scene.add(plumb);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.14, 32), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthWrite: false }));
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(DOT_XZ[0], Y0 + 0.13, DOT_XZ[1]);
  const probe = camera.clone();
  // Each bar's 3D length is set so its length ON SCREEN, seen from the
  // camera at the touch, is in the true 40 : 90 : 210 ratio — perspective
  // would otherwise lengthen the bar nearest the camera. All three still
  // take exactly their delay to grow, so they meet T together.
  // Calibrated mid-hold, where the bars are read; the slow orbit changes it by < 2 %.
  poseCamera(probe, 20.9);
  // The whole bar's projected length (not the scale at its top: the bars
  // are long enough for perspective to change along them).
  const screenLen = (d, len) => {
    const p0 = toScreen(new THREE.Vector3(d.anchor.x, T_Y, d.anchor.z), probe, W, H);
    const p1 = toScreen(new THREE.Vector3(d.anchor.x, T_Y - len, d.anchor.z), probe, W, H);
    return Math.hypot(p0.x - p1.x, p0.y - p1.y);
  };
  const tv = devices.find((d) => d.kind === 'tv');
  const pxPerSecond = screenLen(tv, tv.late * RISE) / tv.late;
  for (const d of devices) {
    // Bisect for the 3D length whose projection is this bar's share.
    const want = pxPerSecond * d.late;
    let lo = 0;
    let hi = T_HEIGHT;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (screenLen(d, mid) < want) lo = mid;
      else hi = mid;
    }
    d.len = (lo + hi) / 2;
    d.baseY = T_Y - d.len;
    d.bar.position.y = d.baseY;
    d.disc.position.y = d.baseY;
    d.stem.scale.set(1, Math.max(0.0001, d.baseY - d.stemFrom), 1);
  }
  poseCamera(probe, SETTLE);
  const refDistance = probe.position.distanceTo(DOT_HOME);
  const DOT_D = 32 * u;

  /** The dot's 3D point at time t: dropping in, hovering, then rising towards the camera. */
  function dotWorld(t, cam) {
    const p = DOT_HOME.clone();
    // Drop: from above, slowing as it settles onto T.
    p.y += 0.25 * (1 - smooth(span(t, HOST[0], SETTLE + 0.1)));
    // Hover: a slow, small breath so it is never still.
    p.y += 0.025 * Math.sin((t - SETTLE) * 2.4) * smooth(span(t, SETTLE, SETTLE + 0.4));
    // Leave: up and towards the camera, accelerating.
    // After the payoff has been held (~0.7 s past HOUSE_TOUCH); still under way when composition 10 takes it.
    const rise = 0;
    if (rise > 0) {
      const toCam = cam.position.clone().sub(p).normalize();
      p.addScaledVector(toCam, 4.0 * rise);
      p.y += 1.0 * rise;
    }
    return p;
  }

  /** The single pulse at HOUSE_TOUCH: up quickly, back over ~0.4 s. */
  const pulse = (t) => {
    const a = t - HOUSE_TOUCH;
    if (a < 0 || a > 0.4) return 0;
    return a < 0.12 ? smooth(a / 0.12) : 1 - smooth((a - 0.12) / 0.32);
  };

  // Where each 3D device sits on screen, for composition 8's icons to land on.
  const deviceBoxes = devices.map((d) => ({ kind: d.kind, box: new THREE.Box3().setFromObject(d.group) }));
  handoff.houseDevicesAt = (t) => {
    poseCamera(probe, t);
    const out = {};
    for (const { kind, box } of deviceBoxes) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i += 1) {
        const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        const q = toScreen(c, probe, W, H);
        x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
      }
      out[kind] = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    }
    return out;
  };

  // Each device's screen panel, as four world-space corners (as the picture
  // is seen: tl, tr, br, bl), for composition 8's icons to turn onto.
  const screenCorners = devices.map((d) => {
    let panel = null;
    d.group.traverse((o) => { if (o.isMesh && o.material === d.screen.material) panel = o; });
    panel.updateWorldMatrix(true, false);
    const { width: pw, height: ph } = panel.geometry.parameters;
    const at = (x, y) => panel.localToWorld(new THREE.Vector3(x, y, 0));
    return { kind: d.kind, c: { tl: at(-pw / 2, ph / 2), tr: at(pw / 2, ph / 2), br: at(pw / 2, -ph / 2), bl: at(-pw / 2, -ph / 2) } };
  });
  handoff.houseScreensAt = (t) => {
    poseCamera(probe, t);
    const out = {};
    for (const { kind, c } of screenCorners) {
      const q = (v) => { const p = toScreen(v, probe, W, H); return { x: p.x, y: p.y }; };
      out[kind] = { tl: q(c.tl), tr: q(c.tr), br: q(c.br), bl: q(c.bl) };
    }
    return out;
  };

  hostDot(HOST[0], HOST[1], (t) => {
    poseCamera(probe, t);
    const p = dotWorld(t, probe);
    let s = toScreen(p, probe, W, H);
    // Picked up exactly where composition 8 let it go, then eased on to the
    // house's own path.
    const from = handoff.liftDotAt?.(t);
    const kIn = from ? smooth(span(t, HOST[0], HOST[0] + 0.35)) : 1;
    if (kIn < 1) {
      const dd0 = DOT_D * (refDistance / probe.position.distanceTo(p));
      const kx = kIn ** 2;
      const ky = 1 - (1 - kIn) ** 2;
      return { x: lerp(from.x, s.x, kx), y: lerp(from.y, s.y, ky), d: lerp(from.d, dd0, kIn), glow: 0.35 };
    }
    const d = DOT_D * (refDistance / probe.position.distanceTo(p)) * (1 + 0.4 * pulse(t));
    // Leaving: the dot comes forward — swelling as it nears the lens — and
    // settles back on to the exact pixels where composition 10 takes it,
    // while the house lifts away above it.
    const k = span(t, 21.5, HOST[1]);
    const to = handoff.lanDotAt?.(HOST[1]);
    if (k > 0 && to) {
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      const up = 220 * u * Math.sin(Math.PI * Math.min(1, k * 1.15));
      return {
        x: lerp(s.x, to.x, e),
        y: lerp(s.y, to.y, e) - up,
        d: lerp(d, to.d, e) * (1 + 0.9 * Math.sin(Math.PI * Math.min(1, k * 1.15))),
        glow: lerp(0.35, 0.45, k),
      };
    }
    return { x: s.x, y: s.y, d, glow: 0.35 + 0.5 * pulse(t) };
  });

  // --- HTML: the T label and the line ---------------------------------------------
  const lines = portrait
    ? ['Play the same music,', 'in time, on every', 'device in your house.']
    : ['Play the same music, in time,', 'on every device in your house.'];
  const size = portrait ? 84 * u : 70 * u;
  const pad2 = portrait ? [30 * u, 40 * u] : [26 * u, 40 * u];
  el.insertAdjacentHTML(
    'beforeend',
    `<div class="t-label" style="position:absolute;left:0;top:0;padding:${5 * u}px ${12 * u}px;border-radius:${10 * u}px;
        background:rgba(11,14,19,0.82);font:500 ${44 * u}px/1 var(--mono);color:var(--accent);white-space:nowrap">T</div>
     <div class="band" style="left:${portrait ? 60 * u : 96 * u}px;top:${portrait ? 120 * u : 64 * u}px;padding:${pad2[0]}px ${pad2[1] + 10 * u}px ${portrait ? pad2[0] + 8 * u : 24 * u}px ${pad2[1]}px;
        background:rgba(11,14,19,0.9);-webkit-mask-image:linear-gradient(to right,#000 calc(100% - ${24 * u}px),transparent),linear-gradient(to bottom,#000 calc(100% - ${18 * u}px),transparent);-webkit-mask-composite:source-in;mask-image:linear-gradient(to right,#000 calc(100% - ${24 * u}px),transparent),linear-gradient(to bottom,#000 calc(100% - ${18 * u}px),transparent);mask-composite:intersect">
       ${lines.map((l, i) => `<div class="ln ln${i}" style="font:700 ${size}px/1.1 var(--sans);letter-spacing:-0.025em;color:var(--text);white-space:nowrap">${l}</div>`).join('')}
     </div>`,
  );
  const msSize = portrait ? 36 * u : 32 * u;
  const MS = { laptop: 40, phone: 90, tv: 210 };
  for (const d of devices) {
    el.insertAdjacentHTML(
      'beforeend',
      `<div class="ms ms-${d.kind}" style="position:absolute;left:0;top:0;opacity:0;display:flex;align-items:center;gap:${10 * u}px;
          padding:${6 * u}px ${12 * u}px;border-radius:${10 * u}px;background:rgba(11,14,19,0.86);
          font:500 ${msSize}px/1 var(--mono);color:var(--text);white-space:nowrap">${MS[d.kind]} ms<span class="example-tag" style="--tag-size:${Math.round(msSize * 0.62)}px">example</span></div>`,
    );
    d.label = el.querySelector(`.ms-${d.kind}`);
  }
  const label = el.querySelector('.t-label');
  const band = el.querySelector('.band');
  const lineEls = [...el.querySelectorAll('.ln')];

  // The band opens first, so no word is ever over bare picture; the lines
  // enter from opposite sides inside it, slowing as they land; set by 18.80 s.
  tl.fromTo(band, { opacity: 0, scale: 0.97, transformOrigin: '0% 0%' }, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out' }, 18.15);
  lineEls.forEach((ln, i) => {
    const from = i % 2 === 0 ? -1 : 1;
    tl.fromTo(ln, { x: from * 70 * u }, { x: 0, duration: 0.42, ease: 'power3.out' }, 18.2);
    tl.fromTo(ln, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }, 18.2);
  });
  // Held, never still: a slow push on the whole band.
  tl.fromTo(band, { scale: 1 }, { scale: 1.025, duration: 21.4 - 18.45, ease: 'none', immediateRender: false }, 18.45);
  // Leaves fast.
  tl.to(band, { x: -160 * u, opacity: 0, duration: 0.2, ease: 'power2.in' }, 21.4);

  // --- every frame -------------------------------------------------------------------
  /** A bar's grown fraction at t: the one shared speed, easing to rest over its last 0.3 s. */
  const growAt = (d, t) => {
    const g = clamp01((t - d.start) / d.late);
    const tail = Math.min(1, 0.3 / d.late);
    // Constant speed, then a constant deceleration to rest exactly at 1.
    const v = 1 / (1 - tail / 2);
    const a = 1 - tail;
    return g <= a ? v * g : v * a + v * (g - a) - (v * (g - a) ** 2) / (2 * tail);
  };
  const RENDER = [t0 - pad[0] - 0.01, t1 + pad[1]];
  onFrame((t) => {
    if (t < RENDER[0] || t > RENDER[1]) return;
    poseCamera(camera, t);
    // The house emerges from the ground colour, never with opacity: at 17.40
    // every pixel of it is exactly the background, and over 0.4 s, as
    // composition 8's sheet lifts off, it comes up evenly — solid throughout
    // (no see-through walls), never darker than the ground. Fog in the ground
    // colour does it: with `near` far behind the camera, its blend is the same
    // (1 − emerge) at every depth across the model.
    const emerge = smooth(span(t, 17.4, 17.8));
    const camD = camera.position.distanceTo(frame.target);
    const A = 1e4;
    scene.fog.near = -A;
    scene.fog.far = emerge < 1 ? (camD + A) / Math.max(1e-6, 1 - emerge) - A : 1e12;

    const progress = 0.46 + 0.012 * (t - t0);
    for (const d of devices) paintPlaying(d.screen, progress);

    // The plane fades in under the settling dot; brightens briefly at the touch.
    const touch = Math.exp(-Math.max(0, t - HOUSE_TOUCH) * 5) * (t >= HOUSE_TOUCH ? 1 : 0);
    planeMat.opacity = 0.38 * smooth(span(t, 18.35, 18.75)) + 0.4 * touch + 0.2 * smooth(span(t, HOUSE_TOUCH, HOUSE_TOUCH + 0.2));
    const hover = smooth(span(t, SETTLE, SETTLE + 0.3)) * (1 - smooth(span(t, 21.3, 21.5)));
    plumb.material.opacity = 0.35 * hover;
    spot.material.opacity = 0.55 * hover;
    const kr = span(t, HOUSE_TOUCH, HOUSE_TOUCH + 0.7);
    ring.visible = kr > 0 && kr < 1;
    ring.scale.setScalar(0.06 + 0.1 * easeOut(kr));
    ringMat.opacity = 0.9 * (1 - kr);

    for (const d of devices) {
      // Each bar still takes exactly its delay, so all three meet T together;
      // they slow as they arrive rather than stopping dead.
      const grown = growAt(d, t);
      const on = t >= d.start;
      d.bar.visible = on && grown > 0.002;
      d.bar.scale.set(1, Math.max(0.0001, grown * d.len), 1);
      d.bar.rotation.y = Math.atan2(camera.position.x - d.anchor.x, camera.position.z - d.anchor.z);
      d.disc.visible = false;
      // The stalk appears with its bar, never as a stray stub before it.
      // The whole column rises: the dark stalk grows up from the device over
      // the 0.25 s before its bar starts, then the bright bar carries on.
      const sk = smooth(span(t, d.start - 0.25, d.start));
      d.guide.visible = sk > 0;
      d.stem.scale.set(1, Math.max(0.0001, (d.baseY - d.stemFrom) * sk), 1);
      const met = t >= HOUSE_TOUCH;
      d.contact.visible = met;
      d.contact.scale.setScalar(met ? Math.max(0.0001, smooth(span(t, HOUSE_TOUCH, HOUSE_TOUCH + 0.3))) * (1 + 0.12 * Math.sin(Math.PI * 2 * ((t - HOUSE_TOUCH) / 0.625)) ** 2 * span(t, HOUSE_TOUCH + 0.3, HOUSE_TOUCH + 0.5)) : 0.0001);
      // The rings stay with their bars until the house leaves.
      d.contact.material.opacity = met ? 1 : 0;
      
      const pop = smooth(span(t, d.start, d.start + 0.15));
      d.disc.scale.setScalar(Math.max(0.0001, pop * (1 + 0.5 * Math.exp(-Math.max(0, t - d.start) * 8))));
    }

    // The T label sits just right of the dot and leaves before it rises.
    poseCamera(probe, t);
    const p = dotWorld(t, probe);
    const s = toScreen(p, probe, W, H);
    const dd = DOT_D * (refDistance / probe.position.distanceTo(p));
    const show = smooth(span(t, 18.45, 18.75)) * (1 - smooth(span(t, 21.38, 21.5)));
    label.style.opacity = String(show);
    // 16:9: the T label sits left of the dot, away from the laptop's bar.
    // Right of the dot in both formats.
    label.style.transform = `translate(${s.x + dd / 2 + 40 * u}px, ${s.y - 22 * u}px)`;

    // The push-through: the whole model rushes past the camera and the layer
    // is gone before composition 10 sets any type.
    const lift = span(t, 21.56, 21.74) ** 1.4;
    el.style.transformOrigin = '50% 50%';
    el.style.transform = lift > 0 ? `translateY(${H * 0.9 * lift}px) scale(${1 - 0.15 * lift})` : '';
    el.style.opacity = String(1 - smooth(span(t, 21.68, 21.74)));


    // Each bar's delay, by its start disc: the example values of F8.
    for (const d of devices) {
      const sp = toScreen(new THREE.Vector3(d.anchor.x, d.baseY, d.anchor.z), camera, W, H);
      const o = smooth(span(t, d.start + 0.45, d.start + 0.7)) * (1 - smooth(span(t, 21.38, 21.5)));
      d.label.style.opacity = String(o);
      // Right of its disc; the TV's (leftmost, beside the T label) to the
      // left, or under its disc where the left would leave the frame.
      const lw = d.label.offsetWidth;
      // Rides on the bar's own top as it rises, and stays beside it at T.
      const capY = d.baseY + growAt(d, t) * d.len;
      const top = toScreen(new THREE.Vector3(d.anchor.x, capY, d.anchor.z), camera, W, H);
      const lh = d.label.offsetHeight;
      // One rule for all three: level with its bar's top, right of its ring.
      let lx = top.x + 34 * u;
      let ly = top.y - lh / 2;
      // 9:16: the laptop's ring sits just right of the TV's ring, so the TV's
      // label stays to the right but rides just above its ring's height.
      if (portrait && d.kind === 'tv') ly = top.y - lh - 14 * u;
      d.label.style.transform = `translate(${lx}px, ${ly}px)`;
    }

    renderer.render(scene, camera);
  });
}
