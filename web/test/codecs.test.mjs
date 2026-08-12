/**
 * The codec probe.
 *
 * `canPlayType` is the only way to ask a browser what it can decode before
 * handing it a file, and its answers are deliberately vague — "probably",
 * "maybe", or an empty string. Only the empty string is actionable, and acting
 * on it wrongly is worse than not acting: a false warning on a format that
 * works teaches people to ignore the warning.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserRefusesType } from '../src/player.js';

/** A stand-in for an `<audio>` element with a known set of answers. */
function probe(answers) {
  return { canPlayType: (type) => answers[type] ?? '' };
}

/**
 * Open-source Chromium 141, transcribed from a real run rather than imagined.
 *
 * The entry that matters is `audio/mp4`: it answers "maybe" on the browser that
 * cannot decode AAC, which is exactly why the container question is not the one
 * asked.
 */
const CHROMIUM = probe({
  'audio/wav': 'maybe',
  'audio/mpeg': 'probably',
  'audio/flac': 'probably',
  'audio/ogg': 'maybe',
  'audio/ogg; codecs=vorbis': 'probably',
  'audio/ogg; codecs=opus': 'probably',
  'audio/mp4': 'maybe',
  'video/mp4': 'maybe',
  'audio/webm': 'maybe',
  'video/webm': 'maybe',
  'audio/webm; codecs=opus': 'probably',
});

/** The same browser with the licensed decoders, as Chrome and Edge ship. */
const CHROME = probe({
  'audio/wav': 'maybe',
  'audio/mpeg': 'probably',
  'audio/flac': 'probably',
  'audio/ogg': 'maybe',
  'audio/ogg; codecs=vorbis': 'probably',
  'audio/mp4': 'maybe',
  'audio/mp4; codecs="mp4a.40.2"': 'probably',
  'audio/aac': 'probably',
  'audio/webm; codecs=opus': 'probably',
});

test('a format the browser knows it cannot decode is flagged', () => {
  // The types the scanner actually emits for an AAC library.
  assert.equal(browserRefusesType('audio/m4a', CHROMIUM), true);
  assert.equal(browserRefusesType('audio/m4b', CHROMIUM), true);
  assert.equal(browserRefusesType('audio/aac', CHROMIUM), true);
  assert.equal(browserRefusesType('video/mp4', CHROMIUM), true);
});

/**
 * The trap this design exists to avoid. Chromium answers "maybe" to the MP4
 * *container* while shipping no AAC decoder, so a check that asked about the
 * container would cheerfully report a library that cannot play.
 */
test('the container answer is not mistaken for a codec answer', () => {
  assert.equal(CHROMIUM.canPlayType('audio/mp4'), 'maybe', 'the fixture must keep this trap set');
  assert.equal(browserRefusesType('audio/mp4', CHROMIUM), true);
});

test('the same format on a browser that licenses it is not', () => {
  for (const type of ['audio/m4a', 'audio/m4b', 'audio/mp4', 'video/mp4', 'audio/aac']) {
    assert.equal(browserRefusesType(type, CHROME), false, type);
  }
});

/** The formats measured as working must never be flagged. Crying wolf here
 *  would teach people to ignore the warning that matters. */
test('formats that were measured playing are never flagged', () => {
  for (const type of ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'video/webm']) {
    assert.equal(browserRefusesType(type, CHROMIUM), false, type);
  }
});

/**
 * Every type the scanner can emit, against a browser that answers nothing at
 * all. Only the families with a codec-specific question may be judged; the rest
 * must stay silent, because `canPlayType` returning "" for AIFF says nothing
 * about whether `decodeAudioData` would manage it.
 */
test('formats with no reliable codec question are never judged', () => {
  const silent = probe({});
  for (const type of ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/aiff', 'audio/x-aiff', 'audio/x-wav']) {
    assert.equal(browserRefusesType(type, silent), false, `${type} must not be flagged on a silent browser`);
  }
});

test('"maybe" counts as playable, because it is not a refusal', () => {
  assert.equal(browserRefusesType('audio/wav', CHROMIUM), false);
});

/**
 * An `.m4a` may hold AAC or ALAC and the container alone does not settle it, so
 * a browser can answer "" for the bare type and still decode the contents.
 */
test('a lossless m4a is not written off because AAC is missing', () => {
  // An .m4a may hold ALAC rather than AAC, and a browser may ship one decoder
  // and not the other.
  const alacOnly = probe({ 'audio/mp4; codecs="alac"': 'probably' });
  assert.equal(browserRefusesType('audio/m4a', alacOnly), false);
});

test('an unknown or absent type is never flagged', () => {
  assert.equal(browserRefusesType('', CHROMIUM), false);
  assert.equal(browserRefusesType(undefined, CHROMIUM), false);
  assert.equal(browserRefusesType('application/octet-stream', CHROMIUM), false);
});

/** Nothing here may throw where there is no DOM at all. */
test('a browser without canPlayType is given the benefit of the doubt', () => {
  assert.equal(browserRefusesType('audio/mp4', {}), false);
  assert.equal(browserRefusesType('audio/mp4', { canPlayType: null }), false);
});
