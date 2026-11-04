// calib — mat-as-calibration-object setup (CAFCR K1–K3, K11, C2 ladder, C3 checks). Pure: no globals, no clock,
// no randomness. Frames and conventions: docs/interfaces.md §2, §4–§6.
//
// API summary (signatures only):
//
// mat.js
//   DEFAULT_VENUE, CORNER_NAMES ['tn','ln','lf','tf']
//   matCorners(venue) -> [[x, y, 0] × 4]          sampleBilinear(img, u, v) -> number
//   refineCorners({ data, W, H }, approx[4], opts?) -> { ok, corners, sides, edge_residual_px[4], max_edge_residual_px }
//   fitLineTLS(pts, w?) -> { n, c, centroid, dir }   intersectLines(a, b) -> [u, v] | null
// pnp.js
//   POSE_KEYS, GRAVITY_SIGMA_DEG, CORNER_SIGMA_PX { manual: 1, auto: 3 }, nominalF(W, H)
//   homographyDLT(world, img) -> H[9]   focalFromHomography(H, cx, cy, f0) -> { f, source, … }
//   poseFromHomography(H, f, cx, cy, centroid?) -> { R, t }
//   solvePlanarPnP({ world, img, W, H, view, f?, fLocked?, sigmaPx?, gravity?, k1?, readout?, covScale? })
//     -> { ok, cam, f, rmse, residuals_px, cov, theta, pose, sigma{yaw_deg…D_m, f_px}, lm, reason_codes }
//   solveMatPose({ corners, venue, view, W, H, f?, fLocked?, cornerSource?, sigmaPx?, gravity?, … })
//     -> solvePlanarPnP result + { fFormat: { f_free, rel_diff, sigma_rel } | null }
//   cameraFromParams(theta, base)  reportVector(theta, base, view)  propagatePoseSigma(theta, cov, base, view)
// report.js
//   poseReport(cam, view) -> { yaw_deg, pitch_deg, roll_deg, X_m, Y_m, h_m, D_m }
//   presetDeviation(report, preset) -> same keys | null
//   makeCalibration({ method, source, cam, view, f_locked, sigma, rmse_px, slope_deg?, preset?, readout_source? })
//     -> Calibration (interfaces.md §4)
// checks.js
//   COMMON_LIMITS, VIEW_LIMITS, AMBER_CHECKS
//   evaluate(inputs) -> { light: 'green'|'amber'|'red', failures[{ check, value, limit, severity }], passed, skipped, reason_codes }
//   cornerDrift(a, b) -> { max_px, n }   staleCheck(calibCorners, clipCorners, limit?) -> { stale, max_px, n, reason_codes }
//   ballWidthCheck(observed_w_px, predicted_w_px) -> { ok, rel_err, failures }
//   P19 health (flows owner, additive): HEALTH_LIMITS, meanLuma(gray, { roi?, stride? }) -> 0..255,
//   shotCountCheck(n) -> { due }, matSizeFromCalibration(camera, corners, h_ref_m) -> { mat_L, mat_W } | null,
//   matSizeCheck(venue, solved) -> { changed, rel_L, rel_W, reason_codes }, brightnessCheck(locked, current) ->
//   { changed, rel, rebuild_background }, isoToMs(iso), dropTestDue(lastAt, nowIso) -> { due, days_since },
//   calibHealth({ shots_since_check, venue, solved_mat, locked_luma, current_luma, last_drop_test_at, now, mode })
//     -> { prompts[{ id, level, text }], rebuild_background, reason_codes, checks }
// ghost.js
//   presetCamera(preset, camTemplate) -> camera
//   ghostCorners(preset, venue, camTemplate, margin?) -> { corners, cam, in_frame[4] }
//   ghostDistance(observed, ghost) -> { max_px, rms_px, per_corner_px[4] }
// ballspot.js
//   TEE_LIFT_MEASURED_SIGMA_M, FRAMES_BUDGET_MIN
//   ballHeight(lie, tee_lift_m, tee_lift_source) -> { z_m, sigma_z_m, tee_lift_m, tee_lift_source, reason_codes }
//   restBall3D(cam, u, v, lie, tee_lift_m, tee_lift_source, opts?) -> { X, sigma, cov, z_plane_m, …, reason_codes }
//   predictedBallWidthPx(cam, X, r?) -> px
//   framesBudget(cam | null, view, speed_mps, launch_deg, shift?, opts?) -> { frames, exit_s, exit, reason_codes }
// gravity.js   (device-axis convention described in the file header; UNVERIFIED on iOS)
//   orientationName(angle | name)  cameraAxesInDevice(orientation)
//   gravityPose(acc, orientation, sign?) -> { pitch, roll, pitch_deg, roll_deg, up_cam, norm } | null
//   accelFromPose(pitch, roll, orientation, sign?, g?) -> [x, y, z]   flatSlope(acc, sign?) -> { slope_deg, dir_deg }
//   lowPassStep(state, sample, t_s, tau_s?) -> state   stabilityCheck(samples, { span_s, tol_deg }) -> { stable, … }
//   createGravityTracker(opts?) -> { push(acc, t_s), reset() }   gravityPrior(g, opts?) -> { pitch_deg, roll_deg, sigma_deg }
// ladder.js
//   LADDER_PRIORS, lateralKey(view)
//   selectMethod({ corners, club, ball, gravity }) -> 'mat_pnp'|'club_line'|'ball_only'|null
//   calibrate(visible, ctx) / solveClubLine(o) / solveBallOnly(o) -> { ok, method, calibration, reason_codes, solve }
// preset.js
//   F_LOCK_RULE, presetId(venue_id, view, created_at)
//   createPreset(o) -> preset   updatePreset(preset, changes, updated_at) -> preset
//   comparePreset(calibOrReport, preset, ctx?) -> { dev, same_view, same_venue, reason_codes }
//   comparePresets(a, b) -> { dev, same, same_kind, reason_codes }
//   fLockFromSolves(fs, rule?) -> { ok, f_locked, mean, sd, sd_pct, n, failures }
// timer.js
//   SETUP_STEPS, STEP_ESTIMATE_S, SETUP_LIMITS
//   createSetupTimer() -> { record(step, t_s), events(), summary() }   summarizeSetup(events) -> { steps, total_s, … }
//   p90(values)   setupTimeGate(totals, opts?) -> { n, p90_s, pass, reason }
// droptest.js
//   DROP_TEST_RULE, detectionTime(cam, t_frame, u, v)
//   dropTest(track, calibOrCam, opts?) -> { ok, pass, g, sigma_g, rel_err, z0, vz, n, rms_m, points, reason_codes }

export * from './mat.js';
export * from './pnp.js';
export * from './report.js';
export * from './checks.js';
export * from './ghost.js';
export * from './ballspot.js';
export * from './gravity.js';
export * from './ladder.js';
export * from './preset.js';
export * from './timer.js';
export * from './droptest.js';
