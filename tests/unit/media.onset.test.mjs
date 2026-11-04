// audio/onset.worklet.js OnsetCore on synthetic PCM, and audio/onset.js time mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OnsetCore, ONSET_DEFAULTS } from '../../app/src/audio/onset.worklet.js';
import { ctxToPerfMs, startOnsetDetector } from '../../app/src/audio/onset.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';

function synth({ sr = 48000, dur = 3, noise = 0.003, events = [], seed = 7 }) {
  const rng = mulberry32(seed);
  const x = new Float32Array(Math.round(sr * dur));
  for (let i = 0; i < x.length; i++) x[i] = noise * gauss(rng);
  for (const ev of events) {
    const i0 = Math.round(ev.t * sr);
    const amp = ev.amp ?? 0.5;
    const tau = ev.tau ?? 0.004;
    for (let k = 0; i0 + k < x.length && k < sr * 0.05; k++) x[i0 + k] += amp * Math.exp(-k / (sr * tau)) * gauss(rng);
  }
  return x;
}

function run(x, sr, opts = {}, block = 128) {
  const core = new OnsetCore({ sampleRate: sr, ...opts });
  const out = [];
  for (let i = 0; i < x.length; i += block) {
    for (const e of core.push(x.subarray(i, Math.min(x.length, i + block)), i)) out.push({ t: e.frame / sr, level: e.level_db });
  }
  return out;
}

test('claps at known times are detected within 10 ms', () => {
  const sr = 48000;
  const times = [0.5, 1.2345, 2.0011, 2.6];
  const x = synth({ sr, events: times.map((t) => ({ t })) });
  const got = run(x, sr);
  assert.equal(got.length, times.length, JSON.stringify(got));
  got.forEach((g, i) => {
    assert.ok(Math.abs(g.t - times[i]) < 0.010, `onset ${i}: ${g.t} vs ${times[i]}`);
    assert.ok(g.level >= ONSET_DEFAULTS.thresh_db);
  });
  const worst = Math.max(...got.map((g, i) => Math.abs(g.t - times[i])));
  assert.ok(worst < 0.003, `worst error ${worst}`); // sample-refined, not hop-quantised
});

test('refractory period (300 ms) suppresses a second clap 150 ms later, not one 350 ms later', () => {
  const sr = 44100;
  const x = synth({ sr, events: [{ t: 1.0 }, { t: 1.15 }, { t: 1.5 }] });
  const got = run(x, sr, {}, 256);
  assert.deepEqual(got.map((g) => Math.round(g.t * 100) / 100), [1.0, 1.5]);
});

test('steady noise and slow swells give no onsets; a quiet tap below threshold is ignored', () => {
  const sr = 48000;
  const x = synth({ sr, noise: 0.01 });
  for (let i = 0; i < x.length; i++) x[i] *= 1 + 0.5 * Math.sin((2 * Math.PI * i) / sr / 2); // 0.5 Hz swell
  assert.equal(run(x, sr).length, 0);
  const y = synth({ sr, noise: 0.01, events: [{ t: 1, amp: 0.01 }] });
  assert.equal(run(y, sr).length, 0);
});

test('block size does not change the result (128 render quantum vs 1000-sample blocks)', () => {
  const sr = 48000;
  const x = synth({ sr, events: [{ t: 0.7 }, { t: 1.9 }] });
  const a = run(x, sr, {}, 128).map((g) => g.t);
  const b = run(x, sr, {}, 1000).map((g) => g.t);
  assert.deepEqual(a, b);
});

test('ctxToPerfMs maps AudioContext time through getOutputTimestamp', () => {
  assert.equal(ctxToPerfMs(10.5, { contextTime: 10, performanceTime: 5000 }), 5500);
  assert.equal(ctxToPerfMs(1, null), null);
});

test('startOnsetDetector degrades to AUDIO_UNAVAILABLE without worklet or audio track', async () => {
  const r1 = await startOnsetDetector(null, null, {});
  assert.equal(r1.available, false);
  assert.deepEqual(r1.reason_codes, [RC.AUDIO_UNAVAILABLE]);
  const ctx = { audioWorklet: { addModule: async () => {} } };
  const r2 = await startOnsetDetector(ctx, { getAudioTracks: () => [] }, {});
  assert.equal(r2.available, false);
  const ctx3 = { audioWorklet: { addModule: async () => { throw new Error('blocked'); } } };
  const r3 = await startOnsetDetector(ctx3, { getAudioTracks: () => [{}] }, {});
  assert.equal(r3.available, false);
  assert.match(r3.error, /blocked/);
  r3.stop();
});
