// Setup checks C3–C9 (CAFCR C3 定位方法, C1.1–C1.3 absolute limits, C2 framing) as data + one evaluator.
// Lengths in metres, angles in degrees, pixels in px. Every limit is inclusive (value ≤ limit passes).

import { RC } from '../contract/reason-codes.js';
import { FRAMES_BUDGET_MIN } from './ballspot.js';
import { center, ray } from '../geom/camera.js';

/** Thresholds shared by all views. */
export const COMMON_LIMITS = Object.freeze({
  rmse_px: 2.0, // C5: mat reprojection RMSE
  edge_residual_px: 1.5, // C5: corner-refinement edge-line residual
  ghost_px: 8, // C4: corners within 8 px of the ghost points
  f_format_manual_pct: 4, // C5: |f_free − f_locked| / f_locked, magnifier taps (1 px, ≈5σ)
  f_format_auto_pct: 6, // C5: same, automatic detection (3 px)
  frame_margin_frac: 0.025, // C2: corners and ball inside the centred 95 % box
  ball_width_tol_frac: 0.06, // C7: resting-ball horizontal width vs prediction ±6 %
  ball_min_px: 12, // C7: ball at least 12 px wide
  frames_budget_min: FRAMES_BUDGET_MIN, // C7: flight-frame budget ≥ 6 (warning only)
  drift_stale_px: 2, // per clip: visible-corner drift > 2 px → CALIB_STALE
  clip_drift_px: 1, // C10: two frames of the calibration clip drift ≤ 1 px
});

/**
 * Per-view limits. abs: absolute pose limits (|value| ≤ limit); rel: |report − preset| limits; extra view-specific
 * absolute limits (high_behind lateral |Y| ≤ 0.15 m red light; driver safety distance D ≥ 2.75 m).
 * high_behind has no absolute pitch limit: it is aimed at the ball (≈ −30°) and only checked against the preset.
 */
export const VIEW_LIMITS = Object.freeze({
  face_on: Object.freeze({
    abs: Object.freeze({ yaw_deg: 1.5, pitch_deg: 1.0, roll_deg: 0.5 }),
    rel: Object.freeze({ yaw_deg: 1.0, pitch_deg: 1.0, roll_deg: 0.5, D_m: 0.05, X_m: 0.05, h_m: 0.03 }),
  }),
  dtl: Object.freeze({
    abs: Object.freeze({ yaw_deg: 1.0, pitch_deg: 1.0, roll_deg: 0.5 }),
    rel: Object.freeze({ yaw_deg: 1.0, pitch_deg: 1.0, roll_deg: 0.5, D_m: 0.05, Y_m: 0.03, h_m: 0.03 }),
  }),
  high_behind: Object.freeze({
    abs: Object.freeze({ yaw_deg: 1.0, roll_deg: 0.5, Y_abs_m: 0.15, D_min_m: 2.75 }),
    rel: Object.freeze({ yaw_deg: 1.0, pitch_deg: 1.0, roll_deg: 0.5, D_m: 0.05, Y_m: 0.05, h_m: 0.03 }),
  }),
});

/** Checks whose failure only gives an amber light (warnings); every other failure is red. */
export const AMBER_CHECKS = Object.freeze(['frames_budget']);

function wrap180(x) {
  let y = x - 360 * Math.round(x / 360);
  if (y <= -180) y += 360;
  return y;
}

/** Max pixel distance between two corner sets (entries may be null: skipped). { max_px, n }. */
export function cornerDrift(a, b) {
  let m = 0;
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!a[i] || !b[i]) continue;
    m = Math.max(m, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
    n++;
  }
  return { max_px: n ? m : NaN, n };
}

/** Per-clip staleness: { stale, max_px, reason_codes } (drift > 2 px → CALIB_STALE). */
export function staleCheck(calibCorners, clipCorners, limit = COMMON_LIMITS.drift_stale_px) {
  const d = cornerDrift(calibCorners, clipCorners);
  const stale = d.n > 0 && d.max_px > limit;
  return { stale, max_px: d.max_px, n: d.n, reason_codes: stale ? [RC.CALIB_STALE] : [] };
}

/** C7 resting-ball width check: { ok, rel_err, failures } for observed vs predicted horizontal width. */
export function ballWidthCheck(observed_w_px, predicted_w_px) {
  const failures = [];
  const rel = observed_w_px / predicted_w_px - 1;
  if (!(Math.abs(rel) <= COMMON_LIMITS.ball_width_tol_frac)) {
    failures.push({ check: 'ball_width', value: rel, limit: COMMON_LIMITS.ball_width_tol_frac });
  }
  if (!(observed_w_px >= COMMON_LIMITS.ball_min_px)) {
    failures.push({ check: 'ball_min_px', value: observed_w_px, limit: COMMON_LIMITS.ball_min_px });
  }
  return { ok: failures.length === 0, rel_err: rel, failures };
}

/**
 * Evaluate all applicable checks. in: {
 *   view, report (pose { yaw_deg … D_m }), rmse_px, edge_residual_px (number or array → max),
 *   f_free_px, f_locked_px, corner_source: 'manual'|'auto', preset ({ pose, view? }) | null, ghost_px,
 *   corners ([[u, v] × 4]) + W, H (95 % box), gravity_available (bool), frames_budget (number),
 *   ball: { w_px, predicted_w_px } }.
 * The absolute roll check uses report.roll_deg: pass the mat solution fused with the gravity prior (pnp `gravity`,
 * venue slope removed), which is the roll relative to gravity of CAFCR C3 (|ψ_r| ≤ 0.5°); without an accelerometer
 * it is the mat-only roll and NO_GRAVITY_REF is added.
 * Checks with missing inputs are listed in `skipped`. Light: red if any red failure, else amber if any amber
 * failure or gravity is unavailable, else green.
 * Returns { light, failures: [{ check, value, limit, severity }], passed: [check], skipped: [check], reason_codes }.
 * reason_codes: NO_GRAVITY_REF (no accelerometer), TRACK_MAY_BE_SHORT (budget < 6), SETUP_UNVERIFIED (red light:
 * applies to every shot if the user forces the start, CAFCR C9), PRESET_MISMATCH (preset of another view).
 */
export function evaluate(inp) {
  const view = inp.view;
  const L = VIEW_LIMITS[view];
  if (!L) throw new RangeError(`evaluate: unknown view '${view}'`);
  const failures = [];
  const passed = [];
  const skipped = [];
  const codes = [];
  const chk = (name, value, limit, ok) => {
    if (value === undefined || value === null || Number.isNaN(value)) { skipped.push(name); return; }
    if (ok) passed.push(name);
    else failures.push({ check: name, value, limit, severity: AMBER_CHECKS.includes(name) ? 'amber' : 'red' });
  };
  const rep = inp.report ?? null;
  // absolute pose
  for (const [k, lim] of Object.entries(L.abs)) {
    if (k === 'Y_abs_m') { chk('abs_Y_m', rep?.Y_m, lim, Math.abs(rep?.Y_m) <= lim); continue; }
    if (k === 'D_min_m') { chk('min_D_m', rep?.D_m, lim, rep?.D_m >= lim); continue; }
    const v = rep?.[k];
    chk(`abs_${k}`, v, lim, Math.abs(v) <= lim);
  }
  // relative to preset
  if (inp.preset && inp.preset.pose && rep) {
    if (inp.preset.view && inp.preset.view !== view) {
      codes.push(RC.PRESET_MISMATCH);
      failures.push({ check: 'preset_view', value: inp.preset.view, limit: view, severity: 'red' });
    } else {
      for (const [k, lim] of Object.entries(L.rel)) {
        let d = rep[k] - inp.preset.pose[k];
        if (k === 'yaw_deg' || k === 'roll_deg') d = wrap180(d);
        chk(`rel_${k}`, Number.isFinite(d) ? d : null, lim, Math.abs(d) <= lim);
      }
    }
  } else {
    for (const k of Object.keys(L.rel)) skipped.push(`rel_${k}`);
  }
  chk('rmse_px', inp.rmse_px, COMMON_LIMITS.rmse_px, inp.rmse_px <= COMMON_LIMITS.rmse_px);
  const er = Array.isArray(inp.edge_residual_px) ? Math.max(...inp.edge_residual_px) : inp.edge_residual_px;
  chk('edge_residual_px', er, COMMON_LIMITS.edge_residual_px, er <= COMMON_LIMITS.edge_residual_px);
  if (Number.isFinite(inp.f_free_px) && Number.isFinite(inp.f_locked_px)) {
    const lim = (inp.corner_source === 'auto' ? COMMON_LIMITS.f_format_auto_pct : COMMON_LIMITS.f_format_manual_pct) / 100;
    const d = (inp.f_free_px - inp.f_locked_px) / inp.f_locked_px;
    chk('f_format', d, lim, Math.abs(d) <= lim);
  } else skipped.push('f_format');
  chk('ghost_px', inp.ghost_px, COMMON_LIMITS.ghost_px, inp.ghost_px <= COMMON_LIMITS.ghost_px);
  if (Array.isArray(inp.corners) && Number.isFinite(inp.W) && Number.isFinite(inp.H)) {
    const m = COMMON_LIMITS.frame_margin_frac;
    let worst = Infinity;
    for (const c of inp.corners) {
      if (!c) { worst = -Infinity; break; }
      const inset = Math.min(c[0] / inp.W - m, 1 - m - c[0] / inp.W, c[1] / inp.H - m, 1 - m - c[1] / inp.H);
      worst = Math.min(worst, inset);
    }
    chk('corners_in_frame', worst, 0, worst >= 0);
  } else skipped.push('corners_in_frame');
  if (inp.ball && Number.isFinite(inp.ball.w_px) && Number.isFinite(inp.ball.predicted_w_px)) {
    const b = ballWidthCheck(inp.ball.w_px, inp.ball.predicted_w_px);
    for (const f of b.failures) failures.push({ ...f, severity: 'red' });
    if (b.ok) passed.push('ball_width', 'ball_min_px');
  } else skipped.push('ball_width', 'ball_min_px');
  if (Number.isFinite(inp.frames_budget)) {
    chk('frames_budget', inp.frames_budget, COMMON_LIMITS.frames_budget_min, inp.frames_budget >= COMMON_LIMITS.frames_budget_min);
    if (inp.frames_budget < COMMON_LIMITS.frames_budget_min) codes.push(RC.TRACK_MAY_BE_SHORT);
  } else skipped.push('frames_budget');
  if (inp.gravity_available === false) codes.push(RC.NO_GRAVITY_REF);
  const red = failures.some((f) => f.severity === 'red');
  const amber = failures.some((f) => f.severity === 'amber') || inp.gravity_available === false;
  const light = red ? 'red' : amber ? 'amber' : 'green';
  if (red) codes.push(RC.SETUP_UNVERIFIED);
  return { light, failures, passed, skipped, reason_codes: [...new Set(codes)] };
}

// ------------------------------------------------------------------------------------------------------------------
// P19 calibration health (CAFCR R5 P19, P15, K11) — additive pure checks, data-driven. The UI turns `prompts` into
// messages; nothing here reads a clock (the caller passes ISO times / counts).

/** Health-check thresholds (P19 / P15 / K11). */
export const HEALTH_LIMITS = Object.freeze({
  shots_per_check: 20, // P19: prompt a health check every 20 shots
  mat_size_rel: 0.01, // P15/P19: re-solved mat size differs > 1 % from the venue → 「可能換了墊子」
  brightness_rel: 0.30, // P19: scene mean brightness changes > 30 % vs the locked calibration frame
  drop_test_days: 30, // K11: monthly drop test reminder
});

/** Mean luminance (0..255) of a gray image { data, W, H } (Uint8 luma), optionally inside roi {x,y,w,h}, sampled with stride. */
export function meanLuma(gray, { roi = null, stride = 4 } = {}) {
  const W = gray?.W;
  const H = gray?.H;
  const d = gray?.data;
  if (!d || !(W > 0) || !(H > 0)) return NaN;
  const x0 = Math.max(0, Math.floor(roi?.x ?? 0));
  const y0 = Math.max(0, Math.floor(roi?.y ?? 0));
  const x1 = Math.min(W, Math.ceil(roi ? roi.x + roi.w : W));
  const y1 = Math.min(H, Math.ceil(roi ? roi.y + roi.h : H));
  const s = Math.max(1, Math.floor(stride));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += s) for (let x = x0; x < x1; x += s) { sum += d[y * W + x]; n++; }
  return n ? sum / n : NaN;
}

/** Every-20-shots prompt: { due, shots_since, limit }. */
export function shotCountCheck(shotsSinceCheck, limit = HEALTH_LIMITS.shots_per_check) {
  const n = Number.isFinite(shotsSinceCheck) ? shotsSinceCheck : 0;
  return { due: n >= limit, shots_since: n, limit };
}

/**
 * Mat size re-solved from a calibration: corners [[u,v] × 4] in [tn, ln, lf, tf] order are intersected with the
 * ground (z = 0) through `camera`, after scaling the camera centre about the ball spot so that its height equals
 * `h_ref_m` (the preset height, which C3 returns to within ±3 cm). The PnP solve that produced `camera` assumed the
 * venue's mat size; a different real mat shows up as a different scale (camera height) and/or aspect, so this
 * re-solve recovers it given an independent height. Returns { mat_L, mat_W } or null when an input is missing.
 */
export function matSizeFromCalibration(camera, corners, h_ref_m) {
  if (!camera || !Array.isArray(corners) || corners.length !== 4 || corners.some((c) => !c)) return null;
  const C0 = center(camera);
  if (!(C0[2] > 0) || !(h_ref_m > 0)) return null;
  const k = h_ref_m / C0[2];
  const P = [];
  for (const [u, v] of corners) {
    const r = ray(camera, u, v);
    if (!(r.d[2] < 0)) return null; // corner ray does not reach the ground in front of the camera
    const s = -C0[2] / r.d[2];
    const X = [C0[0] + s * r.d[0], C0[1] + s * r.d[1]];
    P.push([k * X[0], k * X[1]]); // scaling about the ball spot (origin) scales the ground points by k
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const [tn, ln, lf, tf] = P;
  return { mat_L: (dist(tn, ln) + dist(tf, lf)) / 2, mat_W: (dist(tn, tf) + dist(ln, lf)) / 2 };
}

/** P15/P19: { changed, rel_L, rel_W, reason_codes } — a re-solved size > 1 % from the venue → 「可能換了墊子」. */
export function matSizeCheck(venue, solved, limit = HEALTH_LIMITS.mat_size_rel) {
  if (!venue || !solved || !(venue.mat_L > 0) || !(venue.mat_W > 0) || !(solved.mat_L > 0) || !(solved.mat_W > 0)) {
    return { changed: false, skipped: true, rel_L: NaN, rel_W: NaN, reason_codes: [] };
  }
  const rel_L = solved.mat_L / venue.mat_L - 1;
  const rel_W = solved.mat_W / venue.mat_W - 1;
  const changed = Math.abs(rel_L) > limit || Math.abs(rel_W) > limit;
  return { changed, skipped: false, rel_L, rel_W, reason_codes: changed ? [RC.CALIB_STALE] : [] };
}

/** P19: brightness vs the locked calibration frame: { changed, rel, rebuild_background }. */
export function brightnessCheck(lockedLuma, currentLuma, limit = HEALTH_LIMITS.brightness_rel) {
  if (!(lockedLuma > 0) || !Number.isFinite(currentLuma)) return { changed: false, skipped: true, rel: NaN, rebuild_background: false };
  const rel = currentLuma / lockedLuma - 1;
  const changed = Math.abs(rel) > limit;
  return { changed, skipped: false, rel, rebuild_background: changed };
}

const DAY_MS = 86400000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|([+-])(\d{2}):(\d{2}))?$/;

/** ISO-8601 date-time -> milliseconds since 1970-01-01T00:00Z (UTC when no zone is given), NaN if unparseable. */
export function isoToMs(s) {
  const m = typeof s === 'string' ? ISO_RE.exec(s) : null;
  if (!m) return NaN;
  let y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  // days from civil (proleptic Gregorian), Howard Hinnant's algorithm
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146097 + doe - 719468;
  const frac = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
  let ms = days * DAY_MS + ((+(m[4] ?? 0)) * 3600 + (+(m[5] ?? 0)) * 60 + (+(m[6] ?? 0))) * 1000 + frac;
  if (m[9]) ms -= (m[9] === '+' ? 1 : -1) * ((+m[10]) * 60 + (+m[11])) * 60000;
  return ms;
}

/** K11: monthly drop-test reminder: { due, days_since } (never done → due, days_since null). */
export function dropTestDue(lastDropTestAt, nowIso, days = HEALTH_LIMITS.drop_test_days) {
  const now = isoToMs(nowIso);
  if (!Number.isFinite(now)) return { due: false, skipped: true, days_since: null };
  const last = lastDropTestAt ? isoToMs(lastDropTestAt) : NaN;
  if (!Number.isFinite(last)) return { due: true, skipped: false, days_since: null };
  const d = (now - last) / DAY_MS;
  return { due: d >= days, skipped: false, days_since: d };
}

/**
 * All P19 checks at once. in: { shots_since_check, venue, solved_mat, locked_luma, current_luma, last_drop_test_at,
 * now, mode }. Returns { prompts: [{ id, level: 'info'|'warn', code, params }], rebuild_background, reason_codes,
 * checks }. Prompt ids: 'health_due', 'mat_changed', 'brightness', 'drop_test'. `code` is the catalog key of the
 * message (`health.prompt.*`, rendered with msg()/t(code, params)); params are plain numbers (percentages rounded to
 * 0.1, days floored). The drop-test reminder is only for the high-speed mode (the test needs a 240 fps clip).
 */
export function calibHealth(inp = {}) {
  const checks = {
    shots: shotCountCheck(inp.shots_since_check),
    mat: matSizeCheck(inp.venue, inp.solved_mat),
    brightness: brightnessCheck(inp.locked_luma, inp.current_luma),
    drop: dropTestDue(inp.last_drop_test_at, inp.now),
  };
  const pct = (x) => Math.round(1000 * x) / 10;
  const prompts = [];
  const add = (id, level, code, params) => prompts.push({ id, level, code: `health.prompt.${code}`, params });
  if (checks.shots.due) add('health_due', 'info', 'health_due', { n: checks.shots.shots_since });
  if (checks.mat.changed) add('mat_changed', 'warn', 'mat_changed', { dL: pct(checks.mat.rel_L), dW: pct(checks.mat.rel_W), lim: pct(HEALTH_LIMITS.mat_size_rel) });
  if (checks.brightness.changed) add('brightness', 'warn', 'brightness', { pct: Math.round(100 * checks.brightness.rel), lim: Math.round(100 * HEALTH_LIMITS.brightness_rel) });
  if (checks.drop.due && inp.mode === 'highspeed') {
    if (checks.drop.days_since === null) add('drop_test', 'info', 'drop_test_never', {});
    else add('drop_test', 'info', 'drop_test', { days: Math.floor(checks.drop.days_since) });
  }
  return {
    prompts,
    rebuild_background: checks.brightness.rebuild_background,
    reason_codes: [...new Set([...checks.mat.reason_codes])],
    checks,
  };
}
