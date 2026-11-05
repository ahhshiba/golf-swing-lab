#!/usr/bin/env node
// training/node/make_owner_fixture.mjs — the synthetic-derived owner labels fixture (PRODUCT-SPEC §8 WP-E):
// 24 swings in 6 sessions (2 per view; modes baseline / waggle / forward_press / finish_relax), poses at 60 Hz
// (16-bit quantised, trimmed to address − 0.8 s (waggle 1.5 s) … finish + 0.6 s),
// labels = the synthetic ground truth, `detected` = the rules at generation time. Written in the teach-mode
// export format golf-swing-lab-labels/1 (docs/training.md). Deterministic: same bytes on every run.
//
//   node training/node/make_owner_fixture.mjs [--out tests/fixtures/owner/labels-fixture.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stressSwing, EVENT_NAMES } from '../../tests/synth/swing.js';
import { detectTimeScaled } from '../../app/src/events/timescale.js';
import { makeLabelRecord } from '../../app/src/store/labels.js';
import { encodeU16, LABELS_FORMAT } from '../../scripts/eval_owner_set.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VIEWS = ['face_on', 'face_on', 'dtl', 'dtl', 'high_behind', 'high_behind'];
const MODES = ['baseline', 'waggle', 'forward_press', 'finish_relax'];
const Q = [-1, 2]; // quantisation range of the 16-bit pose (normalised image units; visibility in [0, 1])
const r6 = (x) => Math.round(x * 1e6) / 1e6;

export function makeOwnerFixture() {
  const swings = [];
  VIEWS.forEach((view, si) => {
    const session_id = `fixture-session-${si + 1}`;
    MODES.forEach((mode, k) => {
      const seed = 100 + 10 * si + k;
      const handedness = seed % 4 === 0 ? 'left' : 'right';
      const st = stressSwing({ seed, view, fps: 60, mode, handedness });
      const T = st.truth.events;
      const t0 = Math.max(st.poseSeq.t_s[0], T.address.t_s - (mode === 'waggle' ? 1.5 : 0.8));
      const t1 = T.finish.t_s + 0.6;
      const keep = [];
      st.poseSeq.t_s.forEach((t, i) => { if (t >= t0 - 1e-9 && t <= t1 + 1e-9) keep.push(i); });
      const n = keep.length;
      const img = new Float32Array(n * 132);
      keep.forEach((i, m) => img.set(st.poseSeq.img.subarray(i * 132, (i + 1) * 132), m * 132));
      const t_s = keep.map((i) => r6(st.poseSeq.t_s[i]));
      const pose = { t_s: Float64Array.from(t_s), img, W: st.poseSeq.W, H: st.poseSeq.H };
      const near = (t) => { let b = 0; for (let i = 1; i < n; i++) if (Math.abs(t_s[i] - t) < Math.abs(t_s[b] - t)) b = i; return b; };
      const truth = Object.fromEntries(EVENT_NAMES.map((e) => [e, { frame: near(T[e].t_s), t_s: r6(T[e].t_s) }]));
      const shot_id = `fixture-${si + 1}-${k + 1}`;
      const audio = k % 2 === 0 ? r6(st.audioOnset_t) : null;
      const det = detectTimeScaled(pose, { view, handedness, audioOnset_t: audio ?? undefined }, { container_fps: 60, duration_s: t_s[n - 1] - t_s[0] });
      const detected = Object.fromEntries(EVENT_NAMES.map((e) => [e, { frame: det[e].frame, t_s: r6(det[e].t_s), conf: det[e].conf, source: det[e].source }]));
      const label = makeLabelRecord({ shot_id, events: truth, labelled_at: '2026-11-05T09:00:00.000Z', fps: 60 });
      swings.push({
        shot_id, session_id, view, handedness, fps: 60, container_fps: 60, time_scale: 1, audio_onset_t: audio,
        synthetic: { seed, mode }, detected, label,
        pose: { hz: 60, W: st.poseSeq.W, H: st.poseSeq.H, model: 'synthetic', t_s, q: Q, img_u16: encodeU16(img, Q[0], Q[1]) },
      });
    });
  });
  return {
    format: LABELS_FORMAT, exported_at: '2026-11-05T09:00:00.000Z', app_version: 'fixture',
    source: 'synthetic (tests/synth/swing.js stressSwing; training/node/make_owner_fixture.mjs) — not real owner data',
    swings,
  };
}

function main() {
  const i = process.argv.indexOf('--out');
  const out = i > 0 ? process.argv[i + 1] : path.join(ROOT, 'tests', 'fixtures', 'owner', 'labels-fixture.json');
  const fx = makeOwnerFixture();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(fx) + '\n');
  console.log(`owner fixture: ${fx.swings.length} swings in ${new Set(fx.swings.map((s) => s.session_id)).size} sessions -> ${out} (${fs.statSync(out).size} B)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
