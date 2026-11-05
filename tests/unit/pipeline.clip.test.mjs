// pipeline/clip.js event stage (PRODUCT-SPEC §7, WP-E): no calibration -> NO_CALIBRATION; a slow-motion export with
// the 1/8 speed baked in -> SLOWMO_CORRECTED, real-time metrics, media-time events; no swing -> no shot; the rules
// unless an owner model's card passed its gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClip, detectWithTcn } from '../../app/src/pipeline/clip.js';
import { detect } from '../../app/src/events/detect.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { BALL_CLUB_IDS } from '../../app/src/contract/enums.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { stressSwing } from '../synth/swing.js';
import { ownerModel } from './_owner_model.mjs';

function clipDeps(ps, fps) {
  const cts = Array.from(ps.t_s);
  const W = ps.W;
  const H = ps.H;
  return {
    probe: async () => ({ codec: 'avc1', family: 'avc', width: W, height: H, display_width: W, display_height: H, rotation: 0,
      sample_count: cts.length, effective_fps: fps, nominal_fps: fps, vfr: false, timestamps: 'container', cts_s: cts, reason_codes: [] }),
    decode: async (file, d) => {
      if (d.purpose === 'pose') for (let i = 0; i < cts.length; i++) await d.onFrame({ i }, cts[i], i);
      return { reason_codes: [], decoded: d.purpose === 'pose' ? cts.length : 0 };
    },
    pose: async (frame) => ({ img: ps.img.slice(frame.i * 132, frame.i * 132 + 132), world: new Float32Array(99) }),
    toGray: () => ({ data: new Uint8Array(4), W: 2, H: 2, origin: { u: 0, v: 0 } }),
  };
}
const opts = (view, extra = {}) => ({ view, handedness: 'right', club: { type: 'i7', length_m: 0.94 }, venue: null,
  ids: { shot_id: 'shot-t', session_id: 'sess-t', created_at: '2026-11-05T10:00:00.000Z', app_version: 'test' }, ...extra });

test('an import with no calibration carries NO_CALIBRATION (not SETUP_UNVERIFIED); ball / club rows are NO_CALIBRATION nulls', { timeout: 60000 }, async () => {
  const st = stressSwing({ seed: 5, view: 'face_on', fps: 60, mode: 'baseline' });
  const res = await analyzeClip({}, opts('face_on', { calibration: null }), clipDeps(st.poseSeq, 60));
  const w = res.shot.quality.warnings;
  assert.ok(w.includes(RC.NO_CALIBRATION), JSON.stringify(w));
  assert.ok(!w.includes(RC.SETUP_UNVERIFIED), JSON.stringify(w));
  assert.ok(res.reasons.includes(RC.NO_CALIBRATION));
  for (const id of BALL_CLUB_IDS) {
    const m = res.shot.metrics[id];
    assert.equal(m.value, null, id);
    assert.ok(m.reason_codes.includes(RC.NO_CALIBRATION) || m.validity === 'not_observable' || m.reason_codes.includes(RC.NOT_IMPLEMENTED), `${id}: ${m.reason_codes}`);
  }
  assert.equal(res.events_source, 'rules', 'no owner model -> rules');
  assert.equal(res.time_scale, 1);
  assert.ok(validateShot(res.shot).ok);
});

test('a ×8 slow-motion export (240 fps written at 30 fps) -> SLOWMO_CORRECTED, 240 fps capture, tempo within ±0.3', { timeout: 60000 }, async () => {
  for (const seed of [3, 7]) {
    const st = stressSwing({ seed, view: 'face_on', fps: 240, mode: 'slowmo_x8' });
    assert.equal(st.container_fps, 30);
    const res = await analyzeClip({}, opts('face_on', { calibration: null }), clipDeps(st.poseSeq, 30));
    assert.equal(res.time_scale, 8);
    assert.ok(res.shot.quality.warnings.includes(RC.SLOWMO_CORRECTED));
    assert.ok(res.reasons.includes(RC.SLOWMO_CORRECTED));
    assert.ok(!res.shot.quality.warnings.includes(RC.TIMEBASE_SUSPECT), 'the corrected downswing is plausible');
    assert.equal(res.shot.capture.effective_fps, 240);
    const T = st.swing.truth.metrics;
    const tr = res.shot.metrics.tempo_ratio.value;
    assert.ok(Math.abs(tr - T.tempo_ratio) <= 0.3, `tempo ${tr} vs ${T.tempo_ratio}`);
    assert.ok(Math.abs(res.shot.metrics.downswing_s.value - T.downswing_s) <= 0.04, `downswing ${res.shot.metrics.downswing_s.value} vs ${T.downswing_s}`);
    // event times stay on the clip's own (media) time line, for replay
    const di = res.shot.events.impact.t_s - st.truth.events.impact.t_s;
    assert.ok(Math.abs(di) <= 8 * (2 / 60), `impact media time off by ${di}`);
    assert.ok(validateShot(res.shot).ok);
  }
});

test('no swing in the clip -> NO_SWING_FOUND, never a shot (allowNoSwing is ignored)', async () => {
  const st = stressSwing({ seed: 1, view: 'face_on', fps: 60, mode: 'baseline' });
  const n = 40;
  const still = { ...st.poseSeq, t_s: st.poseSeq.t_s.slice(0, n), img: st.poseSeq.img.slice(0, n * 132) };
  await assert.rejects(analyzeClip({}, opts('face_on', { calibration: null, allowNoSwing: true }), clipDeps(still, 60)), (e) => e.code === 'NO_SWING_FOUND');
  await assert.rejects(analyzeClip({}, opts('face_on', { calibration: null }), clipDeps(still, 60)), (e) => e.code === 'NO_SWING_FOUND');
});

test('detectWithTcn: rules without a model; an owner model only when its card gate passed and covers the view', () => {
  const st = stressSwing({ seed: 4, view: 'face_on', fps: 60, mode: 'baseline' });
  const ps = st.poseSeq;
  const base = detectWithTcn(detect, ps, { view: 'face_on' }, null);
  assert.equal(base.source, 'rules');
  // a predictor that is sure about 8 ordered peaks
  const predict = (f) => {
    const out = new Float32Array(f.K * 9);
    for (let t = 0; t < f.K; t++) out[t * 9 + 8] = 1;
    for (let e = 0; e < 8; e++) {
      const t = Math.round(((e + 1) / 10) * f.K);
      out[t * 9 + 8] = 0;
      out[t * 9 + e] = 0.97;
      out[t * 9 + 8] = 0.03;
    }
    return out;
  };
  const card = ownerModel().json.model_card;
  const ok = detectWithTcn(detect, ps, { view: 'face_on' }, { predict, meta: { card } });
  assert.equal(ok.source, 'tcn');
  const notPassed = { ...card, owner_holdout: { ...card.owner_holdout, gate: { passed: false } } };
  const r1 = detectWithTcn(detect, ps, { view: 'face_on' }, { predict, meta: { card: notPassed } });
  assert.equal(r1.source, 'rules');
  assert.equal(r1.fallback, 'tcn_owner_gate');
  const r2 = detectWithTcn(detect, ps, { view: 'face_on' }, { predict, meta: { card: { ...card, golfdb: true } } });
  assert.equal(r2.fallback, 'tcn_card_third_party');
  const r3 = detectWithTcn(detect, ps, { view: 'high_behind' }, { predict, meta: { card } });
  assert.equal(r3.fallback, 'tcn_view');
  const r4 = detectWithTcn(detect, ps, { view: 'face_on' }, { predict, meta: {} });
  assert.equal(r4.fallback, 'tcn_no_card');
  for (const r of [r1, r2, r3, r4]) assert.deepEqual(r.events.impact, base.events.impact);
});
