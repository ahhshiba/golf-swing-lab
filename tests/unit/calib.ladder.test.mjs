import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMethod, calibrate, solveClubLine, solveBallOnly, LADDER_PRIORS } from '../../app/src/calib/ladder.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { synthMatScene, synthClub, synthBall } from '../synth/mat.js';

const CAL_KEYS = ['method', 'source', 'f_px', 'f_locked', 'pose', 'pose_sigma', 'reproj_rmse_px', 'slope_deg', 'preset_dev',
  'readout_ms', 'readout_source', 'camera'];

test('selectMethod: 4 corners → mat_pnp; 2 hidden corners → club_line (with gravity) → ball_only → null', () => {
  const c = [[1, 2], [3, 4], [5, 6], [7, 8]];
  const g = { pitch_deg: 0, roll_deg: 0 };
  const club = { p1: [0, 0], p2: [10, 0] };
  assert.equal(selectMethod({ corners: c, club, ball: [1, 1], gravity: g }), 'mat_pnp');
  assert.equal(selectMethod({ corners: [c[0], c[1], null, null], club, ball: [1, 1], gravity: g }), 'club_line');
  assert.equal(selectMethod({ corners: [c[0], c[1], null, null], club, ball: [1, 1], gravity: null }), 'ball_only');
  assert.equal(selectMethod({ corners: null, club: null, ball: [1, 1], gravity: g }), 'ball_only');
  assert.equal(selectMethod({ corners: [c[0], [NaN, 1], c[2], c[3]], club: null, ball: null, gravity: g }), null);
});

for (const view of ['face_on', 'dtl', 'high_behind']) {
  test(`${view}: the ladder degrades automatically and sigma grows honestly (mat < club_line < ball_only)`, () => {
    const rng = mulberry32(31 + view.length);
    const yawErr = { mat_pnp: [], club_line: [], ball_only: [] };
    const sig = { mat_pnp: [], club_line: [], ball_only: [] };
    for (let k = 0; k < 40; k++) {
      const sc = synthMatScene({ view, rng, sigmaPx: 1 });
      const ctx = { venue: sc.venue, view, W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, D_assumed: sc.truth.D_m + gauss(rng, 0, 0.05) };
      const club = synthClub(sc.cam, rng);
      const ball = synthBall(sc.cam, rng);
      const runs = [
        calibrate({ corners: sc.corners, club, ball, gravity: sc.gravity }, ctx),
        calibrate({ corners: [sc.corners[0], sc.corners[1], null, null], club, ball, gravity: sc.gravity }, ctx),
        calibrate({ corners: [null, null, sc.corners[2], sc.corners[3]], club: null, ball, gravity: sc.gravity }, ctx),
      ];
      assert.deepEqual(runs.map((r) => r.method), ['mat_pnp', 'club_line', 'ball_only']);
      for (const r of runs) {
        assert.ok(r.ok);
        assert.deepEqual(Object.keys(r.calibration), CAL_KEYS);
        assert.equal(r.calibration.method, r.method);
        yawErr[r.method].push(r.calibration.pose.yaw_deg - sc.truth.yaw_deg);
        sig[r.method].push(r.calibration.pose_sigma.yaw_deg);
        // honest: the error is inside 4 sigma for every key
        for (const key of Object.keys(r.calibration.pose)) {
          const e = Math.abs(r.calibration.pose[key] - sc.truth[key]);
          assert.ok(e <= 4 * r.calibration.pose_sigma[key] + 1e-9, `${view} ${r.method} ${key}: err ${e} sigma ${r.calibration.pose_sigma[key]}`);
        }
      }
      assert.ok(runs[0].calibration.pose_sigma.yaw_deg < runs[1].calibration.pose_sigma.yaw_deg);
      assert.ok(runs[1].calibration.pose_sigma.yaw_deg < runs[2].calibration.pose_sigma.yaw_deg);
      assert.ok(runs[0].calibration.pose_sigma.D_m < runs[1].calibration.pose_sigma.D_m);
    }
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    assert.ok(med(sig.club_line) >= 1.3 && med(sig.club_line) <= 2.2, `club_line yaw sigma ${med(sig.club_line)}`);
    assert.ok(med(sig.ball_only) >= 3 && med(sig.ball_only) <= 5, `ball_only yaw sigma ${med(sig.ball_only)}`);
    assert.ok(med(sig.mat_pnp) <= 0.3);
  });
}

test('club_line yaw sigma comes from the fit (gravity roll through h/D) on face_on, not only from the floor', () => {
  const rng = mulberry32(5);
  const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: 1 });
  const club = synthClub(sc.cam, rng);
  const r = solveClubLine({ p1: club.p1, p2: club.p2, ball: synthBall(sc.cam, rng), gravity: sc.gravity, view: 'face_on', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, D_assumed: sc.truth.D_m });
  assert.ok(r.solve.sigma_raw.yaw_deg > LADDER_PRIORS.club_line.floor.yaw_deg, `${r.solve.sigma_raw.yaw_deg}`);
  assert.deepEqual(r.reason_codes, []);
});

test('ball_only without gravity adds NO_GRAVITY_REF and wide pitch/roll; tee assumption propagates TEE_LIFT_ASSUMED', () => {
  const rng = mulberry32(6);
  const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: 1 });
  const r = solveBallOnly({ ball: synthBall(sc.cam, rng), gravity: null, view: 'face_on', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f });
  assert.ok(r.ok);
  assert.ok(r.reason_codes.includes(RC.NO_GRAVITY_REF));
  assert.ok(r.calibration.pose_sigma.roll_deg > 1.5);
  const t = solveBallOnly({ ball: synthBall(sc.cam, rng, { z: 0.051 }), gravity: sc.gravity, view: 'face_on', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, lie: 'tee', tee_lift_source: 'assumed' });
  assert.deepEqual(t.reason_codes, [RC.TEE_LIFT_ASSUMED]);
  const none = calibrate({ corners: null, club: null, ball: null, gravity: sc.gravity }, { view: 'face_on', W: 1920, H: 1080 });
  assert.equal(none.ok, false);
  assert.equal(none.method, null);
});
