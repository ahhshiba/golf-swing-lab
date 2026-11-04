// metrics — per-view metric registry (CAFCR F2) and pose metrics with honest nulls (KD9). Pure.
//
// API summary (signatures only; definitions in docs/metrics-by-view.md):
//
// registry.js
//   REGISTRY { [id]: { id, row, label_zh, unit, value_origin, views{face_on,dtl,high_behind}, minFps, nullCode,
//              fpsTiers?, depends?, runtimeCodes? } }      POSE_METRIC_IDS
//   cellFor(id, view, fps) -> { validity: 'valid'|'estimated'|'low_confidence'|null, code: RC|null }   viewsFor(id)
// common.js
//   POSE_SIGMA, EVENT_CONF_MIN, TEMPO_LIMITS, eventHalfWidth(fps, conf), tempoInterval(B, D, fps, conf?)
//   tempoMetrics(events, fps, cells) -> { backswing_s, downswing_s, tempo_ratio }
//   valueMetric(id, r), nullMetric(id, validity, codes), worseValidity(a, b), rss(...)
// body.js
//   makeBody({ poseSeq, calibration, view, handedness, events, venue? }) -> body context (canonical RH frame)
//   segmentOnRays(body, i, a, b, L), pointAtDepth(cam, u, v, Z), FOOT_PRIORS, LANDMARK_SIGMA_PX, …
// pose.js
//   displacement / spineTilt / turn / handPlaneDev / weightShift / topShaftAngle primitives, finalize(id, cell, r)
// face_on.js / dtl.js / high_behind.js
//   computeFaceOn(ctx, cells)  computeDtl(ctx, cells)  computeHighBehind(ctx, cells)
// club.js
//   clubSpeedPoseMetric(ctx) -> Metric (F2 row 14, face_on < 200 fps: lead-wrist peak speed × lever, physics/clubspeed_pose.js)
// compute.js
//   computeMetrics({ view, fps, poseSeq, events, calibration, handedness, venue?, club?, clubObs? }) -> { [id]: Metric }

export * from './registry.js';
export * from './common.js';
export * from './body.js';
export * from './pose.js';
export * from './face_on.js';
export * from './dtl.js';
export * from './high_behind.js';
export * from './club.js';
export * from './compute.js';
