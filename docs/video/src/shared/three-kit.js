/**
 * The 3D pieces the film shares: one renderer setup, one lighting rig, and
 * the three device models — laptop, phone and TV — that appear on the floor
 * in compositions 1–2 and inside the model house in composition 9. Same
 * models, same materials, so a device keeps its identity across the film.
 *
 * Lit like a product shoot: a soft key from the left, a rim light behind, a
 * low fill, and a real environment for reflections so glass and metal read as
 * glass and metal rather than flat black.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const BRAND = {
  bg: new THREE.Color('#0b0e13'),
  accent: new THREE.Color('#5aa9ff'),
};

/**
 * A renderer whose output is in the same colour space as the page, so a
 * colour set here is the colour measured in the frame.
 */
export function makeRenderer(width, height) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  return renderer;
}

/**
 * A scene with the lighting rig and a brand-coloured ground.
 *
 * `groundTint` is the floor's albedo. Tone mapping and lighting change what a
 * colour looks like on screen, so the floor is tuned by measuring the
 * rendered pixel (see `measureBackground`), not by setting it to the brand hex
 * and hoping.
 */
export function makeStage(renderer, { groundTint = '#0b0e13', fill = 0.12, fogNear = 9, fogFar = 22 } = {}) {
  const scene = new THREE.Scene();
  scene.background = BRAND.bg.clone();
  // Fog in the background colour, so the floor melts into the frame rather
  // than ending at a visible edge.
  scene.fog = new THREE.Fog(BRAND.bg.clone(), fogNear, fogFar);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // Key: soft, from the left and in front.
  const key = new THREE.DirectionalLight('#fff3e6', 2.4);
  key.position.set(-6, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  // Rim: behind and above, cool, to draw the silhouettes off the ground.
  const rim = new THREE.DirectionalLight('#9cc9ff', 3.2);
  rim.position.set(3, 5, -8);
  scene.add(rim);

  // Fill: barely there, so shadows are dark but not holes.
  scene.add(new THREE.HemisphereLight('#c9d6e8', '#05070a', fill));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    // Matte, with no specular term at all. A standard material at this low a
    // camera angle catches a grazing sheen that turned the floor grey-blue
    // whatever its colour; a seamless studio sweep is matte for that reason.
    new THREE.MeshLambertMaterial({ color: groundTint }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return { scene, key, rim, ground };
}

// --- materials -----------------------------------------------------------------

/** Dark anodised aluminium. */
export function aluminium() {
  return new THREE.MeshPhysicalMaterial({ color: '#3a434f', metalness: 0.85, roughness: 0.34, clearcoat: 0.2, clearcoatRoughness: 0.4 });
}

/** A bezel: deep blue-grey glass with a clear coat, never flat black. */
export function bezelGlass() {
  return new THREE.MeshPhysicalMaterial({ color: '#111821', metalness: 0.1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.4 });
}

/**
 * A screen whose picture is a canvas the caller draws into each frame.
 * Emissive, so it lights itself the way a real screen does.
 */
export function screenSurface(pxW, pxH) {
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // A little gloss, not a mirror. A clear coat at full strength reflected the
  // studio environment straight back and blew a tilted laptop screen out to
  // white — which reads as a lit screen, the one thing it must not look like
  // before the press.
  const material = new THREE.MeshPhysicalMaterial({
    color: '#000000',
    emissive: '#ffffff',
    emissiveMap: texture,
    emissiveIntensity: 1,
    roughness: 0.4,
    clearcoat: 0.08,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.06,
    // The key light's highlight on a tilted-back laptop lid washed the whole
    // screen grey; a screen is not a mirror for the light above it.
    specularIntensity: 0.12,
  });
  return { canvas, ctx: canvas.getContext('2d'), texture, material };
}

/**
 * Draws a device screen: the app's surface colour, lit by `glow` (0–1), with
 * an optional play glyph and an optional "T" marker.
 */
export function paintScreen(screen, { glow = 0, play = 0, playScale = 1, marker = 0 } = {}) {
  const { ctx, canvas, texture } = screen;
  const w = canvas.width;
  const h = canvas.height;
  // Off: very dark. On: the app's surface with a soft blue bloom.
  const base = 0.06 + 0.12 * glow;
  ctx.fillStyle = `rgb(${Math.round(18 * base * 5)}, ${Math.round(23 * base * 5)}, ${Math.round(31 * base * 5)})`;
  ctx.fillRect(0, 0, w, h);
  if (glow > 0) {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.7);
    g.addColorStop(0, `rgba(90, 169, 255, ${0.38 * glow})`);
    g.addColorStop(1, 'rgba(90, 169, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (play > 0) {
    const s = Math.min(w, h) * 0.34 * playScale;
    ctx.save();
    ctx.globalAlpha = play;
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = '#5aa9ff';
    ctx.beginPath();
    ctx.moveTo(-s * 0.36, -s * 0.5);
    ctx.lineTo(s * 0.5, 0);
    ctx.lineTo(-s * 0.36, s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (marker > 0) {
    ctx.save();
    ctx.globalAlpha = marker;
    ctx.fillStyle = '#5aa9ff';
    ctx.font = `700 ${Math.round(h * 0.46)}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', w / 2, h / 2 + h * 0.02);
    ctx.restore();
  }
  texture.needsUpdate = true;
}

// --- devices ---------------------------------------------------------------------
//
// Units are metres-ish; a laptop is ~0.32 wide. Each device's origin is the
// centre of its footprint on the floor, so placing one at y = 0 grounds it —
// nothing floats.

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function makeLaptop() {
  const group = new THREE.Group();
  const metal = aluminium();
  const base = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.016, 0.235, 4, 0.006), metal));
  base.position.y = 0.008;
  group.add(base);

  const hinge = new THREE.Group();
  hinge.position.set(0, 0.016, -0.115);
  hinge.rotation.x = -0.32; // the lid, open a little past upright
  group.add(hinge);
  const lid = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.225, 0.008, 4, 0.004), metal));
  lid.position.set(0, 0.1125, 0);
  hinge.add(lid);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.215), bezelGlass());
  bezel.position.set(0, 0.1125, 0.0042);
  hinge.add(bezel);
  const screen = screenSurface(640, 400);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), screen.material);
  panel.position.set(0, 0.116, 0.0046);
  hinge.add(panel);

  // Keyboard well, a hair recessed, so the base is not a featureless slab.
  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(0.29, 0.1),
    new THREE.MeshStandardMaterial({ color: '#232a33', roughness: 0.6, metalness: 0.4 }),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, 0.0162, -0.035);
  group.add(deck);

  return { group, screen, kind: 'laptop' };
}

export function makePhone() {
  const group = new THREE.Group();
  // Standing on a small dock so it faces the camera, as a phone on a table
  // playing music usually does.
  const dock = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.012, 0.06, 4, 0.004), aluminium()));
  dock.position.y = 0.006;
  group.add(dock);
  const body = new THREE.Group();
  body.position.set(0, 0.012, 0.0);
  body.rotation.x = -0.22;
  group.add(body);
  const shell = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.155, 0.009, 6, 0.0045), aluminium()));
  shell.position.y = 0.0775;
  body.add(shell);
  const glass = new THREE.Mesh(new RoundedBoxGeometry(0.0735, 0.1535, 0.0012, 6, 0.0005), bezelGlass());
  glass.position.set(0, 0.0775, 0.0048);
  body.add(glass);
  const screen = screenSurface(300, 620);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.067, 0.142), screen.material);
  panel.position.set(0, 0.0775, 0.0056);
  body.add(panel);
  return { group, screen, kind: 'phone' };
}

export function makeTv() {
  const group = new THREE.Group();
  const metal = aluminium();
  // Two feet, the panel resting in them: grounded, no gap.
  for (const x of [-0.22, 0.22]) {
    const foot = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.012, 0.11, 3, 0.004), metal));
    foot.position.set(x, 0.006, 0);
    group.add(foot);
    const post = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.05, 0.014, 3, 0.004), metal));
    post.position.set(x, 0.036, 0);
    group.add(post);
  }
  const frame = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.36, 0.02, 4, 0.006), metal));
  frame.position.set(0, 0.06 + 0.18, 0);
  group.add(frame);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(0.61, 0.35), bezelGlass());
  bezel.position.set(0, 0.24, 0.0102);
  group.add(bezel);
  const screen = screenSurface(960, 540);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.595, 0.335), screen.material);
  panel.position.set(0, 0.24, 0.0106);
  group.add(panel);
  return { group, screen, kind: 'tv' };
}

export const MAKE = { laptop: makeLaptop, phone: makePhone, tv: makeTv };

/**
 * Projects a world point to frame pixels, for HTML labels and for handing the
 * dot between the 3D scene and the page.
 */
export function toScreen(point, camera, width, height) {
  const v = point.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, behind: v.z > 1 };
}
