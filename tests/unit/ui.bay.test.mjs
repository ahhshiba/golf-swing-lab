// WP-B: session/bay.js returns numbers + verdict codes only (no prose), and tripodPlacement (setup step 1, UX-02).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bayAdvice, tripodPlacement, twoMeasureCheck, BAY_VERDICTS, DRIVER_LENGTH_M } from '../../app/src/session/bay.js';
import { NOMINAL_GEOMETRY } from '../../app/src/geom/camera.js';
import { diagramGeometry } from '../../app/src/ui/tripod-diagram.js';
import { fixInstruction, cameraProblem, SETUP_UI_STEPS } from '../../app/src/ui/setup.js';
import { heroMetrics, LIVE_MEASURABLE } from '../../app/src/ui/live.js';

const CJK = /[一-鿿]/;

test('bayAdvice: numbers and verdict only, every row', () => {
  for (const [B, verdict, D, h] of [[3.1, 'ideal', 2.7, 0.87], [2.7, 'usable', 2.45, 0.74], [2.5, 'usable_short', 2.25, 0.67], [2.3, 'not_guaranteed', 2.05, 0.59]]) {
    const a = bayAdvice(B);
    assert.equal(a.ok, true);
    assert.equal(a.verdict, verdict);
    assert.ok(Math.abs(a.D_m - D) < 1e-9, `${B}: D ${a.D_m}`);
    assert.equal(a.h_max_m, h);
    assert.ok(Number.isFinite(a.shift_m));
    assert.ok(!CJK.test(JSON.stringify(a)), JSON.stringify(a));
    assert.equal('text' in a, false);
  }
  assert.deepEqual(bayAdvice(NaN), { ok: false, B_m: null });
  assert.deepEqual(bayAdvice(0.2), { ok: false, B_m: null });
  assert.deepEqual([...BAY_VERDICTS], ['ideal', 'usable', 'usable_short', 'not_guaranteed']);
  assert.ok(!CJK.test(readFileSync(new URL('../../app/src/session/bay.js', import.meta.url), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')));
});

test('bay verdicts are worded in both locales (title, body with {D} {h} {shift}, short)', () => {
  for (const loc of ['zh-Hant', 'en']) {
    const cat = JSON.parse(readFileSync(new URL(`../../app/i18n/${loc}/bay.json`, import.meta.url), 'utf8'));
    for (const v of BAY_VERDICTS) for (const k of [`verdict.${v}`, `body.${v}`, `short.${v}`]) assert.equal(typeof cat[k], 'string', `${loc} bay.${k}`);
    assert.match(cat['body.usable'], /\{D\}.*\{h\}/);
  }
});

test('tripodPlacement: face-on follows the measured bay, else the nominal geometry; DTL behind the mat', () => {
  const venue = { mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3, ball_x_m: 0 };
  const nom = tripodPlacement(venue, 'face_on');
  assert.deepEqual([nom.D_m, nom.h_m, nom.side_m, nom.orientation, nom.source, nom.verdict], [NOMINAL_GEOMETRY.face_on.D, 0.84, 0.4, 'landscape', 'nominal', null]);
  assert.ok(Math.abs(nom.from_edge_m - 2.4) < 1e-9);
  assert.equal(nom.drivers, 2);
  const bay = tripodPlacement({ ...venue, bay_B_m: 2.7 }, 'face_on');
  assert.ok(Math.abs(bay.D_m - 2.45) < 1e-9);
  assert.equal(bay.h_m, 0.74); // min(0.84, h_max 0.74)
  assert.equal(bay.verdict, 'usable');
  assert.equal(bay.source, 'bay');
  assert.ok(Math.abs(bay.from_edge_m - 2.15) < 1e-9);
  const dtl = tripodPlacement(venue, 'dtl');
  assert.equal(dtl.orientation, 'portrait');
  assert.ok(Math.abs(dtl.from_edge_m - (3.25 - 0.75)) < 1e-9);
  assert.equal(dtl.side_dir, 'golfer');
  assert.equal(tripodPlacement(venue, 'high_behind').h_m, 1.7);
  assert.equal(DRIVER_LENGTH_M, 1.15);
  assert.throws(() => tripodPlacement(venue, 'side'), RangeError);
  assert.equal(twoMeasureCheck(1.5, 1.503).ok, true);
  assert.equal(twoMeasureCheck(1.5, 1.5031).ok, false);
});

test('tripod diagram: camera drawn left of the mat, no mirroring, all points inside the view box', () => {
  for (const view of ['face_on', 'dtl', 'high_behind']) {
    const p = tripodPlacement({ mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3 }, view);
    const g = diagramGeometry(p, {});
    const cam = g.map(...g.pts.cam);
    const ball = g.map(0, 0);
    assert.ok(cam[0] < ball[0], `${view}: camera left of the ball`);
    for (const q of [...g.pts.mat, g.pts.cam, g.pts.golfer]) { const [u, v] = g.map(...q); assert.ok(u >= 0 && v >= 0 && u <= g.box.w && v <= g.box.h, `${view}: ${q} outside`); }
    // orientation preserved (determinant of the map > 0 in y-down coordinates means a mirror)
    const o = g.map(0, 0); const ex = g.map(1, 0); const ey = g.map(0, 1);
    const det = (ex[0] - o[0]) * (ey[1] - o[1]) - (ex[1] - o[1]) * (ey[0] - o[0]);
    assert.ok(det < 0, `${view}: mirrored (det ${det})`);
  }
});

test('setup fix instruction: one plain action with the right direction for each failing check', () => {
  const f = (check, value, limit = 1, severity = 'red') => fixInstruction({ failures: [{ check, value, limit, severity }] });
  assert.equal(f('abs_yaw_deg', 1.8).code, 'setup.fix.turn_right');
  assert.equal(f('abs_yaw_deg', -1.8).code, 'setup.fix.turn_left');
  assert.equal(f('abs_pitch_deg', 2).code, 'setup.fix.tilt_down');
  assert.equal(f('abs_roll_deg', -0.9).code, 'setup.fix.rotate_cw');
  assert.deepEqual(f('rel_D_m', 0.08), { check: 'rel_D_m', code: 'setup.fix.move_closer', m: 0.08 });
  assert.equal(f('rel_h_m', -0.05).code, 'setup.fix.raise');
  assert.equal(f('rel_X_m', 0.07).code, 'setup.fix.move_left');
  assert.equal(f('rel_Y_m', 0.07).code, 'setup.fix.move_right');
  assert.ok(Math.abs(f('min_D_m', 2.5, 2.75).m - 0.25) < 1e-9);
  assert.equal(f('corners_in_frame', -0.01, 0).code, 'setup.fix.frame_mat');
  assert.equal(fixInstruction({ failures: [] }), null);
  // the most fundamental failure wins; amber only when nothing red failed
  const mix = fixInstruction({ failures: [{ check: 'frames_budget', value: 5, limit: 6, severity: 'amber' }, { check: 'rel_h_m', value: 0.05, limit: 0.03, severity: 'red' }, { check: 'rmse_px', value: 3, limit: 2, severity: 'red' }] });
  assert.equal(mix.code, 'setup.fix.retap');
  for (const loc of ['zh-Hant', 'en']) {
    const cat = JSON.parse(readFileSync(new URL(`../../app/i18n/${loc}/setup.json`, import.meta.url), 'utf8'));
    for (const k of ['turn_right', 'turn_left', 'tilt_down', 'tilt_up', 'rotate_ccw', 'rotate_cw', 'move_closer', 'move_back', 'lower', 'raise', 'move_left', 'move_right', 'frame_mat', 'retap', 'lens_1x', 'align_ghost', 'ball_again', 'preset_view', 'frames_budget', 'generic']) assert.equal(typeof cat[`fix.${k}`], 'string', `${loc} setup.fix.${k}`);
    for (const s of SETUP_UI_STEPS) for (const k of ['title', 'body']) assert.equal(typeof cat[`${s}.${k}`], 'string', `${loc} setup.${s}.${k}`);
  }
});

test('camera problem classification and live hero metrics', () => {
  assert.equal(cameraProblem('granted', null), null);
  assert.equal(cameraProblem('unknown', null), null);
  assert.equal(cameraProblem('denied', 'NotAllowedError'), 'denied');
  assert.equal(cameraProblem('denied', 'NotReadableError'), 'busy');
  assert.equal(cameraProblem('denied', 'NotFoundError'), 'missing');
  assert.equal(cameraProblem('denied', null), 'denied');
  assert.equal(cameraProblem('busy', null), 'busy');
  assert.equal(cameraProblem('granted', null, false), 'missing');
  assert.deepEqual(heroMetrics({ metrics: ['tempo_ratio', 'club_speed_mps', 'carry_m'] }), ['tempo_ratio', 'club_speed_mps']);
  assert.deepEqual(heroMetrics({ metrics: ['carry_m'] }), ['tempo_ratio']);
  assert.deepEqual(heroMetrics({ metrics: ['carry_m', 'ball_speed_mps'] }, 'highspeed'), ['carry_m', 'ball_speed_mps']);
  assert.ok(!LIVE_MEASURABLE.includes('carry_m'));
});
