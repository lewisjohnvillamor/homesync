/**
 * Browser check for the room's controls: library search, bulk add, skipping,
 * keyboard shortcuts, the sleep timer and the operating system's media keys.
 *
 * Separate from `e2e.mjs` because it needs a real library to search — several
 * files with known names — while the end-to-end run deliberately uses the
 * built-in click track so that it depends on nothing. Everything here is
 * interface behaviour, so one browser is enough: that these commands reach the
 * whole room is proved over the wire in
 * `crates/homesync-server/tests/room_skip_and_sleep.rs`.
 *
 *   node web/test/controls.mjs
 *
 * Requires Playwright. Set PLAYWRIGHT_MODULE to its entry point if it is not
 * resolvable from this directory.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.HOMESYNC_CONTROLS_PORT || 18091);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOM = 'CTRLTS';
const SECRET = 'ctrlsecret';

/** Playwright is optional; skip cleanly rather than failing a checkout without it. */
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
  return null;
}

const playwright = await loadPlaywright();
if (!playwright) {
  console.log('SKIP  Playwright is not installed; control check not run.');
  process.exit(0);
}

// --- a library with searchable names ----------------------------------------

/**
 * Three one-second WAVs. Two share the word "morning", so a search has
 * something to narrow to and something to leave out.
 */
const NAMES = ['alpha-morning.wav', 'beta-evening.wav', 'gamma-morning.wav'];
const mediaDir = mkdtempSync(join(tmpdir(), 'homesync-controls-'));

NAMES.forEach((name, index) => {
  const samples = 48_000 * 4;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(samples + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(192_000, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples, 40);
  // A different fill per file, so each gets its own content-hash id.
  writeFileSync(join(mediaDir, name), Buffer.concat([header, Buffer.alloc(samples, index + 1)]));
});

// --- coordinator ------------------------------------------------------------

const server = spawn(
  'cargo',
  ['run', '--quiet', '--release', '--', '--bind', '127.0.0.1', '--port', String(PORT),
    '--room-code', ROOM, '--room-secret', SECRET, '--media-dir', mediaDir, '--mdns', 'false'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
const cleanUp = () => {
  server.kill('SIGTERM');
  rmSync(mediaDir, { recursive: true, force: true });
};
process.on('exit', cleanUp);

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(1000);
  }
  throw new Error('coordinator did not start');
}
await waitForServer();

// --- browser ----------------------------------------------------------------

const browser = await playwright.chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const ok = (message) => console.log(`OK  ${message}`);

const page = await browser.newPage();
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const url = message.location()?.url ?? '';
  if (url && !url.includes('127.0.0.1')) return;
  errors.push(`console: ${message.text()}`);
});

async function waitFor(predicate, what, timeout = 30000) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(predicate)) return;
    if (Date.now() - start > timeout) {
      const log = await page.evaluate(() => document.getElementById('log').textContent.slice(0, 900));
      throw new Error(`timeout waiting for ${what}\n--- log ---\n${log}`);
    }
    await sleep(200);
  }
}

/** The titles the library picker is currently offering, placeholder aside. */
const shownTitles = () =>
  page.evaluate(() => [...document.querySelectorAll('#media-select option')].slice(1).map((o) => o.textContent));

/** Which queue row is marked as the one the room is on. */
const currentRow = () =>
  page.evaluate(() => [...document.querySelectorAll('#queue li')].findIndex((li) => li.classList.contains('current')));

try {
  await page.goto(`${BASE}/#room=${ROOM}&secret=${SECRET}`);
  await page.fill('#device-name', 'controls');
  await page.click('#join');
  await waitFor(() => document.querySelectorAll('#media-select option').length > 1, 'the library to arrive');

  // --- searching the library ----------------------------------------------
  // Four entries: three files and the built-in click track.
  const all = await shownTitles();
  if (all.length !== 4) throw new Error(`expected four library entries, saw ${JSON.stringify(all)}`);
  if (await page.textContent('#media-count') !== '4 tracks') {
    throw new Error(`count should read "4 tracks", read "${await page.textContent('#media-count')}"`);
  }

  await page.fill('#media-search', 'morning');
  await waitFor(() => document.querySelectorAll('#media-select option').length === 3, 'the picker to narrow');
  const narrowed = await shownTitles();
  if (!narrowed.every((title) => title.includes('morning'))) {
    throw new Error(`search let through something that does not match: ${JSON.stringify(narrowed)}`);
  }
  if (await page.textContent('#media-count') !== '2 of 4') {
    throw new Error(`count should read "2 of 4", read "${await page.textContent('#media-count')}"`);
  }
  ok(`searching narrowed the library to ${JSON.stringify(narrowed)}`);

  // A search matching nothing says so, rather than offering an empty list that
  // looks like a library that has gone away.
  await page.fill('#media-search', 'nothing-matches-this');
  await waitFor(
    () => document.querySelector('#media-select option')?.textContent === 'Nothing matches',
    'the empty-result placeholder',
  );
  if (!(await page.evaluate(() => document.getElementById('media-add-all').disabled))) {
    throw new Error('Add all should be disabled when nothing matches');
  }
  ok('a search that matches nothing says so and disables bulk add');

  // --- adding what you searched for ---------------------------------------
  await page.fill('#media-search', 'morning');
  await waitFor(() => document.querySelectorAll('#media-select option').length === 3, 'the picker to narrow again');
  await page.click('#media-add-all');
  await waitFor(() => document.querySelectorAll('#queue li').length === 2, 'both matches to reach the queue');
  const queued = await page.evaluate(() =>
    [...document.querySelectorAll('#queue .queue-title')].map((e) => e.textContent));
  if (!queued.every((title) => title.includes('morning'))) {
    throw new Error(`bulk add queued something unmatched: ${JSON.stringify(queued)}`);
  }
  ok('Add all queued every match and nothing else');

  // --- skipping ------------------------------------------------------------
  if (await currentRow() !== 0) throw new Error('a fresh queue should start on its first entry');
  await page.click('#next');
  await waitFor(() => document.querySelectorAll('#queue li')[1]?.classList.contains('current'), 'Next to move on');
  ok('Next moved the room to the second entry');

  // Early in the track, so Back is a real step rather than a restart.
  await page.click('#previous');
  await waitFor(() => document.querySelectorAll('#queue li')[0]?.classList.contains('current'), 'Back to step back');
  ok('Back moved the room to the first entry');

  // At the end of a queue that is not repeating there is nowhere to go, so the
  // button is there but does nothing — and must not throw or clear the queue.
  await page.click('#next');
  await waitFor(() => document.querySelectorAll('#queue li')[1]?.classList.contains('current'), 'the last entry');
  await page.click('#next');
  await sleep(1200);
  if (await currentRow() !== 1 || (await page.evaluate(() => document.querySelectorAll('#queue li').length)) !== 2) {
    throw new Error('Next at the end of a queue should leave the room where it is');
  }
  ok('Next at the end of a queue is a no-op rather than a surprise');

  // --- keyboard shortcuts --------------------------------------------------
  // Nothing focused, which is the condition the handler insists on.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('p');
  await waitFor(() => document.querySelectorAll('#queue li')[0]?.classList.contains('current'), 'p to skip back');
  await page.keyboard.press('n');
  await waitFor(() => document.querySelectorAll('#queue li')[1]?.classList.contains('current'), 'n to skip on');
  ok('p and n skip through the queue');

  // Typing in a field must never reach the transport. This is the whole reason
  // the handler checks what has focus: searching for a track called "no" would
  // otherwise skip the room forward twice.
  const before = await currentRow();
  await page.fill('#media-search', 'np');
  await sleep(1200);
  if (await currentRow() !== before) {
    throw new Error('typing in the search box moved the room');
  }
  ok('typing in a text field does not drive the transport');

  // --- the sleep timer -----------------------------------------------------
  if (await page.textContent('#sleep') !== 'Sleep') {
    throw new Error('the sleep button should start off');
  }
  await page.click('#sleep');
  await waitFor(() => /^Sleep \d+:\d\d$/.test(document.getElementById('sleep').textContent), 'a sleep countdown');
  const armed = await page.textContent('#sleep');
  if (!(await page.evaluate(() => document.getElementById('sleep').classList.contains('on')))) {
    throw new Error('an armed sleep timer should look armed');
  }
  ok(`the sleep timer armed and reads "${armed}"`);

  // It must actually count down, not merely display a number once.
  await sleep(2500);
  const later = await page.textContent('#sleep');
  if (later === armed) throw new Error(`the countdown is not moving: still "${later}"`);
  ok(`the countdown is running: "${armed}" became "${later}"`);

  // Cycling past the longest step turns it off again, so the button is a way
  // back out rather than a one-way door.
  for (let i = 0; i < 6; i += 1) {
    await page.click('#sleep');
    await sleep(400);
    if ((await page.textContent('#sleep')) === 'Sleep') break;
  }
  if (await page.textContent('#sleep') !== 'Sleep') {
    throw new Error(`cycling never returned to off: "${await page.textContent('#sleep')}"`);
  }
  ok('cycling the sleep button returns to off');

  // --- the operating system's media controls -------------------------------
  // What makes a locked phone a usable remote. The handlers send coordinator
  // commands, so what the lock screen drives is the room.
  const session = await page.evaluate(() => ({
    supported: Boolean(navigator.mediaSession),
    title: navigator.mediaSession?.metadata?.title ?? null,
    artist: navigator.mediaSession?.metadata?.artist ?? null,
    state: navigator.mediaSession?.playbackState ?? null,
  }));
  if (!session.supported) {
    console.log('SKIP  this browser has no mediaSession; nothing to check.');
  } else {
    if (!session.title?.includes('morning')) {
      throw new Error(`the operating system was told the wrong track: ${JSON.stringify(session)}`);
    }
    if (!session.artist?.includes(ROOM)) {
      throw new Error(`the room should be named to the operating system: ${JSON.stringify(session)}`);
    }
    if (session.state !== 'paused') {
      throw new Error(`playback state should be paused, was ${session.state}`);
    }
    ok(`the operating system was told "${session.title}" by "${session.artist}"`);
  }

  if (errors.length) throw new Error(`JavaScript errors in the page:\n${errors.join('\n')}`);
  console.log('\nAll control checks passed.');
} catch (error) {
  console.error(`\nFAIL  ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  cleanUp();
}
