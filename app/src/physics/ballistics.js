// Carry by RK4 3D flight with drag, Magnus lift and spin decay (aero model and its sources: physics/aero.js).
// Spin is never measured (single 240 fps camera), so carry is always 'estimated' with RC.SPIN_ASSUMED and
// RC.WIND_IGNORED (CAFCR KD9, C1.4 carry row). Ground is the plane z = 0; the flight ends when the ball's
// bottom touches it (centre height BALL_R). Launch direction ψ is taken as 0 (face_on cannot report it, F2 #18),
// which only matters for the horizontal carry through the spin axis and is ignored.

import { BALL_R, DEG } from '../geom/constants.js';
import { gauss } from '../geom/rng.js';
import { percentile, std } from '../geom/stats.js';
import { RC } from '../contract/reason-codes.js';
import { AERO_MODEL, BALL_AREA, K_AERO, RPM_TO_RAD_S, aeroCoefficients, backspinAxis, spinRatio } from './aero.js';

export { BALL_AREA, K_AERO };

export const CLUB_CATEGORIES = Object.freeze(['driver', 'wood', 'hybrid', 'iron_long', 'iron_mid', 'iron_short', 'wedge']);

// PRIORS, not measurements: backspin per club category (rpm, 1σ). Means follow published launch-monitor tour averages
// (driver 2686, 3W 3655, 5W 4350, hybrid 4437, 3–5i 4630–5361, 6–7i 6231–7097, 8–9i 7998–8647, PW 9304 rpm);
// σ ≈ 15–20 % covers amateur spread (UNVERIFIED). CAFCR 待決定 6: the owner may override them per club.
export const SPIN_PRIORS = Object.freeze({
  driver: Object.freeze({ mean_rpm: 2700, sigma_rpm: 600 }),
  wood: Object.freeze({ mean_rpm: 3900, sigma_rpm: 700 }),
  hybrid: Object.freeze({ mean_rpm: 4400, sigma_rpm: 800 }),
  iron_long: Object.freeze({ mean_rpm: 5000, sigma_rpm: 900 }),
  iron_mid: Object.freeze({ mean_rpm: 6600, sigma_rpm: 1000 }),
  iron_short: Object.freeze({ mean_rpm: 8300, sigma_rpm: 1100 }),
  wedge: Object.freeze({ mean_rpm: 9500, sigma_rpm: 1500 }),
});
/** Used when the club is unknown. */
export const SPIN_PRIOR_UNKNOWN = Object.freeze({ mean_rpm: 5500, sigma_rpm: 2500 });

/**
 * Club category from a club type string ('driver', '1w', '3w', '4h', '7i', 'pw', 'sw', a category name, …).
 * Returns one of CLUB_CATEGORIES or null when unknown.
 */
export function clubCategory(type) {
  if (type == null) return null;
  const t = String(type).trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (CLUB_CATEGORIES.includes(String(type))) return String(type);
  if (t === 'driver' || t === '1w' || t === 'dr') return 'driver';
  if (/^([2-9]w|wood|fairway|fw|[2-9]wood)$/.test(t)) return 'wood';
  if (/^([1-7]h|hybrid|hy|rescue|ut|utility)$/.test(t)) return 'hybrid';
  const m = /^([1-9])(i|iron)$/.exec(t);
  if (m) {
    const k = Number(m[1]);
    if (k <= 5) return 'iron_long';
    if (k <= 7) return 'iron_mid';
    return 'iron_short';
  }
  if (/^(pw|gw|aw|sw|lw|uw|wedge|pitchingwedge|sandwedge|lobwedge|gapwedge|\d\d(deg|°)?)$/.test(t)) return 'wedge';
  if (t === 'ironlong') return 'iron_long';
  if (t === 'ironmid') return 'iron_mid';
  if (t === 'ironshort') return 'iron_short';
  return null;
}

/** Spin prior for a club object ({ type }), a type string or a category; owner overrides win. */
export function spinPriorFor(club, overrides = null) {
  const type = club && typeof club === 'object' ? club.type : club;
  const cat = clubCategory(type);
  if (overrides && cat && overrides[cat]) return { category: cat, ...overrides[cat] };
  return cat ? { category: cat, ...SPIN_PRIORS[cat] } : { category: null, ...SPIN_PRIOR_UNKNOWN };
}

/** Launch velocity vector for speed, vertical angle and horizontal angle ψ (+ = toward −y, right of target RH). */
export function launchVector(speed, launchVDeg, launchHDeg = 0) {
  const th = launchVDeg * DEG;
  const ps = launchHDeg * DEG;
  return [speed * Math.cos(th) * Math.cos(ps), -speed * Math.cos(th) * Math.sin(ps), speed * Math.sin(th)];
}

function deriv(s, w, out, acc) {
  const vx = s[3], vy = s[4], vz = s[5], om = s[6];
  const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const { cd, cl } = aeroCoefficients(spinRatio(om, sp));
  const kd = K_AERO * cd * sp;
  const kl = K_AERO * cl * sp;
  const cx = w[1] * vz - w[2] * vy;
  const cy = w[2] * vx - w[0] * vz;
  const cz = w[0] * vy - w[1] * vx;
  out[0] = vx; out[1] = vy; out[2] = vz;
  out[3] = -kd * vx + kl * cx;
  out[4] = -kd * vy + kl * cy;
  out[5] = -acc - kd * vz + kl * cz;
  out[6] = -AERO_MODEL.SPIN_DECAY_R1 * om * sp / BALL_R;
}

/**
 * Integrate one flight. o: { speed_mps, launch_v_deg, launch_h_deg = 0, spin_rpm, start = [0, 0, BALL_R],
 * dt = 0.01, tMax = 20 }. Returns { carry_m, flight_time_s, apex_m, landing: [x, y, z], ok }.
 */
export function flight(o) {
  const v0 = launchVector(o.speed_mps, o.launch_v_deg, o.launch_h_deg ?? 0);
  const start = o.start ?? [0, 0, BALL_R];
  const dt = o.dt ?? 0.01;
  const tMax = o.tMax ?? 20;
  const g = o.g ?? 9.80665;
  const w = backspinAxis(v0);
  let s = Float64Array.of(start[0], start[1], start[2], v0[0], v0[1], v0[2], (o.spin_rpm ?? 0) * RPM_TO_RAD_S);
  const k1 = new Float64Array(7), k2 = new Float64Array(7), k3 = new Float64Array(7), k4 = new Float64Array(7);
  const tmp = new Float64Array(7);
  const nxt = new Float64Array(7);
  let t = 0;
  let apex = start[2];
  const zGround = BALL_R;
  while (t < tMax) {
    deriv(s, w, k1, g);
    for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * dt * k1[i];
    deriv(tmp, w, k2, g);
    for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * dt * k2[i];
    deriv(tmp, w, k3, g);
    for (let i = 0; i < 7; i++) tmp[i] = s[i] + dt * k3[i];
    deriv(tmp, w, k4, g);
    for (let i = 0; i < 7; i++) nxt[i] = s[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    t += dt;
    if (nxt[2] > apex) apex = nxt[2];
    if (nxt[2] < zGround && nxt[5] < 0) {
      const fr = (s[2] - zGround) / (s[2] - nxt[2]);
      const x = s[0] + fr * (nxt[0] - s[0]);
      const y = s[1] + fr * (nxt[1] - s[1]);
      return {
        ok: true, carry_m: Math.hypot(x - start[0], y - start[1]), flight_time_s: t - dt + fr * dt, apex_m: apex,
        landing: [x, y, 0],
      };
    }
    s.set(nxt);
  }
  return { ok: false, carry_m: NaN, flight_time_s: NaN, apex_m: apex, landing: null };
}

function truncatedSpin(rng, prior) {
  for (let k = 0; k < 20; k++) {
    const x = gauss(rng, prior.mean_rpm, prior.sigma_rpm);
    if (x >= 0.25 * prior.mean_rpm) return x;
  }
  return 0.25 * prior.mean_rpm;
}

/**
 * Carry with ci95 by Monte Carlo over launch (speed, vertical angle) and the spin prior.
 * o: { speed_mps, launch_v_deg, speed_sigma?, launch_sigma_deg?, draws?: { ball_speed, launch_v_deg } (from
 *      mc.js, shared systematic offsets), club, spinOverrides?, rng, n = 500, start?, dt? }
 * Returns { ok, value, ci95, sigma, validity: 'estimated', value_origin: 'ballistics', reason_codes, spin_prior,
 *   n } or, when speed or launch is null, { ok: false, value: null, validity: 'not_computed',
 *   reason_codes: [DEPENDS_ON_NULL] }.
 */
export function carryEstimate(o) {
  if (o.speed_mps == null || o.launch_v_deg == null || !Number.isFinite(o.speed_mps) || !Number.isFinite(o.launch_v_deg)) {
    return { ok: false, value: null, ci95: null, sigma: null, validity: 'not_computed', value_origin: 'ballistics', reason_codes: [RC.DEPENDS_ON_NULL] };
  }
  const prior = spinPriorFor(o.club, o.spinOverrides);
  const n = o.n ?? 500;
  const rng = o.rng;
  if (typeof rng !== 'function') throw new TypeError('carryEstimate: rng (seeded, geom/rng.js) is required');
  const start = o.start ?? [0, 0, BALL_R];
  const dt = o.dt ?? 0.01;
  const nominal = flight({ speed_mps: o.speed_mps, launch_v_deg: o.launch_v_deg, spin_rpm: prior.mean_rpm, start, dt });
  const vals = [];
  const dS = o.draws?.ball_speed;
  const dL = o.draws?.launch_v_deg;
  for (let i = 0; i < n; i++) {
    let sp;
    let la;
    if (dS && dL && dS.length > i && dL.length > i) {
      sp = dS[i]; la = dL[i];
    } else {
      sp = gauss(rng, o.speed_mps, o.speed_sigma ?? 0);
      la = gauss(rng, o.launch_v_deg, o.launch_sigma_deg ?? 0);
    }
    const spin = truncatedSpin(rng, prior);
    const f = flight({ speed_mps: Math.max(sp, 1), launch_v_deg: la, spin_rpm: spin, start, dt });
    const model = 1 + gauss(rng, 0, AERO_MODEL.CARRY_MODEL_SIGMA_FRAC);
    if (f.ok) vals.push(f.carry_m * model);
  }
  if (!nominal.ok || vals.length < n / 2) {
    return { ok: false, value: null, ci95: null, sigma: null, validity: 'not_computed', value_origin: 'ballistics', reason_codes: [RC.DEPENDS_ON_NULL] };
  }
  const value = nominal.carry_m;
  const lo = Math.min(percentile(vals, 2.5), value);
  const hi = Math.max(percentile(vals, 97.5), value);
  return {
    ok: true,
    value,
    ci95: [lo, hi],
    sigma: std(vals),
    validity: 'estimated',
    value_origin: 'ballistics',
    reason_codes: [RC.SPIN_ASSUMED, RC.WIND_IGNORED],
    spin_prior: prior,
    apex_m: nominal.apex_m,
    flight_time_s: nominal.flight_time_s,
    n: vals.length,
  };
}

