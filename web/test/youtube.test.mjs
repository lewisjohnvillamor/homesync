/**
 * YouTube helper tests.
 *
 * Only the pure parts are testable here: the player itself needs a browser and
 * a network path to YouTube, which is what `web/test/e2e.mjs` exercises.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVideoId, isUnembeddable, rendezvousPlan } from '../src/youtube.js';

test('accepts a bare video id', () => {
  assert.equal(parseVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('  dQw4w9WgXcQ  '), 'dQw4w9WgXcQ');
  // Ids use the URL-safe alphabet.
  assert.equal(parseVideoId('a-b_c1234XY'), 'a-b_c1234XY');
});

test('accepts the URL shapes people actually paste', () => {
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
});

test('identifies the errors that no retry can fix', () => {
  // 101 and 150 are the same condition: the owner allows playback only on
  // youtube.com. 100 is a video that is gone or private. Retrying, reloading
  // or rescheduling changes none of them, so the user has to be told rather
  // than left watching a broken player.
  assert.equal(isUnembeddable(101), true);
  assert.equal(isUnembeddable(150), true);
  assert.equal(isUnembeddable(100), true);

  // These are transient or local, and are not worth telling the whole room
  // to pick a different video over.
  assert.equal(isUnembeddable(5), false);
  assert.equal(isUnembeddable(2), false);
  assert.equal(isUnembeddable(undefined), false);
});

test('rejects things that are not video ids', () => {
  // A wrong id would be distributed to every device in the room as if it were
  // a video, so it is better to reject than to guess.
  assert.equal(parseVideoId(''), null);
  assert.equal(parseVideoId('   '), null);
  assert.equal(parseVideoId(null), null);
  assert.equal(parseVideoId('too-short'), null);
  assert.equal(parseVideoId('waaaaaaaaaaaaaytoolong'), null);
  assert.equal(parseVideoId('https://www.youtube.com/'), null);
  // A well-formed id on somebody else's site is not a YouTube video.
  assert.equal(parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseVideoId('https://evil.example/dQw4w9WgXcQ'), null);
});

test('waits when the meeting instant is still ahead', () => {
  // Meet in 2 s, and this player takes 300 ms to start: call play in 1.7 s and
  // seek straight to the target, because nothing has elapsed yet.
  const plan = rendezvousPlan({ startNs: 2e9, nowNs: 0, leadMs: 300, targetPositionS: 60 });
  assert.equal(plan.immediate, false);
  assert.equal(plan.delayMs, 1700);
  assert.equal(plan.seekTargetS, 60);
});

test('a late rendezvous seeks forward by exactly what will have elapsed', () => {
  // The meeting instant passed 1 s ago and the player still needs 300 ms to
  // start, so sound emerges 1.3 s after the target — seek 1.3 s in.
  //
  // The old code added the lead a second time, landing the device 300 ms
  // ahead of everyone else: silent in review, a flam in the room, and on a
  // drift correction it re-triggered the very drift it was fixing.
  const plan = rendezvousPlan({ startNs: 0, nowNs: 1e9, leadMs: 300, targetPositionS: 60 });
  assert.equal(plan.immediate, true);
  assert.equal(plan.seekTargetS, 61.3);
});

test('a device that emits early is told to call play late', () => {
  // Negative lead is what manual compensation below zero means. Clamping it
  // to zero, as the old code did, made the slider a no-op in that direction.
  const plan = rendezvousPlan({ startNs: 1e9, nowNs: 0, leadMs: -200, targetPositionS: 10 });
  assert.equal(plan.immediate, false);
  assert.equal(plan.delayMs, 1200);
});

test('the seek target never runs backwards', () => {
  // Exactly on time: no lateness to make up.
  const plan = rendezvousPlan({ startNs: 300e6, nowNs: 0, leadMs: 300, targetPositionS: 42 });
  assert.equal(plan.delayMs, 0);
  assert.equal(plan.seekTargetS, 42);
});
