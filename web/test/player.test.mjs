/**
 * Scheduling tests for the controlled-audio receiver.
 *
 * This is the arithmetic that decides whether two devices sound like one
 * speaker or like an echo, so it is tested against a fake `AudioContext` where
 * every clock is known exactly. What it cannot test is whether a real browser
 * honours the requested start instant — that is what checkpoints 2 and 3 with
 * physical devices are for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ClockEstimator } from '../src/clock.js';
import { Player, LatencyMode, MIN_SCHEDULE_LEAD_S, positionAtServerNs } from '../src/player.js';

const NOW_MS = 1000;

// The player reads `performance.now()` and `document.visibilityState`.
globalThis.performance = { now: () => NOW_MS };
globalThis.document = { visibilityState: 'visible' };

class FakeSource {
  constructor() {
    this.started = null;
    this.stopped = false;
  }
  connect() {}
  disconnect() {}
  start(when, offset) {
    this.started = { when, offset };
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext {
  constructor({ currentTime = 10, outputTimestamp = null } = {}) {
    this.state = 'running';
    this.sampleRate = 48000;
    this.baseLatency = 0.01;
    this.outputLatency = 0.02;
    this.currentTime = currentTime;
    this.ts = outputTimestamp;
    this.sources = [];
    if (!outputTimestamp) delete this.getOutputTimestamp;
  }
  getOutputTimestamp() {
    return this.ts;
  }
  createGain() {
    return { gain: { setTargetAtTime() {} }, connect() {} };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

/** A context that cannot report when sound is actually heard (older Safari). */
function contextWithoutOutputTimestamp(currentTime = 10) {
  const ctx = new FakeContext({ currentTime });
  ctx.getOutputTimestamp = undefined;
  return ctx;
}

/** Estimator locked to a known offset via a noiseless symmetric path. */
function clockWithOffset(offsetNs) {
  const clock = new ClockEstimator();
  for (let i = 0; i < 20; i += 1) {
    const t0 = i * 1e8;
    const t1 = t0 + offsetNs + 2e6;
    const t2 = t1 + 5e4;
    const t3 = t2 - offsetNs + 2e6;
    clock.push(t0, t1, t2, t3);
  }
  return clock;
}

function makePlayer(ctx, offsetNs = 5e6, durationSeconds = 60) {
  const player = new Player(clockWithOffset(offsetNs));
  player.ctx = ctx;
  player.gain = ctx.createGain();
  player.buffer = { duration: durationSeconds };
  player.bufferMediaId = 'm1';
  return player;
}

/** Coordinator instant `seconds` from now, in the coordinator's own domain. */
function serverNsIn(seconds, offsetNs = 5e6) {
  return NOW_MS * 1e6 + offsetNs + seconds * 1e9;
}

function playing(anchorServerNs, anchorMediaNs = 0, epoch = 1) {
  return {
    epoch,
    state: 'playing',
    media_id: 'm1',
    anchor_server_ns: anchorServerNs,
    anchor_media_ns: anchorMediaNs,
  };
}

test('without getOutputTimestamp, the reported output latency is compensated', () => {
  const ctx = contextWithoutOutputTimestamp(10);
  const player = makePlayer(ctx);

  player.applyTransport(playing(serverNsIn(2)));

  assert.equal(player.latencyMode, LatencyMode.ReportedLatency);
  const started = ctx.sources[0].started;
  // 10 s context time + 2 s until the anchor, minus 30 ms of output latency.
  assert.ok(Math.abs(started.when - 11.97) < 1e-6, `start ${started.when}`);
  assert.equal(started.offset, 0);
  assert.equal(player.scheduleShiftMs, 0);
});

test('with getOutputTimestamp, latency is not compensated twice', () => {
  // The pair says the sound heard at performanceTime was context time 9.9, so
  // output latency is already folded into the mapping.
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 9.9, performanceTime: NOW_MS } });
  const player = makePlayer(ctx);

  player.applyTransport(playing(serverNsIn(2)));

  assert.equal(player.latencyMode, LatencyMode.OutputTimestamp);
  assert.equal(player.compensationSeconds(), 0);
  assert.ok(Math.abs(ctx.sources[0].started.when - 11.9) < 1e-6);
});

test('a zeroed output timestamp is not trusted', () => {
  // Before the graph renders anything, browsers return zeros. Using them would
  // place the start about a context-time epoch away from the right instant.
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 0, performanceTime: 0 } });
  const player = makePlayer(ctx);

  player.applyTransport(playing(serverNsIn(2)));

  assert.equal(player.latencyMode, LatencyMode.ReportedLatency);
  assert.ok(Math.abs(ctx.sources[0].started.when - 11.97) < 1e-6);
});

test('positive manual compensation starts the device earlier', () => {
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 9.9, performanceTime: NOW_MS } });
  const player = makePlayer(ctx);
  player.manualOffsetMs = 25;

  player.applyTransport(playing(serverNsIn(2)));

  assert.ok(Math.abs(ctx.sources[0].started.when - 11.875) < 1e-6, 'should start 25 ms earlier');
});

test('a late join skips into the media instead of trailing the room', () => {
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 9.9, performanceTime: NOW_MS } });
  const player = makePlayer(ctx);

  // The room started one second ago.
  player.applyTransport(playing(serverNsIn(-1)));

  const started = ctx.sources[0].started;
  const earliest = 10 + MIN_SCHEDULE_LEAD_S;
  assert.ok(Math.abs(started.when - earliest) < 1e-6, `start ${started.when}`);
  // Start moved forward by 1.16 s, so playback begins 1.16 s into the media.
  assert.ok(Math.abs(started.offset - 1.16) < 1e-6, `offset ${started.offset}`);
  assert.ok(Math.abs(player.scheduleShiftMs - 1160) < 1e-3);
});

test('a transport past the end of the media schedules nothing', () => {
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 9.9, performanceTime: NOW_MS } });
  const player = makePlayer(ctx, 5e6, 30);

  player.applyTransport(playing(serverNsIn(2), 45e9));

  assert.equal(ctx.sources.length, 0);
  assert.equal(player.playing, false);
});

test('a repeated epoch does not restart playback, but force does', () => {
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 9.9, performanceTime: NOW_MS } });
  const player = makePlayer(ctx);

  player.applyTransport(playing(serverNsIn(2), 0, 7));
  player.applyTransport(playing(serverNsIn(2), 0, 7));
  assert.equal(ctx.sources.length, 1, 'a duplicate transport must not cause an audible restart');

  player.applyTransport(playing(serverNsIn(2), 0, 7), { force: true });
  assert.equal(ctx.sources.length, 2);
  assert.equal(ctx.sources[0].stopped, true, 'the previous source must be stopped');
});

test('a transport for other media is ignored', () => {
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 9.9, performanceTime: NOW_MS } });
  const player = makePlayer(ctx);

  player.applyTransport({ ...playing(serverNsIn(2)), media_id: 'something-else' });

  assert.equal(ctx.sources.length, 0);
});

test('a non-playing transport stops the source', () => {
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: { contextTime: 9.9, performanceTime: NOW_MS } });
  const player = makePlayer(ctx);
  player.applyTransport(playing(serverNsIn(2), 0, 1));

  player.applyTransport({ ...playing(serverNsIn(2), 0, 2), state: 'paused' });

  assert.equal(ctx.sources[0].stopped, true);
  assert.equal(player.playing, false);
});

test('a device on schedule reports no timeline drift', () => {
  const ts = { contextTime: 9.9, performanceTime: NOW_MS };
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: ts });
  const player = makePlayer(ctx);
  const transport = playing(serverNsIn(2));
  player.applyTransport(transport);

  // One second after the anchor, with every clock advanced consistently.
  ts.contextTime = 12.9;
  ctx.currentTime = 13;
  const later = NOW_MS + 3000;
  globalThis.performance = { now: () => later };
  ts.performanceTime = later;

  const heard = player.heardPositionNs();
  assert.ok(Math.abs(heard - 1e9) < 1e6, `heard ${heard}`);
  assert.ok(Math.abs(player.diagnostics(transport).drift_ms) < 1, 'drift should be near zero');

  globalThis.performance = { now: () => NOW_MS };
});

test('user and calibration compensation are excluded from the reported drift', () => {
  // Otherwise moving the slider would make a device look better aligned than
  // it is, which defeats the point of the diagnostics view.
  const ts = { contextTime: 9.9, performanceTime: NOW_MS };
  const ctx = new FakeContext({ currentTime: 10, outputTimestamp: ts });
  const player = makePlayer(ctx);
  player.manualOffsetMs = 15;
  player.acousticOffsetMs = 25; // 40 ms of compensation in total
  const transport = playing(serverNsIn(2));
  player.applyTransport(transport);

  // One second past the anchor in wall-clock terms. Because this device
  // started 40 ms early, 1.04 s of media has played by now.
  ts.contextTime = 12.9;
  ctx.currentTime = 13;
  const later = NOW_MS + 3000;
  globalThis.performance = { now: () => later };
  ts.performanceTime = later;

  assert.ok(Math.abs(player.diagnostics(transport).drift_ms) < 1, 'compensation must not show as drift');
  globalThis.performance = { now: () => NOW_MS };
});

test('positionAtServerNs matches the coordinator formula', () => {
  const transport = playing(1000, 500);
  assert.equal(positionAtServerNs(transport, 1000), 500);
  assert.equal(positionAtServerNs(transport, 1750), 1250);
  // Before the anchor the position stays pinned rather than going negative.
  assert.equal(positionAtServerNs(transport, 0), 500);
  assert.equal(positionAtServerNs({ ...transport, state: 'paused' }, 9999), 500);
});
