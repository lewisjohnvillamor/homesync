/**
 * The drift-correction control law.
 *
 * These are mostly not tests of one call. A controller is judged on what it
 * does over many ticks against a device that keeps drifting, so most of this
 * file runs a closed loop: the trim changes the device's speed, the new speed
 * changes the drift, and the next tick sees the result. A law that looks
 * sensible per-call and oscillates forever in a loop passes the first kind of
 * test and fails the only one that matters.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_RATE_TRIM,
  RATE_CONVERGE_SECONDS,
  RATE_DEADBAND_MS,
  RATE_RELEASE_MS,
  RATE_RESAMPLE_LIMIT_MS,
  rateTrimFor,
} from '../src/player.js';

/**
 * Runs the loop against a device whose clock is off by `clockErrorPpm`.
 *
 * Positive ppm means the device's audio clock runs fast, so it gains on the
 * room and drift climbs. The trim is subtracted from that rate, which is
 * exactly what the real player does by changing `playbackRate`.
 */
function simulate({ startDriftMs = 0, clockErrorPpm = 0, ticks = 600, tickSeconds = 1 } = {}) {
  let driftMs = startDriftMs;
  let correcting = false;
  let trim = 0;
  const history = [];

  for (let i = 0; i < ticks; i += 1) {
    ({ trim, correcting } = rateTrimFor(driftMs, correcting));
    // Rate error over this tick, in ms: the device's own error plus whatever
    // the controller asked for, times the tick length.
    const netPpm = clockErrorPpm + trim * 1e6;
    driftMs += (netPpm / 1e6) * tickSeconds * 1000;
    history.push({ driftMs, trim, correcting });
  }
  return { driftMs, trim, correcting, history };
}

test('a device sitting on the timeline is left alone', () => {
  const { trim, correcting } = rateTrimFor(0);
  assert.equal(trim, 0);
  assert.equal(correcting, false);
});

test('drift inside the deadband is not worth correcting', () => {
  assert.equal(rateTrimFor(RATE_DEADBAND_MS - 0.5).trim, 0);
  assert.equal(rateTrimFor(-(RATE_DEADBAND_MS - 0.5)).trim, 0);
});

test('a device that has run ahead is asked to slow down', () => {
  const { trim, correcting } = rateTrimFor(20);
  assert.ok(trim < 0, `expected a negative trim, got ${trim}`);
  assert.equal(correcting, true);
});

test('a device that has fallen behind is asked to speed up', () => {
  const { trim } = rateTrimFor(-20);
  assert.ok(trim > 0, `expected a positive trim, got ${trim}`);
});

test('the trim is proportional to the error until it saturates', () => {
  const small = rateTrimFor(10).trim;
  const larger = rateTrimFor(20).trim;
  assert.ok(Math.abs(larger) > Math.abs(small));
  // 20 ms over 20 s is 0.001 exactly.
  assert.ok(Math.abs(Math.abs(larger) - 0.001) < 1e-9, `expected 0.001, got ${Math.abs(larger)}`);
});

test('the trim never exceeds the bound, however far out the device is', () => {
  for (const drift of [50, 100, 200, 249, -50, -100, -249]) {
    const { trim } = rateTrimFor(drift);
    assert.ok(Math.abs(trim) <= MAX_RATE_TRIM + 1e-12, `drift ${drift} produced ${trim}`);
  }
});

/**
 * The bound is what makes the correction inaudible. 0.2% is about 3.5 cents;
 * the just-noticeable pitch difference is roughly 5-10 cents. If someone raises
 * this constant, this test is where they should have to think about it.
 */
test('the bound stays under four cents of pitch', () => {
  const cents = 1200 * Math.log2(1 + MAX_RATE_TRIM);
  assert.ok(cents < 4, `${cents.toFixed(2)} cents is into audible territory`);
});

test('a device too far out is left to the coordinated restart', () => {
  const { trim, correcting } = rateTrimFor(RATE_RESAMPLE_LIMIT_MS + 1);
  assert.equal(trim, 0, 'resampling should not try to close a quarter-second gap');
  assert.equal(correcting, false);
});

test('nonsense drift is not acted on', () => {
  assert.equal(rateTrimFor(NaN).trim, 0);
  assert.equal(rateTrimFor(Infinity).trim, 0);
});

/* --- closed loop --------------------------------------------------------- */

test('a one-off offset is corrected away and stays away', () => {
  const { driftMs, history } = simulate({ startDriftMs: 30, ticks: 200 });
  assert.ok(Math.abs(driftMs) <= RATE_DEADBAND_MS, `settled at ${driftMs.toFixed(2)} ms`);
  // And it got there in a reasonable time rather than crawling.
  const settled = history.findIndex((h) => Math.abs(h.driftMs) <= RATE_RELEASE_MS);
  assert.ok(settled > 0 && settled < 60, `took ${settled} ticks to settle`);
});

test('a continuously drifting clock is held near the timeline', () => {
  // 100 ppm is a poor but entirely realistic consumer crystal: left alone it
  // is 6 ms per minute, and 360 ms after an hour.
  const { history } = simulate({ clockErrorPpm: 100, ticks: 3600 });
  const settled = history.slice(600);
  const worst = Math.max(...settled.map((h) => Math.abs(h.driftMs)));
  assert.ok(worst < 30, `worst drift after settling was ${worst.toFixed(1)} ms`);
});

test('a clock error the trim cannot outrun is handed over rather than fought forever', () => {
  // 5000 ppm is far beyond the bound, so the controller cannot win. What it
  // must not do is hold a saturated trim while the device sails past the
  // handover threshold — beyond that, drift is the restart's problem.
  const { history } = simulate({ clockErrorPpm: 5000, ticks: 200 });
  const past = history.find((h) => Math.abs(h.driftMs) >= RATE_RESAMPLE_LIMIT_MS);
  assert.ok(past, 'the device should have run past the handover threshold');
  const after = history[history.indexOf(past) + 1];
  assert.equal(after.trim, 0, 'the controller should have let go');
});

/**
 * Against a clock that is *always* wrong, any deadband controller settles into
 * a limit cycle: correct until released, drift back to the threshold, correct
 * again. That cycle is not a defect and cannot be designed away — only traded
 * against a wider deadband, which means more drift.
 *
 * So what is asserted is not "it stops switching" but the two things that
 * actually matter: the cycle is slow, and the drift it holds is small. An
 * earlier version of this test demanded few switches, which the simulation
 * showed was the wrong question — the controller was holding drift between
 * 1.1 and 3.9 ms and switching every 60 s, which is the behaviour wanted.
 */
test('the limit cycle is slow and holds the device close', () => {
  const { history } = simulate({ clockErrorPpm: 100, ticks: 3600 });

  const changes = [];
  for (let i = 1; i < history.length; i += 1) {
    if (history[i].correcting !== history[i - 1].correcting) changes.push(i);
  }
  const gaps = changes.slice(1).map((tick, i) => tick - changes[i]);
  const fastest = Math.min(...gaps);
  assert.ok(fastest >= 10, `rate changed after only ${fastest} s; that is flicking, not steering`);

  const settled = history.slice(120);
  const worst = Math.max(...settled.map((h) => Math.abs(h.driftMs)));
  assert.ok(worst < RATE_DEADBAND_MS * 1.5, `the cycle let drift reach ${worst.toFixed(2)} ms`);
});

/** Every rate change must be small enough that nobody hears the step. */
test('no single rate change is audible', () => {
  const { history } = simulate({ clockErrorPpm: 100, ticks: 3600 });
  let worstStep = 0;
  for (let i = 1; i < history.length; i += 1) {
    worstStep = Math.max(worstStep, Math.abs(history[i].trim - history[i - 1].trim));
  }
  const cents = 1200 * Math.log2(1 + worstStep);
  assert.ok(cents < 4, `a single step moved pitch by ${cents.toFixed(2)} cents`);
});

test('correction runs to completion once started', () => {
  // Entering at the deadband and releasing at the same value would stop the
  // correction immediately. It must carry on past the entry threshold.
  const justInside = RATE_DEADBAND_MS - 0.5;
  assert.equal(rateTrimFor(justInside, false).trim, 0, 'should not start here');
  assert.notEqual(rateTrimFor(justInside, true).trim, 0, 'should not stop here either');
  assert.equal(rateTrimFor(RATE_RELEASE_MS - 0.1, true).trim, 0, 'should stop at the release threshold');
});

test('a symmetric error is corrected symmetrically', () => {
  const ahead = simulate({ startDriftMs: 25, ticks: 200 });
  const behind = simulate({ startDriftMs: -25, ticks: 200 });
  assert.ok(Math.abs(Math.abs(ahead.driftMs) - Math.abs(behind.driftMs)) < 0.5);
});

test('correction never overshoots into a wilder error', () => {
  const { history } = simulate({ startDriftMs: 40, ticks: 300 });
  const worstOvershoot = Math.min(...history.map((h) => h.driftMs));
  assert.ok(worstOvershoot > -RATE_DEADBAND_MS * 2, `overshot to ${worstOvershoot.toFixed(2)} ms`);
});

/* --- position bookkeeping ------------------------------------------------- */

/**
 * The part of this that could go wrong silently.
 *
 * Trimming the rate changes how fast media time advances against the audio
 * clock, so a position derived from the *start* anchor is wrong the moment the
 * first correction lands — and wrong in the worst way, because the error is
 * proportional to how long the device has been playing. It would read as drift,
 * which would ask for more correction, which would make it worse.
 *
 * This models the same arithmetic the player does: an anchor that moves every
 * time the rate changes.
 */
function positionModel() {
  return {
    anchorAudioTime: 0,
    anchorMediaNs: 0,
    trim: 0,
    at(audioTime) {
      return this.anchorMediaNs + Math.max(0, audioTime - this.anchorAudioTime) * (1 + this.trim) * 1e9;
    },
    setTrim(audioTime, trim) {
      this.anchorMediaNs = this.at(audioTime);
      this.anchorAudioTime = audioTime;
      this.trim = trim;
    },
  };
}

test('position is continuous across a rate change', () => {
  const p = positionModel();
  const before = p.at(10);
  p.setTrim(10, -MAX_RATE_TRIM);
  assert.equal(p.at(10), before, 'the position jumped at the instant the rate changed');
});

test('a trim changes the rate of media time, not its value', () => {
  const p = positionModel();
  p.setTrim(10, -0.002);
  // One second later, media should have advanced by 0.998 s.
  const advanced = (p.at(11) - p.at(10)) / 1e9;
  assert.ok(Math.abs(advanced - 0.998) < 1e-9, `advanced ${advanced} s`);
});

/**
 * The specific bug the re-anchoring exists to prevent. Deriving position from
 * the start anchor rescales *all* elapsed time by the new rate, so a device an
 * hour into a track would appear to jump by 0.002 × 3600 s — over seven
 * seconds — the instant a 2 ms correction was applied.
 */
test('a correction an hour into playback does not move the position', () => {
  const p = positionModel();
  const hour = 3600;
  const before = p.at(hour);
  p.setTrim(hour, -MAX_RATE_TRIM);
  assert.equal(p.at(hour), before);

  const naive = hour * (1 + -MAX_RATE_TRIM) * 1e9;
  const jump = Math.abs(naive - before) / 1e9;
  assert.ok(jump > 7, `the naive version should jump badly; it moved ${jump.toFixed(2)} s`);
});

test('successive corrections accumulate correctly', () => {
  const p = positionModel();
  p.setTrim(10, -0.002);
  p.setTrim(20, 0.001);
  p.setTrim(30, 0);
  // 10 s at 1.0, then 10 s at 0.998, then 10 s at 1.001, then 10 s at 1.0.
  const expected = 10 + 10 * 0.998 + 10 * 1.001 + 10;
  assert.ok(Math.abs(p.at(40) / 1e9 - expected) < 1e-6, `got ${p.at(40) / 1e9}, wanted ${expected}`);
});
