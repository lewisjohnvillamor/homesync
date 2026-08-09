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
      return await import(candidate);
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
    if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`);
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
    if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${what} on ${client.label}`);
    await sleep(200);
  }
}

const ok = (message) => console.log(`OK  ${message}`);

try {
  const alpha = await makeClient('alpha');
  const beta = await makeClient('beta');
  const clients = [alpha, beta];

  for (const client of clients) {
    await waitFor(client, () => document.getElementById('clock-quality').textContent.includes('stable'), 'a stable clock');
  }
  ok('both clients reached a stable clock');

  await alpha.page.selectOption('#media-select', 'builtin-click');
  for (const client of clients) {
    await waitFor(client, () => document.getElementById('log').textContent.includes('verified and decoded'), 'media readiness');
  }
  ok('both clients verified the media hash and decoded it');

  // No force: this only succeeds if the readiness barrier is genuinely satisfied.
  await alpha.page.click('#play');
  for (const client of clients) {
    await waitFor(client, () => document.getElementById('media-state').textContent === 'playing', 'playback');
  }
  ok('the coordinator accepted play without a forced start');

  await sleep(3000);
  for (const client of clients) {
    const row = await client.page.evaluate(() =>
      [...document.querySelectorAll('#clients tr.self td')].map((td) => td.textContent).join(' | '));
    console.log(`    ${client.label}: ${row}`);
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
    () => [...document.querySelectorAll('#clients tr')].some((row) => row.textContent.includes('35 ms')),
    'compensation visible to the room',
  );
  ok('manual compensation propagated to the other device');
} finally {
  await browser.close();
  stopServer();
}

if (errors.length) {
  console.error(`\nJavaScript errors:\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('\nAll browser end-to-end checks passed with no JS errors.');
