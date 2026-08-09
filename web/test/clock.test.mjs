/**
 * Browser clock estimator tests.
 *
 * These mirror `crates/homesync-clock/src/lib.rs`. The two implementations
 * must agree, because a receiver schedules audio with the browser copy while
 * the coordinator's own tooling reasons about the Rust copy.
 *
 * Run with: node --test web/test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ClockEstimator,
  DISCONTINUITY_CONFIRMATIONS,
  STABLE_UNCERTAINTY_NS,
} from '../src/clock.js';

/** Deterministic xorshift, so these tests never flake. */
function noise(seed) {
  let s = BigInt(seed);
  const mask = (1n << 64n) - 1n;
  return () => {
    s ^= (s >> 12n) & mask;
    s = (s ^ ((s << 25n) & mask)) & mask;
    s ^= s >> 27n;
    return Number((s * 0x2545f4914f6cdd1dn) & mask) / Number(mask);
  };
}

/** Simulates one exchange for a client whose clock is `offset` behind. */
function exchange(estimator, clientNow, offset, up, down) {
  const t0 = clientNow;
  const t1 = t0 + offset + up;
  const t2 = t1 + 50_000; // 50 us of coordinator processing
  const t3 = t2 - offset + down;
  return estimator.push(t0, t1, t2, t3);
}

test('recovers a known offset on a symmetric path', () => {
  const estimator = new ClockEstimator();
  const offset = 12_345_678;
  for (let i = 0; i < 20; i += 1) exchange(estimator, i * 1e8, offset, 3e6, 3e6);

  assert.ok(Math.abs(estimator.offsetNs - offset) < 1e5, `offset ${estimator.offsetNs}`);
  assert.equal(estimator.quality(), 'stable');
});

test('stays within the two millisecond target under jitter', () => {
  const estimator = new ClockEstimator();
  const random = noise(0x5eed);
  const offset = -7_500_000;
  for (let i = 0; i < 200; i += 1) {
    const up = 2e6 + random() * 12e6;
    const down = 2e6 + random() * 12e6;
    exchange(estimator, i * 2e8, offset, up, down);
  }
  const error = Math.abs(estimator.offsetNs - offset);
  assert.ok(error < 2e6, `error ${error} ns exceeds the 2 ms target`);
});

test('rejects a single congested outlier without losing the estimate', () => {
  const estimator = new ClockEstimator();
  const offset = 1e6;
  for (let i = 0; i < 20; i += 1) exchange(estimator, i * 1e8, offset, 2e6, 2e6);
  const before = estimator.offsetNs;

  // 400 ms on the return path only. Large enough to look like a clock step.
  assert.equal(exchange(estimator, 21e8, offset, 2e6, 400e6), false);
  assert.equal(estimator.quality(), 'stable', 'one stall must not force a resync');

  // Milder outlier: inside the discontinuity threshold, caught by the filter.
  assert.equal(exchange(estimator, 22e8, offset, 2e6, 60e6), false);
  assert.ok(Math.abs(estimator.offsetNs - before) < 5e4, 'outlier moved the estimate');
});

test('detects a confirmed discontinuity and re-locks', () => {
  const estimator = new ClockEstimator();
  for (let i = 0; i < 20; i += 1) exchange(estimator, i * 1e8, 1e6, 2e6, 2e6);
  assert.equal(estimator.quality(), 'stable');

  const stepped = 3e9;
  for (let i = 0; i < DISCONTINUITY_CONFIRMATIONS; i += 1) {
    exchange(estimator, 21e8 + i * 1e8, stepped, 2e6, 2e6);
  }
  assert.equal(estimator.quality(), 'resync_required');

  for (let i = 0; i < 20; i += 1) exchange(estimator, 25e8 + i * 1e8, stepped, 2e6, 2e6);
  assert.equal(estimator.quality(), 'stable');
  assert.ok(Math.abs(estimator.offsetNs - stepped) < 1e5);
});

test('measures clock rate drift', () => {
  const estimator = new ClockEstimator();
  const ppm = 40;
  for (let i = 0; i < 60; i += 1) {
    const clientNow = i * 1e9;
    exchange(estimator, clientNow, 1e6 + (clientNow * ppm) / 1e6, 2e6, 2e6);
  }
  assert.ok(Math.abs(estimator.driftPpm - ppm) < 5, `drift ${estimator.driftPpm} ppm`);
});

test('asymmetric paths bias the estimate by half the asymmetry', () => {
  const estimator = new ClockEstimator();
  for (let i = 0; i < 20; i += 1) exchange(estimator, i * 1e8, 0, 2e6, 12e6);
  assert.ok(Math.abs(estimator.offsetNs + 5e6) < 2e5, `offset ${estimator.offsetNs}`);
});

test('negative round trips are discarded', () => {
  const estimator = new ClockEstimator();
  assert.equal(estimator.push(1000, 0, 5000, 1100), false);
  assert.equal(estimator.haveEstimate, false);
});

test('a suspended context is reported regardless of sample quality', () => {
  const estimator = new ClockEstimator();
  for (let i = 0; i < 20; i += 1) exchange(estimator, i * 1e8, 1e6, 2e6, 2e6);
  assert.equal(estimator.quality(), 'stable');
  estimator.suspended = true;
  assert.equal(estimator.quality(), 'suspended');
});

test('report is well formed and ordered', () => {
  const estimator = new ClockEstimator();
  const random = noise(7);
  for (let i = 0; i < 60; i += 1) exchange(estimator, i * 1e8, 1e6, 2e6 + random() * 8e6, 2e6);
  const report = estimator.report();
  assert.ok(report.rtt_min_ms <= report.rtt_median_ms);
  assert.ok(report.rtt_median_ms <= report.rtt_p95_ms);
  assert.ok(report.samples > 0);
  assert.ok(report.offset_uncertainty_ms * 1e6 <= STABLE_UNCERTAINTY_NS || report.quality !== 'stable');
});

test('conversions are inverses', () => {
  const estimator = new ClockEstimator();
  for (let i = 0; i < 20; i += 1) exchange(estimator, i * 1e8, 5e6, 2e6, 2e6);
  const client = 1.234e9;
  assert.ok(Math.abs(estimator.toClientNs(estimator.toServerNs(client)) - client) < 1e-6);
});

test('the window stays bounded', () => {
  const estimator = new ClockEstimator();
  for (let i = 0; i < 500; i += 1) exchange(estimator, i * 1e8, 1e6, 2e6, 2e6);
  assert.ok(estimator.samples.length <= 60);
});
