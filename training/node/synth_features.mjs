// evfeat-1 features of the 3 synthetic swings used as the event-TCN golden inputs (no GolfDB data in the golden).
// Usage (repository root): node training/node/synth_features.mjs <out.json>
import { writeFileSync } from 'node:fs';
import { computeFeatures, FEATURE_VERSION } from '../../app/src/events/features.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { synthSwing } from '../../tests/synth/swing.js';

/** The golden PoseSeqs; tests/unit/events.tcn.test.mjs rebuilds them with the same function. */
export function goldenPoseSeqs() {
  const a = synthSwing({ seed: 21, view: 'face_on', fps: 60, tsJitter_s: 0.002 });
  const b = synthSwing({ seed: 22, view: 'dtl', fps: 30, handedness: 'left' });
  const c = synthSwing({ seed: 23, view: 'face_on', fps: 60 });
  const rng = mulberry32(7);
  const keep = [];
  const N = c.poseSeq.t_s.length;
  for (let i = 0; i < N; i++) if (rng() > 0.15) keep.push(i);
  const t_s = Float64Array.from(keep, (i) => c.poseSeq.t_s[i]);
  const img = new Float32Array(keep.length * 132);
  keep.forEach((i, k) => img.set(c.poseSeq.img.subarray(i * 132, i * 132 + 132), k * 132));
  return [
    { name: 'face_on_60_right_jitter', handedness: 'right', view: 'face_on', poseSeq: a.poseSeq },
    { name: 'dtl_30_left', handedness: 'left', view: 'dtl', poseSeq: b.poseSeq },
    { name: 'face_on_60_dropped_frames', handedness: 'right', view: 'face_on',
      poseSeq: { t_s, img, world: new Float32Array(keep.length * 99), W: c.poseSeq.W, H: c.poseSeq.H, model: 'synthetic' } },
  ];
}

if (process.argv[1] && process.argv[1].endsWith('synth_features.mjs')) {
  const cases = goldenPoseSeqs().map(({ name, handedness, poseSeq }) => {
    const f = computeFeatures(poseSeq, { handedness });
    return { name, handedness, K: f.K, F: f.F, features: Array.from(f.data) };
  });
  writeFileSync(process.argv[2], JSON.stringify({ feature_version: FEATURE_VERSION, cases }));
  console.log(`synth features: ${cases.map((c) => c.K).join(', ')} frames`);
}
