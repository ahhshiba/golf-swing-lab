// F2 row 14 from pose (face_on, 30–199 fps): lead-wrist chord speeds near impact through the calibrated camera,
// then physics/clubspeed_pose.js (model, constants and known biases are documented there and in
// docs/metrics-by-view.md §2b). Pure.
//
// The lead wrist (canonical landmark 15; left-handed swings are mirrored by body.js) is put on its viewing ray at
// one fixed camera depth (the body depth + its MediaPipe depth offset at the impact frame): in the face_on view the
// hand moves near impact in the x–z plane, its depth change over the 0.14 s window is a few cm and the per-frame
// MediaPipe depth is too noisy to difference. The arm length r is the median lead shoulder (11) → wrist (15)
// distance over the address frames (3D, body plane).

import { RC } from '../contract/reason-codes.js';
import { median } from '../geom/stats.js';
import { pointAtDepth, LANDMARK_SIGMA_PX } from './body.js';
import { valueMetric, nullMetric, eventOf, EVENT_CONF_MIN } from './common.js';
import { clubSpeedFromPose } from '../physics/clubspeed_pose.js';
import { isPlausible } from '../physics/plausibility.js';
import { nearestIndex } from '../events/signal.js';

const LEAD_WRIST = 15;
const LEAD_SHOULDER = 11;

/** club_speed_mps from pose for the face_on view. ctx = metrics/pose.js poseContext. Returns a Metric. */
export function clubSpeedPoseMetric(ctx) {
  const body = ctx.body;
  const imp = eventOf(ctx.events, 'impact');
  if (!imp) return nullMetric('club_speed_mps', 'not_computed', [RC.EVENTS_UNCERTAIN], 'pose');
  const iImp = nearestIndex(body.t_s, imp.t_s);
  // a fixed depth for the wrist: first visible frame near impact
  let Z = NaN;
  for (const d of [0, -1, 1, -2, 2, -3, 3]) {
    const i = iImp + d;
    if (i >= 0 && i < body.T && body.pix(i, LEAD_WRIST)) { Z = body.Zof(i, LEAD_WRIST); break; }
  }
  if (!Number.isFinite(Z)) {
    const out = body.outOfFrame(iImp, LEAD_WRIST);
    return nullMetric('club_speed_mps', out ? 'occluded' : 'not_computed', [out ? RC.OUT_OF_FRAME : RC.POSE_LOW_VISIBILITY], 'pose');
  }
  const wrist = new Array(body.T).fill(null);
  for (let i = 0; i < body.T; i++) {
    const p = body.pix(i, LEAD_WRIST);
    if (p) wrist[i] = pointAtDepth(body.cam, p[0], p[1], Z);
  }
  const arms = [];
  for (const i of body.addressFrames()) {
    const a = body.P(i, LEAD_SHOULDER);
    const b = body.P(i, LEAD_WRIST);
    if (a && b) arms.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  const pos = (LANDMARK_SIGMA_PX * Z) / body.cam.f;
  const r = clubSpeedFromPose({
    t: body.t_s, wrist, t_impact: imp.t_s, fps: ctx.fps, club_length_m: ctx.club?.length_m,
    arm_length_m: arms.length ? median(arms) : NaN, pos_sigma_m: Math.hypot(pos, pos * body.depth.sigma_rel),
  });
  if (!r.ok) return nullMetric('club_speed_mps', r.validity, r.reason_codes, 'pose');
  if (!isPlausible('club_speed_mps', r.club_speed_mps)) return nullMetric('club_speed_mps', 'implausible', [RC.IMPLAUSIBLE_VALUE], 'pose');
  const codes = [...body.codes];
  if (imp.conf < EVENT_CONF_MIN) codes.push(RC.EVENTS_UNCERTAIN);
  return valueMetric('club_speed_mps', {
    value: r.club_speed_mps, sigma: r.sigma, ci95: r.ci95, validity: 'low_confidence', codes: [...new Set(codes)], origin: 'pose',
  });
}
