/**
 * Media verification tests.
 *
 * The JS digest is not a fallback of convenience: on a plain-HTTP LAN address
 * `crypto.subtle` does not exist, so this code is what actually guards the
 * readiness barrier in normal use. It is checked against Node's own SHA-256.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { sha256HexSync, sha256HexChunked } from '../src/sha256.js';

const nodeDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('matches the published vectors', () => {
  assert.equal(
    sha256HexSync(new Uint8Array(0)),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256HexSync(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('matches node for lengths around every padding boundary', () => {
  // 55/56/63/64 are where the length field and an extra block kick in.
  for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
    assert.equal(sha256HexSync(bytes), nodeDigest(bytes), `length ${length}`);
  }
});

test('matches node on a media-sized buffer', () => {
  // Roughly one second of 48 kHz stereo 16-bit audio.
  const bytes = new Uint8Array(192_044);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 131 + 17) & 0xff;
  assert.equal(sha256HexSync(bytes), nodeDigest(bytes));
});

test('accepts an ArrayBuffer as well as a typed array', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  assert.equal(sha256HexSync(bytes.buffer), sha256HexSync(bytes));
});

test('a single flipped bit changes the digest', () => {
  const a = new Uint8Array(4096);
  const b = new Uint8Array(4096);
  b[2048] = 1;
  assert.notEqual(sha256HexSync(a), sha256HexSync(b));
});

test('the chunked digest agrees with the one-pass digest', async () => {
  // Same bytes, same answer — the split into slices must not change where a
  // block boundary falls. Sizes chosen to straddle the yield interval and the
  // padding boundary, which are the two places an off-by-one would hide.
  for (const length of [0, 1, 55, 56, 64, 65, 1024 * 64 - 1, 1024 * 64, 1024 * 64 + 137]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
    assert.equal(await sha256HexChunked(bytes), sha256HexSync(bytes), `length ${length}`);
  }
});
