/**
 * YouTube helper tests.
 *
 * Only the pure parts are testable here: the player itself needs a browser and
 * a network path to YouTube, which is what `web/test/e2e.mjs` exercises.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVideoId } from '../src/youtube.js';

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
