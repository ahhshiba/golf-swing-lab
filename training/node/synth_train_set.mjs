#!/usr/bin/env node
// training/node/synth_train_set.mjs — synthetic training swings for training/synth_pretrain.py (PRODUCT-SPEC §7.4:
// the owner model starts from scratch or from a model trained ONLY on synthetic swings; no GolfDB data).
// evfeat-1 features at 30 Hz (events/features.js, the app's own code) + the ground-truth event times, for swings
// from tests/synth/swing.js stressSwing over the 3 views and the stress modes (slowmo_x8 on its real time line).
//   node training/node/synth_train_set.mjs <out.json> [--n 240] [--seed0 1000]
import fs from 'node:fs';
import { computeFeatures, FEATURE_VERSION } from '../../app/src/events/features.js';
import { scalePoseTime } from '../../app/src/events/timescale.js';
import { stressSwing, STRESS_MODES, EVENT_NAMES } from '../../tests/synth/swing.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const out = process.argv[2];
if (!out || out.startsWith('--')) { console.error('usage: synth_train_set.mjs <out.json> [--n N] [--seed0 S]'); process.exit(2); }
const n = arg('--n', 240);
const seed0 = arg('--seed0', 1000);
const VIEWS = ['face_on', 'dtl', 'high_behind'];
const swings = [];
for (let i = 0; i < n; i++) {
  const seed = seed0 + i;
  const view = VIEWS[i % 3];
  const mode = STRESS_MODES[Math.floor(i / 3) % STRESS_MODES.length];
  const handedness = seed % 4 === 0 ? 'left' : 'right';
  const st = stressSwing({ seed, view, fps: 60, mode, handedness });
  // slow motion: train on the corrected (real) time line, as the app does after the time-scale search
  const ps = st.time_scale === 1 ? st.poseSeq : scalePoseTime(st.poseSeq, st.time_scale);
  const f = computeFeatures(ps, { handedness });
  const tEv = EVENT_NAMES.map((e) => st.truth.events[e].t_s / st.time_scale); // the same (scaled) time line as ps
  swings.push({ seed, view, mode, handedness, K: f.K, F: f.F, t0: f.t_s[0], hz: 30, features: Array.from(f.data, (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null)), t_events: tEv });
}
fs.writeFileSync(out, JSON.stringify({ feature_version: FEATURE_VERSION, generator: 'tests/synth/swing.js stressSwing (synthetic-v2)', golfdb: false, swings }));
console.log(`synthetic training set: ${swings.length} swings -> ${out}`);
