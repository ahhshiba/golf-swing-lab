// LAUNCH-MONITOR-SPEC §5.2 LM-B acceptance 4: for every view × fps (30, 60, 120, 240) × the 36 metric ids, the shot
// metrics after deriveLaunchMonitor agree with metrics/registry.js cellFor: a 不可 / too-slow cell is null with the
// cell's code; an allowed cell (all inputs present) has a number at exactly the cell's validity; every null has a
// code; every estimated number with a model value_origin carries a ★ model code (§2.3); dtl's 14 new ids are null.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLaunchMonitor } from '../../app/src/physics/lm/index.js';
import { REGISTRY, cellFor } from '../../app/src/metrics/registry.js';
import { METRIC_IDS, METRIC_IDS_V1, LM_METRIC_IDS, METRIC_UNITS, MODEL_ORIGINS } from '../../app/src/contract/enums.js';
import { MODEL_CODES, RC } from '../../app/src/contract/reason-codes.js';
import { metricNull, metricValue } from '../../app/src/contract/metric.js';
import { validateMetric } from '../../app/src/contract/validate.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

// plausible input values (the v1 rows and the measured launch-monitor inputs)
const SAMPLE = {
  backswing_s: 0.8, downswing_s: 0.27, tempo_ratio: 3, head_sway_x_m: 0.02, head_lift_z_m: 0.01, head_depth_y_m: 0.02,
  spine_forward_tilt_deg: 35, spine_side_tilt_deg: 8, shoulder_turn_deg: 90, hip_turn_deg: 45, x_factor_deg: 45,
  hand_plane_dev_m: 0.03, top_shaft_angle_deg: 2, weight_shift_pct: 60, early_extension_m: 0.02, club_speed_mps: 40,
  club_path_deg: 1.5, ball_speed_mps: 54, launch_v_deg: 16, launch_h_deg: 2.5, carry_m: 150, smash_factor: 1.35,
  attack_angle_deg: -4,
};

function inputs(view, fps) {
  const out = {};
  for (const id of [...METRIC_IDS_V1, 'attack_angle_deg']) {
    const c = cellFor(id, view, fps);
    if (c.validity === null) { out[id] = metricNull('not_observable', [c.code], METRIC_UNITS[id], REGISTRY[id].value_origin); continue; }
    const v = SAMPLE[id];
    const s = Math.abs(v) * 0.03 + 0.3;
    // the attack angle and the high_behind club speed are stored measurements (club_track), as rederive sees them
    out[id] = metricValue({ value: v, unit: METRIC_UNITS[id], ci95: [v - 2 * s, v + 2 * s], sigma: s, validity: c.validity,
      value_origin: id === 'attack_angle_deg' ? 'club_track' : REGISTRY[id].value_origin, reason_codes: [] });
  }
  return out;
}

test('every view × fps × 36 ids: validity per registry.cellFor, nulls with codes, model codes on model numbers', () => {
  let checked = 0;
  for (const view of ['face_on', 'dtl', 'high_behind']) {
    for (const fps of [30, 60, 120, 240]) {
      const base = inputs(view, fps);
      const r = deriveLaunchMonitor({ view, fps, club: { type: '7i', lie: 'mat' }, metrics: base, fit: null, clubTrack: null,
        calibration: null, settings: { ground: 'normal', crossView: false }, clubProfile: null, rng: mulberry32(fps) });
      const all = { ...base, ...r.metrics };
      for (const id of LM_METRIC_IDS) assert.ok(r.metrics[id], `${view}@${fps}: ${id} missing from the output`);
      for (const id of METRIC_IDS) {
        const m = all[id];
        const c = cellFor(id, view, fps);
        const at = `${view}@${fps} ${id}`;
        assert.deepEqual(validateMetric(m, id), [], at);
        if (m.value === null) assert.ok(m.reason_codes.length > 0, `${at}: null without a code`);
        if (c.validity === null) {
          assert.equal(m.value, null, `${at} must be null`);
          assert.ok(m.reason_codes.includes(c.code), `${at}: ${m.reason_codes} lacks ${c.code}`);
        } else {
          assert.notEqual(m.value, null, `${at}: allowed cell with all inputs present is null (${m.reason_codes})`);
          assert.equal(m.validity, c.validity, at);
        }
        if (m.value !== null && MODEL_ORIGINS.includes(m.value_origin)) assert.ok(m.reason_codes.some((x) => MODEL_CODES.includes(x)), `${at}: no model code`);
        if (m.value !== null && LM_METRIC_IDS.includes(id) && id !== 'attack_angle_deg') {
          assert.ok(m.reason_codes.some((x) => MODEL_CODES.includes(x)), `${at}: derived number without a model code`);
          assert.ok(m.sigma > 0 && m.ci95[0] <= m.value && m.value <= m.ci95[1], `${at}: ci95 / sigma`);
        }
        checked++;
      }
      if (view === 'dtl') for (const id of LM_METRIC_IDS) assert.equal(all[id].value, null, `dtl ${id}`);
      if (fps === 240 && view !== 'dtl') assert.ok(r.flight && Math.abs(r.flight.landing.x_m - all.carry_m.value) <= 0.5, `${view} flight`);
      if (fps < 200) assert.equal(r.flight, null);
    }
  }
  assert.equal(checked, 3 * 4 * 36);
});

test('high_behind carry / side keep the prior codes (D3: shown as estimated-low with an error); hb spin / apex null', () => {
  const r = deriveLaunchMonitor({ view: 'high_behind', fps: 240, club: { type: 'driver' }, metrics: inputs('high_behind', 240), settings: {}, rng: mulberry32(9) });
  for (const id of ['carry_m', 'total_m', 'carry_side_m', 'curve_m', 'total_side_m']) {
    const m = r.metrics[id];
    assert.equal(m.validity, 'low_confidence', id);
    for (const c of [RC.FLIGHT_MODELLED, RC.SMASH_ASSUMED, RC.LAUNCH_V_ASSUMED]) assert.ok(m.reason_codes.includes(c), `${id} ${c}`);
  }
  for (const id of ['face_angle_deg', 'face_to_path_deg', 'spin_axis_deg']) {
    assert.deepEqual(r.metrics[id].reason_codes.slice(0, 2), [RC.DPLANE_MODEL, RC.SPIN_LOFT_ASSUMED], id);
  }
  assert.deepEqual(r.metrics.ball_speed_mps.reason_codes.slice(0, 1), [RC.SMASH_ASSUMED]);
  for (const id of ['spin_rate_rpm', 'apex_m', 'landing_angle_deg', 'hang_time_s', 'dynamic_loft_deg', 'spin_loft_deg', 'attack_angle_deg']) {
    assert.equal(r.metrics[id].value, null, id);
  }
  assert.ok(r.flight.band && r.flight.band.side_lo.length + r.flight.band.side_hi.length === 16);
});

test('face_on without an attack angle: dynamic loft / spin loft / spin null (DEPENDS_ON_NULL / TRACK_TOO_SHORT), flight on the spin prior', () => {
  const base = inputs('face_on', 240);
  delete base.attack_angle_deg;
  const r = deriveLaunchMonitor({ view: 'face_on', fps: 240, club: { type: '7i' }, metrics: base, settings: {}, rng: mulberry32(2) });
  assert.deepEqual(r.metrics.attack_angle_deg.reason_codes, [RC.TRACK_TOO_SHORT]);
  for (const id of ['dynamic_loft_deg', 'spin_loft_deg', 'spin_rate_rpm']) assert.deepEqual(r.metrics[id].reason_codes, [RC.DEPENDS_ON_NULL], id);
  assert.ok(r.metrics.carry_m.reason_codes.includes(RC.SPIN_ASSUMED) && !r.metrics.carry_m.reason_codes.includes(RC.SPIN_MODELLED));
  // a migrated golf-shot/1 record (rederive: no club track) keeps MIGRATED_V1 as the attack-angle reason; dependants DEPENDS_ON_NULL
  const mig = { ...inputs('face_on', 240), attack_angle_deg: { value: null, unit: 'deg', validity: 'not_computed', reason_codes: [RC.MIGRATED_V1], value_origin: 'club_track', ci95: null, sigma: null } };
  const rm = deriveLaunchMonitor({ view: 'face_on', fps: 240, club: { type: '7i' }, metrics: mig, clubTrack: null, settings: {}, rng: mulberry32(2) });
  assert.deepEqual(rm.metrics.attack_angle_deg.reason_codes, [RC.MIGRATED_V1]);
  for (const id of ['dynamic_loft_deg', 'spin_loft_deg', 'spin_rate_rpm']) assert.deepEqual(rm.metrics[id].reason_codes, [RC.DEPENDS_ON_NULL], id);
  const with_ = deriveLaunchMonitor({ view: 'face_on', fps: 240, club: { type: '7i' }, metrics: inputs('face_on', 240), settings: {}, rng: mulberry32(2) });
  assert.ok(with_.metrics.carry_m.reason_codes.includes(RC.SPIN_MODELLED) && with_.metrics.spin_rate_rpm.reason_codes[0] === RC.SPIN_MODELLED);
});

test('an input below its own cell (e.g. a setup warning) makes the derived numbers low_confidence and passes its code on', () => {
  const base = inputs('face_on', 240);
  base.ball_speed_mps = { ...base.ball_speed_mps, validity: 'low_confidence', reason_codes: [RC.SETUP_UNVERIFIED] };
  const r = deriveLaunchMonitor({ view: 'face_on', fps: 240, club: { type: '7i' }, metrics: base, settings: {}, rng: mulberry32(2) });
  for (const id of ['carry_m', 'total_m', 'apex_m']) {
    assert.equal(r.metrics[id].validity, 'low_confidence', id);
    assert.ok(r.metrics[id].reason_codes.includes(RC.SETUP_UNVERIFIED), id);
  }
  assert.equal(r.metrics.dynamic_loft_deg.validity, 'estimated', 'dynamic loft does not use the ball speed');
});

test('ground setting moves the roll only (firm > normal > soft); default normal', () => {
  const run = (ground) => deriveLaunchMonitor({ view: 'face_on', fps: 240, club: { type: '7i' }, metrics: inputs('face_on', 240), settings: { ground }, rng: mulberry32(4) });
  const [f, nn, s, d] = [run('firm'), run('normal'), run('soft'), run(undefined)];
  assert.equal(f.metrics.carry_m.value, s.metrics.carry_m.value);
  assert.ok(f.metrics.total_m.value > nn.metrics.total_m.value && nn.metrics.total_m.value > s.metrics.total_m.value);
  assert.equal(d.metrics.total_m.value, nn.metrics.total_m.value);
  assert.equal(nn.flight.ground, 'normal');
  assert.equal(f.flight.ground, 'firm');
});
