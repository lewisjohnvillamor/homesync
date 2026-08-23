/**
 * Records the README's demo animation by driving the real coordinator.
 *
 * Nothing here is staged: it starts the actual binary, opens two real browsers,
 * joins them to a room and drives the same controls a person would. Every
 * number that appears — clock agreement, drift, the device count — is the
 * coordinator's own telemetry about those two browsers.
 *
 * What it cannot show is the point of the project. Headless Chromium renders
 * into a null audio sink, so this proves the interface and the protocol work
 * and says nothing about whether two speakers in a room sound like one. That
 * still needs the checkpoints in docs/checkpoints.md, and ears.
 *
 *   node docs/demo/capture.mjs
 *
 * Writes frames to docs/demo/frames/ for build-gif.py to assemble. Requires
 * Playwright; set PLAYWRIGHT_MODULE if it is not resolvable from here.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FRAMES = join(HERE, 'frames');
const MEDIA = join(HERE, 'media');

const PORT = Number(process.env.HOMESYNC_DEMO_PORT || 18400);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOM = 'HOUSE1';
const SECRET = 'demo-secret';

/** Frame size. Tall enough for the transport and the device panel together. */
const WIDTH = 900;
const HEIGHT = 940;

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const module = await import(candidate);
      const resolved = module.chromium ? module : module.default;
      if (resolved?.chromium) return resolved;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Playwright not found. Install it, or set PLAYWRIGHT_MODULE.');
}

/**
 * Writes a few short WAVs so the library has something in it.
 *
 * Deliberately named for what they are. A demo that invents song titles is
 * claiming a library it does not have.
 */
function writeMedia() {
  rmSync(MEDIA, { recursive: true, force: true });
  mkdirSync(MEDIA, { recursive: true });

  const rate = 48000;
  const tracks = [
    { name: 'Test tone 440 Hz.wav', seconds: 20, hz: 440 },
    { name: 'Test tone 220 Hz.wav', seconds: 15, hz: 220 },
    { name: 'Sweep 200-2000 Hz.wav', seconds: 12, hz: null },
  ];

  for (const track of tracks) {
    const frames = rate * track.seconds;
    const data = Buffer.alloc(frames * 4); // 16-bit stereo.
    for (let i = 0; i < frames; i += 1) {
      const t = i / rate;
      const hz = track.hz ?? 200 + (1800 * i) / frames;
      const sample = Math.round(Math.sin(2 * Math.PI * hz * t) * 8000);
      data.writeInt16LE(sample, i * 4);
      data.writeInt16LE(sample, i * 4 + 2);
    }

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);

    writeFileSync(join(MEDIA, track.name), Buffer.concat([header, data]));
  }
}

async function startCoordinator() {
  const child = spawn(
    join(ROOT, 'target', 'release', 'homesync'),
    [
      '--bind', '127.0.0.1',
      '--port', String(PORT),
      '--room-code', ROOM,
      '--room-secret', SECRET,
      '--media-dir', MEDIA,
      '--no-state',
      '--mdns', 'false',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return child;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error('coordinator never started listening');
}

/** Captures frames from `page` until stopped, tagging each with its instant. */
function recorder(page) {
  const frames = [];
  let running = true;
  const started = Date.now();

  const loop = (async () => {
    let index = 0;
    while (running) {
      const path = join(FRAMES, `f${String(index).padStart(4, '0')}.png`);
      try {
        await page.screenshot({ path });
        frames.push({ path, at: Date.now() - started });
        index += 1;
      } catch {
        // A screenshot can lose a race with navigation; skip that frame.
      }
      await sleep(200);
    }
  })();

  return {
    frames,
    async stop() {
      running = false;
      await loop;
    },
  };
}

async function main() {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  writeMedia();

  const coordinator = await startCoordinator();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'],
  });

  const errors = [];
  const open = async (name, role = 'speaker') => {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      // The stylesheet already holds the drifting background still for anyone
      // who asks motion to stop, keeping it visible. Recording in that mode
      // means the only pixels that change between frames are the ones the demo
      // is about, which is what keeps the file small enough for a README.
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
    await page.goto(`${BASE}/#room=${ROOM}&secret=${SECRET}`);
    await page.fill('#device-name', name);
    await page.selectOption('#device-role', role);
    return page;
  };

  // The filmed page is a controller, and the two speakers join off camera.
  //
  // Not a presentational choice. Screenshotting a page eight times a second
  // starves its audio thread, and filming a speaker made it report tens of
  // milliseconds of drift that the recording itself had caused. A controller
  // renders no audio, so watching it disturbs nothing — and a phone driving the
  // speakers in the room is what the remote is for anyway.
  const stage = await open('Phone', 'controller');
  const living = await open('Living room');
  const kitchen = await open('Kitchen TV');

  const record = recorder(stage);
  const beat = (ms) => sleep(ms);

  try {
    await beat(1400); // The join screen, with the invite already filled in.

    await stage.click('#join');
    await beat(500);
    await living.click('#join');
    await beat(500);
    await kitchen.click('#join');

    // Clock warm-up: the numbers in the device panel settle during this.
    await beat(5200);

    // Pick a track. Both speakers download it, verify the hash and decode.
    await stage.selectOption('#media-select', { label: 'Test tone 440 Hz.wav' });
    await beat(3600);
    const queued = await stage.evaluate(() => document.querySelectorAll('#queue li').length);
    if (queued !== 1) throw new Error(`expected one queued track, got ${queued}`);

    await stage.click('#play');
    await beat(5000);

    // Pause and resume, which is the part that shows the room moving together.
    await stage.click('#pause');
    await beat(1800);
    await stage.click('#play');
    await beat(3200);
  } finally {
    // However this ended, nothing may outlive the script. A coordinator left
    // holding the port is what makes the next run film a room that already has
    // a queue in it.
    await record.stop();
    await browser.close();
    coordinator.kill();
  }

  writeFileSync(join(FRAMES, 'timing.json'), JSON.stringify(record.frames, null, 2));
  console.log(`captured ${record.frames.length} frames`);
  console.log(errors.length ? `JS errors: ${errors.join('\n')}` : 'no JS errors');
}

await main();
