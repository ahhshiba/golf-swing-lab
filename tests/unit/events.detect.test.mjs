import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, decodeOrdered, BACKGROUND_CLASS } from '../../app/src/events/detect.js';
import { EVENTS } from '../../app/src/events/rules.js';
import { FEATURE_HZ } from '../../app/src/events/features.js';
import { synthSwing } from '../synth/swing.js';

function peaked(T, frames, base = 0.01) {
  return Array.from({ length: T }, (_, t) => {
    const row = new Array(9).fill(base);
    row[BACKGROUND_CLASS] = 0.9;
    frames.forEach((f, e) => { if (f === t) { row[e] = 0.8; row[BACKGROUND_CLASS] = 0.1; } });
    return row;
  });
}

test('decodeOrdered: picks the peaks and enforces the GolfDB order', () => {
  const frames = [2, 5, 7, 10, 12, 13, 15, 20];
  const dec = decodeOrdered(peaked(25, frames));
  assert.deepEqual(Array.from(dec.frames), frames);
  // swap the top and mid_backswing peaks: the decode must stay non-decreasing
  const bad = peaked(25, [2, 5, 11, 8, 12, 13, 15, 20]);
  const d2 = decodeOrdered(bad);
  for (let e = 1; e < 8; e++) assert.ok(d2.frames[e] >= d2.frames[e - 1]);
  // flat layout gives the same answer
  const flat = Float32Array.from(peaked(25, frames).flat());
  assert.deepEqual(Array.from(decodeOrdered(flat, 9).frames), frames);
});

test('detect: rules by default, TCN only when useTcn and a predictor is supplied', () => {
  const s = synthSwing({ seed: 2, view: 'face_on', fps: 60 });
  let called = 0;
  const g = s.truth.events;
  const tcn = {
    predict(feat) {
      called++;
      assert.equal(feat.hz, FEATURE_HZ);
      assert.equal(feat.F, 12);
      const k = (t) => Math.round((t - feat.t_s[0]) * feat.hz);
      return peaked(feat.K, EVENTS.map((e) => k(g[e].t_s)));
    },
  };
  const rules = detect(s.poseSeq, { view: 'face_on', tcn });
  assert.equal(called, 0);
  assert.equal(rules.address.source, 'rules');
  const ev = detect(s.poseSeq, { view: 'face_on', tcn, useTcn: true });
  assert.equal(called, 1);
  let prev = -1;
  for (const e of EVENTS) {
    assert.equal(ev[e].source, 'tcn');
    assert.ok(Math.abs(ev[e].t_s - g[e].t_s) <= 0.5 / FEATURE_HZ + 1e-9, `${e}`);
    assert.ok(ev[e].frame >= prev);
    prev = ev[e].frame;
  }
  const withAudio = detect(s.poseSeq, { view: 'face_on', tcn, useTcn: true, audioOnset_t: s.audioOnset_t });
  assert.ok(Math.abs(withAudio.impact.t_s - s.audioOnset_t) < 1e-12);
  assert.equal(withAudio.impact.conf, 0.95);
});

test('detect: an invalid TCN output falls back to the rules', () => {
  const s = synthSwing({ seed: 2, view: 'dtl', fps: 30 });
  const ev = detect(s.poseSeq, { view: 'dtl', useTcn: true, tcn: { predict: () => [[NaN]] } });
  assert.equal(ev.address.source, 'rules');
  assert.equal(ev.fallback, 'tcn_output_invalid');
});
