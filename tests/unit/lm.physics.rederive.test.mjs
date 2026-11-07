// physics/lm rederive (LAUNCH-MONITOR-SPEC §2.1: recompute the launch-monitor part of a stored shot from its metrics,
// club, view and calibration — no video) and clubProfile (§5.0-3), on the golf-shot/2 fixtures of LM-A.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rederive, clubProfile, LM_PARAMS, deriveLaunchMonitor } from '../../app/src/physics/lm/index.js';
import { validateShot, formatErrors } from '../../app/src/contract/validate.js';
import { LM_METRIC_IDS } from '../../app/src/contract/enums.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { addWarning } from '../../app/src/contract/shot.js';

const fx = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/shots/v2/${name}.json`, import.meta.url), 'utf8'));
const strip = (s) => { const o = { ...s }; delete o._expect; delete o._note; return o; };
const ok = (shot) => { const v = validateShot(shot); assert.ok(v.ok, formatErrors(v.errors)); };

test('face_on fixture: valid golf-shot/2, input untouched, current model version, stored attack angle reused', () => {
  const shot = strip(fx('valid_face_on_240'));
  const before = JSON.stringify(shot);
  const r = rederive(shot, { settings: { ground: 'normal' } });
  assert.equal(JSON.stringify(shot), before, 'rederive must not mutate its input');
  ok(r);
  assert.equal(r.algorithms.lm.version, LM_PARAMS.version);
  assert.match(r.algorithms.lm.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.revision, shot.revision, 'the caller bumps the revision');
  for (const id of ['attack_angle_deg', 'dynamic_loft_deg', 'spin_loft_deg', 'spin_rate_rpm', 'carry_m', 'total_m', 'apex_m', 'landing_angle_deg', 'hang_time_s']) {
    assert.notEqual(r.metrics[id].value, null, id);
  }
  assert.equal(r.metrics.attack_angle_deg.value, shot.metrics.attack_angle_deg.value);
  assert.ok(Math.abs(r.flight.landing.x_m - r.metrics.carry_m.value) <= 0.5);
  assert.deepEqual(r.flight.samples[0].slice(1), shot.flight.samples[0].slice(1), 'flight starts where the stored flight started');
  assert.deepEqual(r.tracks, shot.tracks);
  assert.deepEqual(rederive(shot, { settings: { ground: 'normal' } }), r, 'deterministic per shot id');
  const firm = rederive(shot, { settings: { ground: 'firm' } });
  assert.ok(firm.metrics.total_m.value > r.metrics.total_m.value && firm.flight.ground === 'firm');
});

test('migrated v1 face_on: no attack angle -> loft / spin null, flight from the spin prior; still valid', () => {
  const shot = strip(fx('migrated_v1_face_on'));
  const r = rederive(shot);
  ok(r);
  for (const id of ['dynamic_loft_deg', 'spin_loft_deg', 'spin_rate_rpm']) assert.equal(r.metrics[id].value, null, id);
  for (const id of ['carry_m', 'total_m', 'apex_m', 'landing_angle_deg', 'hang_time_s']) assert.notEqual(r.metrics[id].value, null, id);
  assert.ok(r.metrics.carry_m.reason_codes.includes(RC.SPIN_ASSUMED));
  // attack angle needs the club-head track, which a golf-shot/1 record never had: it stays MIGRATED_V1 (integration
  // §5.3; not TRACK_TOO_SHORT), its dependants DEPENDS_ON_NULL; every other new id is recomputed
  assert.deepEqual(r.metrics.attack_angle_deg.reason_codes, [RC.MIGRATED_V1]);
  for (const id of ['dynamic_loft_deg', 'spin_loft_deg', 'spin_rate_rpm']) assert.deepEqual(r.metrics[id].reason_codes, [RC.DEPENDS_ON_NULL], id);
  for (const id of LM_METRIC_IDS.filter((x) => x !== 'attack_angle_deg')) assert.ok(!r.metrics[id].reason_codes.includes(RC.MIGRATED_V1), id);
});

test('high_behind and dtl fixtures; setup warnings are re-attributed', () => {
  const hb = rederive(strip(fx('valid_high_behind_240')));
  ok(hb);
  for (const id of ['face_angle_deg', 'spin_axis_deg', 'carry_m', 'carry_side_m', 'curve_m', 'ball_speed_mps']) {
    assert.equal(hb.metrics[id].validity, 'low_confidence', id);
  }
  assert.ok(hb.flight.band);
  const dtl = rederive(strip(fx('valid_dtl_30')));
  ok(dtl);
  for (const id of LM_METRIC_IDS) assert.equal(dtl.metrics[id].value, null, id);
  assert.equal(dtl.flight, null);
  const warned = addWarning(strip(fx('valid_face_on_240')), RC.SETUP_UNVERIFIED);
  const w = rederive(warned);
  ok(w);
  assert.ok(w.metrics.carry_m.reason_codes.includes(RC.SETUP_UNVERIFIED) && w.metrics.carry_m.validity === 'low_confidence');
});

test('deriveLaunchMonitor: algorithm block is stable and tracks map ball detections to capture frames', () => {
  const shot = strip(fx('valid_face_on_240'));
  const obs = [{ t_s: 1.0, u: 10, v: 20, r_px: 9 }, { t_s: 1.0 + 1 / 240, u: 30, v: 18, w_px: 16 }, { t_s: 1.0 + 1.1 / 240, u: 31, v: 18 }];
  const r = deriveLaunchMonitor({ view: 'face_on', fps: 240, club: shot.club, metrics: shot.metrics, settings: {}, ballTrack: { obs, times: null }, fit: { ok: true, t0: 1.0, p0: [0, 0, 0.05] } });
  assert.deepEqual(r.tracks, { ball_px: [[240, 10, 20, 9], [241, 30, 18, 8]], impact_frame: 240, view: 'face_on' });
  assert.deepEqual(r.flight.samples[0].slice(1), [0, 0, 0.05]);
  const r2 = deriveLaunchMonitor({ view: 'face_on', fps: 240, club: shot.club, metrics: shot.metrics, settings: {} });
  assert.deepEqual(r.algorithm, r2.algorithm);
  assert.equal(r2.tracks, null);
});

test('clubProfile: mean / SD of recent face_on shots of one club, null below minN or outside the window', () => {
  const base = strip(fx('valid_face_on_240'));
  const mk = (k, days, extra = {}) => {
    const s = JSON.parse(JSON.stringify(base));
    s.created_at = new Date(Date.parse('2026-11-01T10:00:00Z') - days * 86400000).toISOString();
    s.metrics.attack_angle_deg.value = -2 + (k % 5) * 0.5;
    return Object.assign(s, extra);
  };
  const shots = [...Array.from({ length: 22 }, (_, k) => mk(k, k % 10)), mk(99, 45), mk(98, 1, { club: { ...base.club, type: '7i' } })];
  const p = clubProfile(shots, base.club.type);
  assert.equal(p.n, 22);
  assert.ok(Math.abs(p.aoa.mean - (-2 + 0.5 * 2)) < 0.11);
  assert.ok(p.aoa.sd > 0 && p.dl.sd < 1e-9 && Math.abs(p.spin.mean - base.metrics.spin_rate_rpm.value) < 1e-9);
  assert.equal(clubProfile(shots, base.club.type, { minN: 30 }), null);
  assert.equal(clubProfile(shots, base.club.type, { days: 3 }), null);
  assert.equal(clubProfile([], 'driver'), null);
});
