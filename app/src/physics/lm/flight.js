// Full ball flight with a tilted spin axis (RN §4; LAUNCH-MONITOR-SPEC §1.2 #14–21). Lazy module (physics/lm/*).
// Same aerodynamics as physics/aero.js + ballistics.js (Smits & Smith form, coefficients re-fitted to tour averages,
// spin decay dω/dt = −R1·ω·|v|/r; UNVERIFIED), RK4 with a fixed step (LM_PARAMS.flight.dt_s = 4 ms; the landing is
// interpolated linearly inside the last step). Canonical frame of physics/lm/dplane.js (x target, y toward a
// right-handed golfer, z up; launch direction ψ and spin axis + = away from the golfer).
// Spin axis: the backspin axis b̂ = unit(v₀ × ẑ) rotated about v̂₀ by the axis tilt θ: ŵ = b̂·cosθ + (v̂₀ × b̂)·sinθ
// (RN §4 / lm/flight.py); θ > 0 bends the flight toward −y.

import { BALL_R, G } from '../../geom/constants.js';
import { AERO_MODEL, K_AERO, RPM_TO_RAD_S } from '../aero.js';
import { LM_PARAMS } from './params.js';

const D = Math.PI / 180;
const { CD1, CD2, CL1, CL_EXP, SPIN_DECAY_R1 } = AERO_MODEL;

/** Launch velocity (m/s) for speed, vertical angle and direction ψ (+ toward −y). */
export function launchVector(speed, lvDeg, lhDeg = 0) {
  const t = lvDeg * D, p = lhDeg * D;
  return [speed * Math.cos(t) * Math.cos(p), -speed * Math.cos(t) * Math.sin(p), speed * Math.sin(t)];
}

/** Unit spin axis for launch velocity v0 and axis tilt (°). */
export function spinAxisVector(v0, axisDeg) {
  let bx = v0[1], by = -v0[0];
  const bn = Math.hypot(bx, by);
  if (bn > 1e-12) { bx /= bn; by /= bn; } else { bx = 0; by = -1; }
  const sp = Math.hypot(v0[0], v0[1], v0[2]) || 1;
  const vx = v0[0] / sp, vy = v0[1] / sp, vz = v0[2] / sp;
  // v̂ × b̂ (b̂_z = 0)
  const cx = -vz * by, cy = vz * bx, cz = vx * by - vy * bx;
  const c = Math.cos(axisDeg * D), s = Math.sin(axisDeg * D);
  return [bx * c + cx * s, by * c + cy * s, cz * s];
}

const S = new Float64Array(7);
const K1 = new Float64Array(7), K2 = new Float64Array(7), K3 = new Float64Array(7), K4 = new Float64Array(7);
const TMP = new Float64Array(7);

function deriv(s, w, out) {
  const vx = s[3], vy = s[4], vz = s[5];
  const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const S0 = sp > 0 ? (s[6] * BALL_R) / sp : 0;
  const sr = S0 > 0 ? S0 : 0;
  const kd = K_AERO * (CD1 + CD2 * sr) * sp;
  const kl = K_AERO * CL1 * Math.pow(sr, CL_EXP) * sp;
  out[0] = vx; out[1] = vy; out[2] = vz;
  out[3] = -kd * vx + kl * (w[1] * vz - w[2] * vy);
  out[4] = -kd * vy + kl * (w[2] * vx - w[0] * vz);
  out[5] = -G - kd * vz + kl * (w[0] * vy - w[1] * vx);
  out[6] = (-SPIN_DECAY_R1 * s[6] * sp) / BALL_R;
}

/**
 * One flight. o: { speed_mps, launch_v_deg, launch_h_deg = 0, spin_rpm, axis_deg = 0, start = [0, 0, BALL_R],
 *   dt = LM_PARAMS.flight.dt_s, record = false }.
 * Returns { ok, x, y, t, apex, landing_deg, vland: [vx, vy, vz], path? } with the landing where the ball centre comes
 * back to start height … ground contact (centre at BALL_R); path = { t, x, y, z } Float64Arrays when record.
 */
export function fly(o) {
  const v0 = launchVector(o.speed_mps, o.launch_v_deg, o.launch_h_deg ?? 0);
  const w = spinAxisVector(v0, o.axis_deg ?? 0);
  const st = o.start ?? [0, 0, BALL_R];
  const dt = o.dt ?? LM_PARAMS.flight.dt_s;
  const tMax = LM_PARAMS.flight.t_max_s;
  S[0] = st[0]; S[1] = st[1]; S[2] = st[2]; S[3] = v0[0]; S[4] = v0[1]; S[5] = v0[2];
  S[6] = Math.max(0, o.spin_rpm ?? 0) * RPM_TO_RAD_S;
  const rec = o.record ? { t: [0], x: [st[0]], y: [st[1]], z: [st[2]] } : null;
  let t = 0;
  let apex = st[2];
  const zG = BALL_R;
  while (t < tMax) {
    deriv(S, w, K1);
    for (let i = 0; i < 7; i++) TMP[i] = S[i] + 0.5 * dt * K1[i];
    deriv(TMP, w, K2);
    for (let i = 0; i < 7; i++) TMP[i] = S[i] + 0.5 * dt * K2[i];
    deriv(TMP, w, K3);
    for (let i = 0; i < 7; i++) TMP[i] = S[i] + dt * K3[i];
    deriv(TMP, w, K4);
    for (let i = 0; i < 7; i++) TMP[i] = S[i] + (dt / 6) * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]);
    if (TMP[2] < zG && TMP[5] < 0) {
      const fr = (S[2] - zG) / (S[2] - TMP[2]);
      const lerp = (i) => S[i] + fr * (TMP[i] - S[i]);
      const x = lerp(0), y = lerp(1), vx = lerp(3), vy = lerp(4), vz = lerp(5);
      const tl = t + fr * dt;
      if (rec) { rec.t.push(tl); rec.x.push(x); rec.y.push(y); rec.z.push(0); }
      return {
        ok: true, x, y, t: tl, apex, landing_deg: Math.atan2(-vz, Math.hypot(vx, vy)) / D, vland: [vx, vy, vz],
        path: rec,
      };
    }
    S.set(TMP);
    t += dt;
    if (S[2] > apex) apex = S[2];
    if (rec) { rec.t.push(t); rec.x.push(S[0]); rec.y.push(S[1]); rec.z.push(S[2]); }
  }
  return { ok: false, x: NaN, y: NaN, t: NaN, apex, landing_deg: NaN, vland: null, path: rec };
}

/** ≤ n samples [t, x, y, z] at equal time steps of a recorded path (last = the landing). */
export function resample(path, n = LM_PARAMS.flight.samples_max) {
  const T = path.t[path.t.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const tk = (T * k) / (n - 1);
    while (j < path.t.length - 2 && path.t[j + 1] < tk) j++;
    const t0 = path.t[j], t1 = path.t[j + 1];
    const a = t1 > t0 ? Math.min(1, Math.max(0, (tk - t0) / (t1 - t0))) : 0;
    const at = (q) => q[j] + a * (q[j + 1] - q[j]);
    out.push([tk, at(path.x), at(path.y), Math.max(0, at(path.z))]);
  }
  out[n - 1] = [T, path.x[path.x.length - 1], path.y[path.y.length - 1], 0];
  return out;
}
