/**
 * Device capability probe.
 *
 * Reports what a given browser actually supports, and — where it can — what it
 * actually does rather than what it claims. Written for the LG webOS
 * investigation, where the interesting failures are not "no Web Audio" but
 * "Web Audio with several hundred milliseconds of latency that nobody
 * documents", but it is equally useful on any unfamiliar device.
 *
 * Nothing here is sent anywhere. It is a page you look at on the device.
 */

const results = [];

function record(name, value, verdict, detail = '') {
  results.push({ name, value, verdict, detail });
}

/** Best-effort browser and OS identification, including webOS versions. */
function identify() {
  const ua = navigator.userAgent;
  const webos = /web0?s|webOS/i.test(ua);
  let platform = 'unknown';
  if (webos) {
    const chrome = /Chrome\/(\d+)/.exec(ua);
    platform = `LG webOS (Chromium ${chrome ? chrome[1] : 'unknown'})`;
  } else if (/edg\//i.test(ua)) platform = 'Edge';
  else if (/chrome\//i.test(ua)) platform = 'Chrome';
  else if (/safari\//i.test(ua)) platform = 'Safari';
  else if (/firefox\//i.test(ua)) platform = 'Firefox';
  return { platform, webos, ua };
}

/**
 * Measures how far `AudioContext.currentTime` advances against
 * `performance.now()`.
 *
 * A context whose clock does not track real time cannot hold a schedule, and
 * that is exactly the failure mode reported on some TV browsers. This measures
 * it rather than trusting anything.
 */
async function measureClockRate(ctx, milliseconds = 1500) {
  const startContext = ctx.currentTime;
  const startPerf = performance.now();
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  const contextElapsed = ctx.currentTime - startContext;
  const realElapsed = (performance.now() - startPerf) / 1000;
  if (realElapsed <= 0) return null;
  return contextElapsed / realElapsed;
}

/**
 * Measures scheduling accuracy: schedule a silent buffer a known distance
 * ahead and see when the context reports it started.
 */
async function measureSchedulingError(ctx) {
  const target = ctx.currentTime + 0.5;
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.02), ctx.sampleRate);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(ctx.destination);

  let observed = null;
  source.onended = () => {
    observed = ctx.currentTime;
  };
  source.start(target);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (observed === null) return null;
  // The buffer is 20 ms long, so it should end 20 ms after the target.
  return (observed - (target + 0.02)) * 1000;
}

async function run() {
  const identity = identify();
  record('Platform', identity.platform, 'info');
  record('User agent', identity.ua, 'info');
  record('Secure context', String(window.isSecureContext), window.isSecureContext ? 'ok' : 'warn',
    window.isSecureContext ? '' : 'microphone calibration and installable PWA features need HTTPS');

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  record('Web Audio', AudioCtor ? 'yes' : 'no', AudioCtor ? 'ok' : 'fail',
    AudioCtor ? '' : 'this device cannot be a HomeSync receiver');

  record('WebSocket', 'WebSocket' in window ? 'yes' : 'no', 'WebSocket' in window ? 'ok' : 'fail');
  record('crypto.subtle', globalThis.crypto?.subtle ? 'yes' : 'no',
    globalThis.crypto?.subtle ? 'ok' : 'warn', 'absent means media hashes are verified in slower JavaScript');
  record('getUserMedia', navigator.mediaDevices?.getUserMedia ? 'yes' : 'no',
    navigator.mediaDevices?.getUserMedia ? 'ok' : 'warn', 'needed only to be the calibration microphone');
  record('Page Visibility', 'visibilityState' in document ? 'yes' : 'no', 'info');

  if (!AudioCtor) {
    render(results);
    return;
  }

  const ctx = new AudioCtor({ latencyHint: 'playback' });
  // Autoplay policy: a suspended context here is expected until the user taps.
  record('AudioContext state', ctx.state, ctx.state === 'running' ? 'ok' : 'warn',
    ctx.state === 'running' ? '' : 'tap "Run probe" to unlock audio');
  try {
    await ctx.resume();
  } catch {
    // Reported above.
  }

  record('Sample rate', `${Math.round(ctx.sampleRate)} Hz`, 'info');
  record('AudioWorklet', ctx.audioWorklet ? 'yes' : 'no', ctx.audioWorklet ? 'ok' : 'warn',
    ctx.audioWorklet ? '' : 'live system-audio mode is unavailable without it');

  const base = Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : null;
  const output = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : null;
  record('baseLatency', base === null ? 'not reported' : `${(base * 1000).toFixed(1)} ms`, base === null ? 'warn' : 'ok');
  record('outputLatency', output === null ? 'not reported' : `${(output * 1000).toFixed(1)} ms`,
    output === null ? 'warn' : 'ok',
    output === null ? 'compensation must be found by ear or by calibration' : '');

  const hasTimestamp = typeof ctx.getOutputTimestamp === 'function';
  let timestampUsable = false;
  if (hasTimestamp) {
    try {
      const ts = ctx.getOutputTimestamp();
      timestampUsable = Boolean(ts && ts.contextTime > 0 && ts.performanceTime > 0);
    } catch {
      timestampUsable = false;
    }
  }
  record('getOutputTimestamp', timestampUsable ? 'usable' : hasTimestamp ? 'present but empty' : 'absent',
    timestampUsable ? 'ok' : 'warn',
    timestampUsable ? 'output latency is compensated automatically' : 'falls back to reported latency');

  const rate = await measureClockRate(ctx);
  if (rate === null) {
    record('Audio clock rate', 'could not measure', 'warn');
  } else {
    const error = Math.abs(rate - 1) * 1e6;
    record('Audio clock rate', `${rate.toFixed(6)}× real time`, error < 5000 ? 'ok' : 'fail',
      error < 5000 ? '' : 'this clock does not track real time; scheduling cannot hold');
  }

  const schedulingError = await measureSchedulingError(ctx);
  if (schedulingError === null) {
    record('Scheduling accuracy', 'no onended callback', 'warn');
  } else {
    record('Scheduling accuracy', `${schedulingError.toFixed(1)} ms`,
      Math.abs(schedulingError) < 25 ? 'ok' : 'warn',
      'difference between a requested start and the reported one');
  }

  record('Verdict', verdict(), 'info');
  render(results);
}

/** A short, honest summary of whether this device can be a receiver. */
function verdict() {
  const failed = results.filter((r) => r.verdict === 'fail');
  if (failed.length) return `Not usable as a receiver: ${failed.map((r) => r.name).join(', ')}`;
  const warned = results.filter((r) => r.verdict === 'warn').map((r) => r.name);
  if (warned.length) {
    return `Usable, with caveats: ${warned.join(', ')}. Measure the real output delay with acoustic calibration.`;
  }
  return 'Looks like a well-behaved receiver. Confirm by ear against a second device.';
}

function render(rows) {
  const tbody = document.querySelector('#probe tbody');
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const [index, value] of [row.name, row.value, row.detail].entries()) {
      const td = document.createElement('td');
      td.textContent = value;
      if (index === 1) td.classList.add('mono');
      tr.append(td);
    }
    tr.classList.add(`verdict-${row.verdict}`);
    tbody.append(tr);
  }
  document.getElementById('probe').classList.remove('hidden');
}

document.getElementById('run').addEventListener('click', () => {
  results.length = 0;
  document.getElementById('run').disabled = true;
  run()
    .catch((error) => {
      record('Probe failed', error.message, 'fail');
      render(results);
    })
    .finally(() => {
      document.getElementById('run').disabled = false;
    });
});
