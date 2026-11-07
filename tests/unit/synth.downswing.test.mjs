// Integration (V4-F follow-up): tests/synth/swing.js downswingHands — a downswing hand-path offset (shallowing / over
// the top) that is zero at the top and at impact; the default [0, 0, 0] leaves every seeded swing unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { swingParams, buildSwingModel, synthSwing } from '../synth/swing.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

test('downswingHands: default retraces (seeded swings unchanged); an offset peaks half-way down, 0 at top and impact', () => {
  const P = swingParams(mulberry32(42));
  assert.deepEqual(P.downswingHands, [0, 0, 0]);
  const a = buildSwingModel(P);
  const off = [0.02, 0.05, -0.08];
  const b = buildSwingModel({ ...P, downswingHands: off });
  const { tT, tI, tA } = a.times;
  for (const t of [tA, tT, tI, tI + 0.1, (tA + tT) / 2]) assert.deepEqual(b.hands(t), a.hands(t), `t ${t}`);
  const mid = (tT + tI) / 2;
  const d = b.hands(mid).map((x, i) => x - a.hands(mid)[i]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(d[i] - off[i]) < 1e-12, `mid-downswing offset ${d}`);
  // the full generator: same seed, default params → identical pose rows
  const s1 = synthSwing({ seed: 3, view: 'dtl', fps: 60 });
  const s2 = synthSwing({ seed: 3, view: 'dtl', fps: 60, params: { downswingHands: [0, 0, 0] } });
  assert.deepEqual(s2.poseSeq.img, s1.poseSeq.img);
});
