// Generates the JS-side parity fixtures used by training/tests (features with missing frames / NaN rows / left
// handedness / tiny sequences, and decodeOrdered on random probability matrices). Deterministic.
// Usage (repository root): node training/node/make_fixtures.mjs [outDir=training/tests/fixtures]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeFeatures, FEATURE_VERSION } from '../../app/src/events/features.js';
import { decodeOrdered } from '../../app/src/events/detect.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { synthSwing } from '../../tests/synth/swing.js';

const outDir = process.argv[2] ?? 'training/tests/fixtures';
const num = (x) => (Number.isFinite(x) ? x : null); // NaN -> null in JSON
const arr = (a) => Array.from(a, num);

function slice(ps, i0, i1) {
  return { t_s: ps.t_s.slice(i0, i1), img: ps.img.slice(i0 * 132, i1 * 132), W: ps.W, H: ps.H };
}

const cases = [];
{ // A: face_on 60 fps, right-handed, timestamp jitter
  const s = synthSwing({ seed: 11, view: 'face_on', fps: 60, tsJitter_s: 0.002 });
  cases.push({ name: 'face_on_60_right_jitter', handedness: 'right', ps: slice(s.poseSeq, 20, 110) });
}
{ // B: dtl 30 fps, left-handed golfer
  const s = synthSwing({ seed: 12, view: 'dtl', fps: 30, handedness: 'left' });
  cases.push({ name: 'dtl_30_left', handedness: 'left', ps: slice(s.poseSeq, 5, 60) });
}
{ // C: missing frames (dropped frames, a 0.25 s gap) and two all-NaN rows
  const s = synthSwing({ seed: 13, view: 'face_on', fps: 60 });
  const ps = slice(s.poseSeq, 0, 120);
  const rng = mulberry32(99);
  const keep = [];
  for (let i = 0; i < 120; i++) if ((i < 40 || i >= 55) && rng() > 0.2) keep.push(i);
  const t_s = new Float64Array(keep.length);
  const img = new Float32Array(keep.length * 132);
  keep.forEach((i, k) => { t_s[k] = ps.t_s[i]; img.set(ps.img.subarray(i * 132, i * 132 + 132), k * 132); });
  for (const r of [7, 30]) img.fill(NaN, r * 132, r * 132 + 132);
  cases.push({ name: 'face_on_60_missing_nan', handedness: 'right', ps: { t_s, img, W: ps.W, H: ps.H } });
}
{ // D: tiny sequences
  const s = synthSwing({ seed: 14, view: 'face_on', fps: 30 });
  cases.push({ name: 'single_frame', handedness: 'right', ps: slice(s.poseSeq, 3, 4) });
  cases.push({ name: 'two_frames_left', handedness: 'left', ps: slice(s.poseSeq, 3, 5) });
}

const feat = cases.map(({ name, handedness, ps }) => {
  const f = computeFeatures(ps, { handedness });
  return {
    name, handedness, input: { t_s: Array.from(ps.t_s), img: arr(ps.img), W: ps.W, H: ps.H },
    K: f.K, t_grid: Array.from(f.t_s), torso_px: f.torso_px, data: arr(f.data),
  };
});
writeFileSync(join(outDir, 'evfeat-extra.json'),
  JSON.stringify({ version: FEATURE_VERSION, generator: 'training/node/make_fixtures.mjs', cases: feat }));

// decodeOrdered on random matrices: peaked, flat, ties, and a reversed (non-monotone argmax) case.
const rng = mulberry32(2026);
const dec = [];
for (let c = 0; c < 12; c++) {
  const T = c === 7 ? 40 : [1, 2, 9, 40, 120][c % 5];
  const p = new Float64Array(T * 9);
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (let e = 0; e < 9; e++) { const v = c === 3 ? 1 : Math.exp(4 * rng()); p[t * 9 + e] = v; s += v; }
    for (let e = 0; e < 9; e++) p[t * 9 + e] /= s;
  }
  if (c === 7) { p.fill(0.001); for (let e = 0; e < 8; e++) p[(T - 1 - e * 4) * 9 + e] = 0.9; } // argmax order reversed
  const r = decodeOrdered(p, 9);
  dec.push({ T, probs: Array.from(p), frames: Array.from(r.frames), score: r.score });
}
writeFileSync(join(outDir, 'decode-ordered.json'),
  JSON.stringify({ generator: 'training/node/make_fixtures.mjs', cases: dec }));
console.log(`wrote ${feat.length} feature cases, ${dec.length} decode cases to ${outDir}`);
