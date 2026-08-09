/**
 * Live-PCM tests: frame decoding and the playout worklet.
 *
 * These mirror `crates/homesync-audio/src/frame.rs` and
 * `crates/homesync-audio/src/playout.rs` case for case. The two
 * implementations must agree, because the Rust one is what the tests reason
 * about and the JavaScript one is what actually renders audio.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeFrame, FLAG_DISCONTINUITY, FLAG_SILENCE } from '../src/live.js';

const RATE = 48000;
const CHANNELS = 2;
const FRAME = 480;
const FRAME_NS = 10e6;
const HEADER_BYTES = 34;

/** Builds a wire frame the way the coordinator does. */
function encodeFrame({
  flags = 0,
  format = 1,
  channels = CHANNELS,
  sampleRate = RATE,
  sequence = 0,
  presentationNs = 0,
  frameSamples = FRAME,
  samples = null,
} = {}) {
  const bytesPerSample = format === 1 ? 2 : 4;
  const payloadLength = samples ? samples.length * bytesPerSample : 0;
  const buffer = new ArrayBuffer(HEADER_BYTES + payloadLength);
  const view = new DataView(buffer);
  view.setUint8(0, 0x48);
  view.setUint8(1, 0x53);
  view.setUint8(2, 0x59);
  view.setUint8(3, 0x4e);
  view.setUint8(4, 1);
  view.setUint8(5, flags);
  view.setUint8(6, format);
  view.setUint8(7, channels);
  view.setUint32(8, sampleRate, false);
  view.setBigUint64(12, BigInt(sequence), false);
  view.setBigUint64(20, BigInt(Math.round(presentationNs)), false);
  view.setUint16(28, frameSamples, false);
  view.setUint32(30, payloadLength, false);
  if (samples) {
    for (let i = 0; i < samples.length; i += 1) {
      if (format === 1) {
        view.setInt16(HEADER_BYTES + i * 2, Math.round(samples[i] * 32767), true);
      } else {
        view.setFloat32(HEADER_BYTES + i * 4, samples[i], true);
      }
    }
  }
  return buffer;
}

/** A frame of constant-valued samples, so its arrival is identifiable. */
function marked(value) {
  return new Float32Array(FRAME * CHANNELS).fill(value);
}

// ---------------------------------------------------------------------------
// Frame decoding
// ---------------------------------------------------------------------------

test('decodes a well-formed frame', () => {
  const buffer = encodeFrame({ sequence: 42, presentationNs: 1234e6, samples: marked(0.5) });
  const frame = decodeFrame(buffer);

  assert.ok(frame);
  assert.equal(frame.sequence, 42);
  assert.equal(frame.presentationNs, 1234e6);
  assert.equal(frame.channels, CHANNELS);
  assert.equal(frame.sampleRate, RATE);
  assert.equal(frame.frameSamples, FRAME);
  assert.equal(frame.samples.length, FRAME * CHANNELS);
  assert.ok(Math.abs(frame.samples[0] - 0.5) < 1e-4);
});

test('decodes float payloads as well as 16-bit ones', () => {
  const frame = decodeFrame(encodeFrame({ format: 2, samples: marked(-0.25) }));
  assert.ok(Math.abs(frame.samples[0] + 0.25) < 1e-6);
});

test('rejects malformed frames instead of throwing', () => {
  // A bad frame on a live stream is something to count and skip.
  assert.equal(decodeFrame(new ArrayBuffer(4)), null, 'too short');

  const bad = (mutate) => {
    const buffer = encodeFrame({ samples: marked(0.1) });
    mutate(new DataView(buffer));
    return decodeFrame(buffer);
  };
  assert.equal(bad((v) => v.setUint8(0, 0x58)), null, 'bad magic');
  assert.equal(bad((v) => v.setUint8(4, 2)), null, 'future version');
  assert.equal(bad((v) => v.setUint8(6, 3)), null, 'Opus is not implemented');
  assert.equal(bad((v) => v.setUint8(7, 0)), null, 'zero channels');
  assert.equal(bad((v) => v.setUint8(7, 64)), null, 'absurd channel count');
  assert.equal(bad((v) => v.setUint32(8, 1, false)), null, 'impossible sample rate');
});

test('rejects a payload length that disagrees with the sample count', () => {
  // The dangerous case: a header claiming 480 stereo samples with a handful of
  // bytes behind it.
  const buffer = encodeFrame({ samples: marked(0.1) });
  new DataView(buffer).setUint32(30, 8, false);
  assert.equal(decodeFrame(buffer), null);

  const absurd = encodeFrame({ samples: marked(0.1) });
  new DataView(absurd).setUint32(30, 0xffffffff, false);
  assert.equal(decodeFrame(absurd), null);
});

test('accepts a silence frame with no payload', () => {
  const frame = decodeFrame(encodeFrame({ flags: FLAG_SILENCE, samples: null }));
  assert.ok(frame);
  assert.equal(frame.samples, null);
  assert.equal(frame.flags & FLAG_SILENCE, FLAG_SILENCE);
});

// ---------------------------------------------------------------------------
// Playout worklet
// ---------------------------------------------------------------------------

/** Loads the processor with the AudioWorklet globals it expects. */
async function loadProcessor() {
  let registered = null;
  const clock = { now: 0 };
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
  };
  globalThis.registerProcessor = (_name, cls) => {
    registered = cls;
  };
  Object.defineProperty(globalThis, 'currentTime', {
    configurable: true,
    get: () => clock.now,
  });
  await import('../src/audio-worklet/playout-processor.js');
  return { Processor: registered, clock };
}

const { Processor, clock } = await loadProcessor();

/** A primed-capable processor with a Live profile (80 ms target). */
function makeProcessor() {
  const processor = new Processor({
    processorOptions: { sampleRate: RATE, channels: CHANNELS, targetDepthNs: 80e6 },
  });
  clock.now = 0;
  // Anchor: context time 0 corresponds to coordinator time 0.
  processor.port.onmessage({ data: { type: 'anchor', contextTime: 0, serverNs: 0, compensationNs: 0 } });
  return processor;
}

function push(processor, { presentationNs, value, flags = 0, silent = false }) {
  processor.port.onmessage({
    data: {
      type: 'frame',
      presentationNs,
      frameSamples: FRAME,
      flags,
      samples: silent ? null : marked(value),
    },
  });
}

/** Pushes `count` consecutive frames, each marked with its index + 1. */
function pushRun(processor, startNs, count, from = 0) {
  for (let i = 0; i < count; i += 1) {
    push(processor, { presentationNs: startNs + i * FRAME_NS, value: from + i + 1 });
  }
}

/** Renders one quantum at coordinator time `nowNs`, returning channel 0. */
function render(processor, nowNs, frames = 128) {
  clock.now = nowNs / 1e9;
  const output = [new Float32Array(frames), new Float32Array(frames)];
  processor.process([], [output]);
  return output[0];
}

test('the worklet renders silence until the target depth is reached', () => {
  const processor = makeProcessor();
  pushRun(processor, 0, 4); // 40 ms against an 80 ms target
  assert.equal(processor.primed, false);
  assert.ok(render(processor, 0).every((s) => s === 0));

  pushRun(processor, 40 * 1e6, 4, 4); // now 80 ms
  assert.equal(processor.primed, true);
  assert.ok(render(processor, 0).every((s) => s === 1));
});

test('the worklet renders each frame at its presentation time', () => {
  const processor = makeProcessor();
  pushRun(processor, 0, 20);
  for (let i = 0; i < 5; i += 1) {
    const rendered = render(processor, i * FRAME_NS, FRAME);
    assert.ok(rendered.every((s) => s === i + 1), `block ${i} rendered ${rendered[0]}`);
  }
});

test('a lost frame becomes silence of exactly the right length', () => {
  const processor = makeProcessor();
  for (const i of [0, 1, 2, 4, 5, 6, 7, 8, 9]) {
    push(processor, { presentationNs: i * FRAME_NS, value: i + 1 });
  }
  for (let i = 0; i < 3; i += 1) {
    assert.ok(render(processor, i * FRAME_NS, FRAME).every((s) => s === i + 1));
  }
  assert.ok(render(processor, 3 * FRAME_NS, FRAME).every((s) => s === 0), 'the gap');
  // Frame 4 must still land in its own slot rather than sliding earlier.
  assert.ok(render(processor, 4 * FRAME_NS, FRAME).every((s) => s === 5));
});

test('duplicate and late frames are dropped', () => {
  const processor = makeProcessor();
  pushRun(processor, 0, 20);

  push(processor, { presentationNs: 5 * FRAME_NS, value: 99 });
  assert.equal(processor.stats.duplicate_frames, 1);

  for (let i = 0; i < 6; i += 1) {
    assert.ok(render(processor, i * FRAME_NS, FRAME).every((s) => s === i + 1), `block ${i}`);
  }

  // A retransmission of an already-played block.
  push(processor, { presentationNs: FRAME_NS, value: 99 });
  assert.equal(processor.stats.late_frames, 1);
  assert.ok(render(processor, 6 * FRAME_NS, FRAME).every((s) => s === 7));
});

test('a receiver that falls behind skips forward rather than trailing', () => {
  const processor = makeProcessor();
  pushRun(processor, 0, 30);
  render(processor, 0, FRAME);
  // The audio thread stalled for 100 ms; resume at the present.
  assert.ok(render(processor, 10 * FRAME_NS, FRAME).every((s) => s === 11));
});

test('running dry counts an underrun and re-primes', () => {
  const processor = makeProcessor();
  pushRun(processor, 0, 8);
  for (let i = 0; i < 8; i += 1) render(processor, i * FRAME_NS, FRAME);

  assert.ok(render(processor, 8 * FRAME_NS, FRAME).every((s) => s === 0));
  assert.equal(processor.stats.underruns, 1);
  assert.equal(processor.stats.reprimes, 1);
  assert.equal(processor.primed, false);
});

test('a discontinuity restarts the timeline', () => {
  const processor = makeProcessor();
  pushRun(processor, 0, 20);
  assert.equal(processor.primed, true);

  push(processor, { presentationNs: 900e9, value: 42, flags: FLAG_DISCONTINUITY });
  assert.equal(processor.primed, false, 'a restart must re-prime');

  pushRun(processor, 900e9 + FRAME_NS, 10, 0);
  assert.ok(render(processor, 900e9, FRAME).every((s) => s === 42));
});

test('a silence frame occupies its time without a payload', () => {
  const processor = makeProcessor();
  push(processor, { presentationNs: 0, value: 1 });
  push(processor, { presentationNs: FRAME_NS, silent: true, flags: FLAG_SILENCE });
  push(processor, { presentationNs: 2 * FRAME_NS, value: 3 });
  pushRun(processor, 3 * FRAME_NS, 10, 10);

  assert.ok(render(processor, 0, FRAME).every((s) => s === 1));
  assert.ok(render(processor, FRAME_NS, FRAME).every((s) => s === 0));
  assert.ok(render(processor, 2 * FRAME_NS, FRAME).every((s) => s === 3));
});

test('compensation pulls audio from further ahead in the stream', () => {
  // A device that emits 20 ms late must render the audio due 20 ms from now.
  const processor = makeProcessor();
  pushRun(processor, 0, 30);
  processor.port.onmessage({
    data: { type: 'anchor', contextTime: 0, serverNs: 0, compensationNs: 20e6 },
  });
  assert.ok(render(processor, 0, FRAME).every((s) => s === 3), 'expected the block due at +20 ms');
});

test('the buffer refuses to grow without limit', () => {
  const processor = makeProcessor();
  pushRun(processor, 0, 200); // 2 s against an 80 ms target, 320 ms ceiling
  assert.ok(processor.depthNs <= processor.maxDepthNs + FRAME_NS, `depth ${processor.depthNs}`);
  assert.ok(processor.stats.overruns > 0);
});

test('rendering without an anchor is silent rather than wrong', () => {
  // Before the first clock anchor arrives there is no way to know which audio
  // is due; guessing would emit the wrong samples at full volume.
  const processor = new Processor({
    processorOptions: { sampleRate: RATE, channels: CHANNELS, targetDepthNs: 80e6 },
  });
  pushRun(processor, 0, 20);
  assert.ok(render(processor, 0, FRAME).every((s) => s === 0));
});
