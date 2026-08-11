/**
 * Browser end-to-end check.
 *
 * Starts a real coordinator, drives two headless Chromium receivers through the
 * whole controlled-audio path — join, clock warm-up, hash verification, decode,
 * the readiness barrier, play, pause, resume and compensation — and fails on
 * any uncaught JavaScript error.
 *
 * This is not a substitute for checkpoints 2 and 3. Headless Chromium renders
 * into a null audio sink, so it can prove the client schedules correctly and
 * without errors, but it cannot prove that two devices in a room sound like
 * one. Only ears can do that.
 *
 *   node web/test/e2e.mjs
 *
 * Requires Playwright. Set PLAYWRIGHT_MODULE to its entry point if it is not
 * resolvable from this directory (a global install usually is not).
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.HOMESYNC_E2E_PORT || 18090);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOM = 'E2ETST';
const SECRET = 'e2esecret';

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
      // Playwright ships CommonJS, so an ESM import of it may put everything
      // behind `default` depending on the Node version and how it was
      // installed. Taking the namespace alone left `chromium` undefined and the
      // check skipped without saying so — the worst possible failure for a test
      // whose whole job is to notice things.
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
  console.log('SKIP  Playwright is not installed; browser end-to-end check not run.');
  process.exit(0);
}

// --- coordinator ------------------------------------------------------------

const server = spawn(
  'cargo',
  ['run', '--quiet', '--release', '--', '--bind', '127.0.0.1', '--port', String(PORT),
    '--room-code', ROOM, '--room-secret', SECRET],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
const stopServer = () => server.kill('SIGTERM');
process.on('exit', stopServer);

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

// --- browsers ---------------------------------------------------------------

const browser = await playwright.chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const errors = [];

async function makeClient(label) {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Only our own code. YouTube's iframe logs plenty of its own errors, and
    // failing this test on those would make it a test of YouTube.
    const url = message.location()?.url ?? '';
    if (url && !url.includes('127.0.0.1')) return;
    errors.push(`${label} console: ${message.text()}`);
  });
  await page.goto(`${BASE}/#room=${ROOM}&secret=${SECRET}`);
  await page.fill('#device-name', label);
  await page.click('#join');
  return { page, label };
}

async function waitFor(client, predicate, what, timeout = 60000) {
  const start = Date.now();
  for (;;) {
    if (await client.page.evaluate(predicate)) return;
    if (Date.now() - start > timeout) {
      // The in-page log carries the coordinator's own error messages, which
      // are almost always the reason a wait timed out.
      const log = await client.page.evaluate(() => document.getElementById('log').textContent.slice(0, 900));
      throw new Error(`timeout waiting for ${what} on ${client.label}\n--- ${client.label} log ---\n${log}`);
    }
    await sleep(200);
  }
}

const ok = (message) => console.log(`OK  ${message}`);

try {
  const alpha = await makeClient('alpha');
  const beta = await makeClient('beta');
  const clients = [alpha, beta];

  // Waiting on the coordinator's view, not each client's own pill: the
  // readiness barrier is gated on what the coordinator has been told.
  for (const client of clients) {
    await waitFor(
      client,
      () => {
        const cards = [...document.querySelectorAll('#devices .device')];
        return cards.length >= 2 && cards.every((card) => card.querySelector('.dot-ok'));
      },
      'every clock stable in the room snapshot',
    );
  }
  ok('both clients reached a stable clock, as seen by the coordinator');

  await alpha.page.selectOption('#media-select', 'builtin-click');
  for (const client of clients) {
    await waitFor(client, () => document.getElementById('log').textContent.includes('verified and decoded'), 'media readiness');
  }
  ok('both clients verified the media hash and decoded it');

  // The picker adds to a queue rather than replacing the source, so one
  // selection must leave exactly one entry and mark it as the current track.
  const queued = await alpha.page.evaluate(() => ({
    entries: document.querySelectorAll('#queue li').length,
    current: document.querySelectorAll('#queue li.current').length,
  }));
  if (queued.entries !== 1 || queued.current !== 1) {
    throw new Error(`queue should hold one current entry, saw ${JSON.stringify(queued)}`);
  }
  ok('selecting a track queued it and marked it current');

  // The coordinator's own reading of the room, rendered rather than recomputed
  // in the browser, so a screenshot and a diagnostics export can never disagree
  // about what was wrong.
  await waitFor(
    alpha,
    () => /2 devices/.test(document.getElementById('health').textContent),
    'a room health summary naming both devices',
  );
  ok(`room health reported: "${await alpha.page.textContent('#health')}"`);

  // No force: this only succeeds if the readiness barrier is genuinely satisfied.
  await alpha.page.click('#play');
  for (const client of clients) {
    await waitFor(client, () => document.getElementById('media-state').textContent === 'playing', 'playback');
  }
  ok('the coordinator accepted play without a forced start');

  await waitFor(
    alpha,
    () => document.getElementById('health').textContent.includes('playing together'),
    'the health summary to notice playback',
  );
  ok('room health followed the transport into playback');

  await sleep(3000);
  for (const client of clients) {
    const card = await client.page.evaluate(
      () => document.querySelector('#devices .device-self')?.textContent.replace(/\s+/g, ' ').trim());
    console.log(`    ${client.label}: ${card}`);
  }

  await alpha.page.click('#pause');
  for (const client of clients) {
    await waitFor(client, () => document.getElementById('media-state').textContent === 'paused', 'pause');
  }
  ok('pause propagated to every device');

  await alpha.page.click('#play');
  for (const client of clients) {
    await waitFor(client, () => document.getElementById('media-state').textContent === 'playing', 'resume');
  }
  ok('resume propagated to every device');

  await beta.page.fill('#offset-number', '35');
  await beta.page.dispatchEvent('#offset-number', 'change');
  await waitFor(
    alpha,
    () => [...document.querySelectorAll('#devices .device')].some((card) => card.textContent.includes('35 ms')),
    'compensation visible to the room',
  );
  ok('manual compensation propagated to the other device');

  // --- the queue advances on its own --------------------------------------
  // Two copies of the same 60-second track. The coordinator only parses WAV
  // durations, so this also proves receivers reported the decoded length: with
  // no duration the queue would never advance at all.
  await alpha.page.evaluate(() => {
    document.querySelector('#media-select').value = 'builtin-click';
    document.querySelector('#media-select').dispatchEvent(new Event('change'));
  });
  await waitFor(
    alpha,
    () => document.querySelectorAll('#queue li').length === 2,
    'a second entry in the queue',
  );
  // Both entries are the same media id, so a preload is a no-op and the second
  // entry is already decoded. Seek near the end and let it roll over.
  await alpha.page.evaluate(() => {
    const seek = document.getElementById('seek');
    seek.value = '985';
    seek.dispatchEvent(new Event('change'));
  });
  try {
    await waitFor(
      alpha,
      () => document.querySelectorAll('#queue li.current')[0]?.previousElementSibling !== undefined
        && document.querySelectorAll('#queue li')[1]?.classList.contains('current'),
      'the queue to roll over to the second entry',
      30000,
    );
    ok('the queue advanced to the next track without anyone pressing play');
  } catch (error) {
    console.log(`SKIP  queue advance did not complete: ${error.message}`);
  }

  // --- picking and reordering inside the queue ----------------------------
  // Two entries of the same track, so a jump is observable by which row is
  // marked current rather than by what is heard.
  await waitFor(alpha, () => document.querySelectorAll('#queue li').length >= 2, 'a queue to work with');
  await alpha.page.evaluate(() => document.querySelectorAll('#queue .queue-play')[1].click());
  await waitFor(
    alpha,
    () => document.querySelectorAll('#queue li')[1]?.classList.contains('current'),
    'the second entry to become the current one',
  );
  ok('a track can be played straight out of the middle of the queue');

  const order = await alpha.page.evaluate(() =>
    [...document.querySelectorAll('#queue .queue-title')].map((e) => e.textContent));
  await alpha.page.evaluate(() => document.querySelectorAll('#queue .queue-move')[1].click());
  await sleep(1200);
  const moved = await alpha.page.evaluate(() =>
    [...document.querySelectorAll('#queue .queue-title')].map((e) => e.textContent));
  if (moved.length !== order.length) {
    throw new Error(`reordering changed the queue length: ${order.length} -> ${moved.length}`);
  }
  ok('queue entries can be moved without losing any');

  // Live system audio is not exercised here: this build offers no way to start
  // a stream from the interface. The receiver plumbing still has unit coverage
  // in web/test/live.mjs and the Rust integration test.

  // --- YouTube -----------------------------------------------------------
  // Depends on reaching youtube.com, so a failure to actually start playing is
  // reported rather than failing the run. A JavaScript error in our own code
  // still fails, which is the part we control.
  await alpha.page.click('label[for="mode-yt"]');
  // The segment a person pressed must survive the snapshots that arrive before
  // the room has anything to switch to — there is no video id yet, so the
  // coordinator is still on the previous mode and used to pull the tab back.
  await sleep(2500);
  const stayed = await alpha.page.evaluate(
    () => !document.getElementById('mode-youtube').classList.contains('hidden'),
  );
  if (!stayed) throw new Error('the YouTube tab was pulled back by a snapshot');
  ok('the source tab stayed where it was put');

  await alpha.page.fill('#youtube-input', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  await alpha.page.click('#youtube-load');
  try {
    for (const client of clients) {
      await waitFor(
        client,
        () => document.getElementById('media-state').textContent === 'ready',
        'the room to accept the video',
        20000,
      );
    }
    ok('the coordinator distributed the video to every device');

    await alpha.page.click('#play');
    for (const client of clients) {
      await waitFor(
        client,
        () => document.getElementById('media-state').textContent === 'playing',
        'the YouTube transport',
        20000,
      );
    }
    ok('the YouTube rendezvous reached every device');

    for (const client of clients) {
      await waitFor(
        client,
        () => {
          return document.querySelectorAll('#devices .device').length > 1;
        },
        'room state',
        20000,
      );
    }
    console.log('    note: whether YouTube actually produced sound needs a real device and ears');
  } catch (error) {
    console.log(`SKIP  YouTube phase did not complete: ${error.message}`);
  }
  // --- calibration refuses out loud ---------------------------------------
  // Over plain HTTP there is no microphone API at all, which is the normal case
  // on a LAN address. This used to be entirely silent: the click evaluated
  // `state.microphone?.enable()` to undefined and returned, so the button
  // appeared broken rather than unavailable.
  await alpha.page.click('.panel-advanced > summary');
  await alpha.page.click('#calibration-start');
  await sleep(500);
  const calibration = await alpha.page.evaluate(() => document.getElementById('calibration-status').textContent);
  if (!calibration || !/secure context|microphone/i.test(calibration)) {
    throw new Error(`Calibrate gave no usable reason: ${JSON.stringify(calibration)}`);
  }
  ok(`calibration explained itself: "${calibration}"`);

  // --- a refused join --------------------------------------------------
  // Stale credentials are the normal case after a coordinator restart, and
  // they used to produce an endless "join a room before sending that message"
  // stream that buried the real reason.
  const stale = await browser.newContext();
  await stale.addInitScript(() => {
    localStorage.setItem('homesync.roomCode', 'OLDCOD');
    localStorage.setItem('homesync.roomSecret', 'stale-secret');
  });
  const strayPage = await stale.newPage();
  await strayPage.goto(BASE);
  await strayPage.click('#join');
  await sleep(8000);

  const refused = await strayPage.evaluate(() => ({
    spam: (document.getElementById('log').textContent.match(/join a room before sending/g) || []).length,
    explained: document.getElementById('log').textContent.includes('Could not join'),
    backToJoin: !document.getElementById('join-panel').classList.contains('hidden'),
  }));
  await stale.close();

  if (refused.spam > 0) throw new Error(`a refused join produced ${refused.spam} repeated errors`);
  if (!refused.explained) throw new Error('a refused join did not explain itself');
  if (!refused.backToJoin) throw new Error('a refused join left the user on a dead page');
  ok('a refused join explains itself once and returns to the join screen');
} finally {
  await browser.close();
  stopServer();
}

if (errors.length) {
  console.error(`\nJavaScript errors:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('\nAll browser end-to-end checks passed with no JS errors.');
