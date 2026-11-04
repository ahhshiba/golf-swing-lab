// physics — ball flight, club speed, carry, uncertainty (pure; randomness only via a passed-in seeded rng).
//
// API summary (signatures only; conventions in docs/interfaces.md §2–§4, rationale in CAFCR K4–K6, C1.1, C1.4):
//
// shutter.js
//   readoutFor(orientationType, view) -> { axis, dir, orientation, verified: false }        (mapping UNVERIFIED)
//   readoutModel({ orientationType, view, ms?, source? }) -> { readout, source, reason_codes }
//   observationTime(obs, t_frame = obs.t_s, cam) -> t      observationTimes(obs[], cam) -> Float64Array
//   withReadoutMs(cam, ms) -> cam'
//   READOUT_MEDIAN_MS, READOUT_ASSUMED_RANGE_MS, READOUT_ASSUMED_HALFWIDTH_MS, READOUT_RESIDUAL_FRAC,
//   READOUT_RESIDUAL_SIGMA_FRAC, READOUT_MEASURED_SIGMA_MS, VIEW_DEFAULT_ORIENTATION
// aero.js
//   aeroCoefficients(S) -> { cd, cl }   spinRatio(omega, v)   backspinAxis(v0)   accelInto(out, vx, vy, vz, cd, cl, w)
//   AERO_MODEL, CD_PRIOR, K_AERO, BALL_AREA, RPM_TO_RAD_S
// fit2d.js
//   fit2d({ cam, obs, start }) -> { ok, method: 'fit2d', ball_speed_mps, launch_v_deg, v_vec, t0, … }
//   planeTrack(cam, obs, times, y0, opts) -> { ok, t_ref, x0, z0, vx, vz, keep, … }   rayPlaneY(cam, u, v, y0)
//   MIN_TRACK_OBS, OUTLIER_K
// fit3d.js
//   fit3d({ cam, obs, start: { X, cov | sigma, dXdLift? }, t_impact_guess?, fps, club?, opts?, sensitivities?, init? })
//     -> { ok, ball_speed_mps, launch_v_deg, launch_h_deg (ψ, internal), v_vec, t0, residual_rmse_px, cov,
//          n_used, flags, sens: { lift, readout, roll, distortion }, t_factor, kappa, … }
//   startFromStaticBall(cam, u, v, { lift_m, sigma_px, sigma_h_m }) -> { X, cov, sigma, dXdLift }
//   sphereExtent(f, Xc, R?) -> { w, h }   obsWeights(obs, opt?)   speedLaunchSigma(v, C3)   tQuantile975(nu)
//   FIT3D_DEFAULTS, PARAM_NAMES, IDX
// perturb.js   (calibration-error modes shared by fit3d sensitivities and the synthetic error injection)
//   cornerR2(cam)  k1FromCornerFrac(cam, frac)  withK1(cam, k1)  scaleAboutPoint(cam, k, P?)
//   rollAboutPoint(cam, angleRad, P?)  restartOn(camFrom, camTo, start) -> start'   BALL_SPOT
// mc.js
//   propagate({ fit, club?, systematics?, rng, n = 2000 }) -> { ball_speed, launch_v, club_speed, smash, draws, … }
//   systematicsFrom({ calibration?, club?, overrides? }) -> systematics      SYSTEMATICS_DEFAULTS
// ballistics.js
//   flight({ speed_mps, launch_v_deg, launch_h_deg?, spin_rpm, start?, dt?, tMax? }) -> { carry_m, apex_m, … }
//   carryEstimate({ speed_mps, launch_v_deg, speed_sigma?, launch_sigma_deg?, draws?, club, rng, n = 500 })
//     -> { ok, value, ci95, sigma, validity: 'estimated', reason_codes: [SPIN_ASSUMED, WIND_IGNORED], … }
//   clubCategory(type) -> category | null   spinPriorFor(club, overrides?)   launchVector(speed, vDeg, hDeg?)
//   SPIN_PRIORS, SPIN_PRIOR_UNKNOWN, CLUB_CATEGORIES
// club.js
//   clubSpeed({ cam, obs, start, t_impact, fps, depth_offset_m?, window_frames? })
//     -> { ok, club_speed_mps, sigma, validity, reason_codes, readout_frac_per_ms, … }
//   HEAD_DEPTH_OFFSET_M, CLUB_DEPTH_SYS_FRAC, CLUB_LOWFPS_CI95_FRAC, CLUB_MIN_FPS, CLUB_ESTIMATED_MIN_FPS
// plausibility.js
//   isPlausible(id, value)   fitChecks(fit, t_impact_guess?)   ballPlausibility(fit, t_impact_guess?)   GATES, FIT_GATES
// result.js
//   toMetrics({ fit, mc?, carry?, club?, fps, view, readout_source?, lie?, tee_lift_source?, extra_codes? })
//     -> { club_speed_mps, ball_speed_mps, launch_v_deg, launch_h_deg, carry_m, smash_factor }  (Metric values)
//   BALL_MIN_FPS, PHYSICS_METRIC_IDS
// ground.js   (high_behind ground plane, CAFCR C1.3)
//   rayToGround(cam, u, v, z0?, tanA?, xRef?)  yawAboutPoint(cam, angleRad, P?)  sideOffset(cam)
//   groundDirSigmaDeg(cam, corners, sigmaPx)  groundCalibSigmas(cam, calibration?, venue?) -> { yaw_deg, roll_deg }
// clubpath.js (F2 #15, high_behind ≥ 240 fps)
//   clubPath({ cam, obs, ball?, fps, handedness?, calibration?, venue?, rng, n? })
//     -> { ok, club_path_deg, sigma, ci95, validity, reason_codes, n_used, side_offset_m, side_offset_red, … }
// launch_h.js (F2 #18, high_behind ≥ 200 fps)
//   launchHighBehind({ cam, obs, start, fps, club?, t_impact_guess?, calibration?, venue?, handedness? })
//     -> { ok, launch_h_deg, sigma, ci95, validity, reason_codes, fit, terms }
// clubspeed_pose.js (F2 #14, face_on 30–199 fps)
//   clubSpeedFromPose({ t, wrist, t_impact, fps, club_length_m, arm_length_m?, pos_sigma_m? })
//     -> { ok, club_speed_mps, sigma, ci95, validity, hand_peak_mps, lever, terms }   chordBias(fps)
// pipeline.js
//   analyzeHighBehind({ cam, ballObs, clubObs, start, fps, club?, t_impact_guess?, calibration?, venue?,
//                       handedness?, seed?, nMC? }) -> { metrics: { club_path_deg, launch_h_deg }, path, launch }
//   analyzeFaceOn({ cam, ballObs, clubObs?, start, fps, club?, t_impact_guess?, view?, readout_source?,
//                   calibration?, systematics?, seed?, nMC?, nCarry? }) -> { metrics, fit, fit2d, club, mc, carry }

export * from './shutter.js';
export * from './aero.js';
export * from './fit2d.js';
export * from './fit3d.js';
export * from './perturb.js';
export * from './mc.js';
export * from './ballistics.js';
export * from './club.js';
export * from './plausibility.js';
export * from './result.js';
export * from './ground.js';
export * from './clubpath.js';
export * from './launch_h.js';
export * from './clubspeed_pose.js';
export * from './pipeline.js';
