// Synthetic mat scenes for calib tests and the M2b gate (scripts/synth_calib.mjs).
// True cameras are the interfaces.md §5 nominal geometry ± uniform perturbations inside the CAFCR C2 / C3
// tolerances; corners are projected and corrupted with Gaussian pixel noise. Deterministic: pass an rng from
// mulberry32(seed).

import { BALL_R, DEG, RAD2DEG, G } from '../../app/src/geom/constants.js';
import { gauss, uniform } from '../../app/src/geom/rng.js';
import { nominalCamera, project, projectMany, eulerFromR, poseReport, makeCamera, center } from '../../app/src/geom/camera.js';
import { matCorners, DEFAULT_VENUE } from '../../app/src/calib/mat.js';

/**
 * Perturbation ranges (uniform, ± half-widths unless a [lo, hi] range is given). 'tolerance': nominal ± the C3
 * reproduction tolerances (ΔD, ΔX ≤ 50 mm, Δh ≤ 30 mm, h inside 0.82–0.86 for face_on) and the absolute angle
 * limits; 'spec': the full C2 ranges (face_on D 2.7–3.0, shift 0.3–0.4).
 */
export const PERTURB = Object.freeze({
  face_on: {
    tolerance: { D: [2.65, 2.75], shift: [0.35, 0.45], h: [0.82, 0.86], yaw: 1.5, pitch: 1.0, roll: 0.5 },
    spec: { D: [2.7, 3.0], shift: [0.3, 0.4], h: [0.82, 0.86], yaw: 1.5, pitch: 1.0, roll: 0.5 },
  },
  dtl: {
    tolerance: { Db: [3.0, 3.5], y: [0.32, 0.38], h: [0.97, 1.03], yaw: 1.0, pitch: 1.0, roll: 0.5 },
    spec: { Db: [3.0, 3.5], y: [0.32, 0.38], h: [0.97, 1.03], yaw: 1.0, pitch: 1.0, roll: 0.5 },
  },
  high_behind: {
    tolerance: { Db: [2.75, 3.0], y: [-0.15, 0.15], h: [1.65, 1.75], yaw: 1.0, pitch: 1.0, roll: 0.5 },
    spec: { Db: [2.75, 3.0], y: [-0.15, 0.15], h: [1.65, 1.75], yaw: 1.0, pitch: 1.0, roll: 0.5 },
  },
});

function draw(rng, spec) {
  return Array.isArray(spec) ? uniform(rng, spec[0], spec[1]) : uniform(rng, -spec, spec);
}

/** True camera for a view: nominal ± uniform perturbation (opts.range 'tolerance' | 'spec'; perturb=false → nominal). */
export function trueCamera(view, rng, opts = {}) {
  // Only defined keys: geom nominalCamera spreads opts over its defaults, so an undefined W would win.
  const o = {};
  for (const k of ['f', 'W', 'H']) if (opts[k] !== undefined) o[k] = opts[k];
  if (opts.perturb === false) return nominalCamera(view, o);
  const P = PERTURB[view][opts.range ?? 'tolerance'];
  if (view === 'face_on') {
    o.D = draw(rng, P.D);
    o.shift = draw(rng, P.shift);
    o.h = draw(rng, P.h);
  } else {
    o.Db = draw(rng, P.Db);
    o.y = draw(rng, P.y);
    o.h = draw(rng, P.h);
  }
  o.yaw = draw(rng, P.yaw) * DEG;
  o.pitch = draw(rng, P.pitch) * DEG;
  o.roll = draw(rng, P.roll) * DEG;
  return nominalCamera(view, o);
}

function inBox(cam, uv, margin) {
  return uv[0] >= margin * cam.W && uv[0] <= (1 - margin) * cam.W && uv[1] >= margin * cam.H && uv[1] <= (1 - margin) * cam.H;
}

/**
 * Synthetic mat scene. o: { view, rng, sigmaPx = 1, venue = DEFAULT_VENUE, range, perturb = true, f, W, H,
 * gravitySigmaDeg = 0.4, margin = 0.025 (scenes with a true corner outside the centred 95 % box are redrawn) }.
 * Returns { view, venue, cam, truth (poseReport), cornersTrue, corners, gravity: { pitch_deg, roll_deg, sigma_deg } }.
 */
export function synthMatScene(o) {
  const { view, rng } = o;
  const venue = o.venue ?? DEFAULT_VENUE;
  const s = o.sigmaPx ?? 1;
  const margin = o.margin ?? 0.025;
  const world = matCorners(venue);
  let cam;
  let cornersTrue;
  for (let tries = 0; tries < 200; tries++) {
    cam = trueCamera(view, rng, o);
    const { uv } = projectMany(cam, world);
    cornersTrue = [0, 1, 2, 3].map((i) => [uv[2 * i], uv[2 * i + 1]]);
    if (cornersTrue.every((c) => inBox(cam, c, margin))) break;
  }
  const corners = cornersTrue.map(([u, v]) => [u + gauss(rng, 0, s), v + gauss(rng, 0, s)]);
  const e = eulerFromR(cam.R, view);
  const gs = o.gravitySigmaDeg ?? 0.4;
  const gravity = { pitch_deg: e.pitch * RAD2DEG + gauss(rng, 0, gs), roll_deg: e.roll * RAD2DEG + gauss(rng, 0, gs), sigma_deg: 0.4 };
  return { view, venue, cam, truth: poseReport(cam, view), cornersTrue, corners, gravity };
}

/** Image points on a club laid along the ball line: endpoints at x = ±half_len (+ placement errors), noisy. */
export function synthClub(cam, rng, { half_len = 0.5, sigmaPx = 3, eps_sigma_deg = 0.5, y0_sigma_m = 0.03, z = 0.007 } = {}) {
  const eps = gauss(rng, 0, eps_sigma_deg) * DEG;
  const y0 = gauss(rng, 0, y0_sigma_m);
  const a = project(cam, [-half_len * Math.cos(eps), y0 - half_len * Math.sin(eps), z]);
  const b = project(cam, [half_len * Math.cos(eps), y0 + half_len * Math.sin(eps), z]);
  return { p1: [a.u + gauss(rng, 0, sigmaPx), a.v + gauss(rng, 0, sigmaPx)], p2: [b.u + gauss(rng, 0, sigmaPx), b.v + gauss(rng, 0, sigmaPx)], eps, y0 };
}

/** Image of the resting ball centre (+ Gaussian noise). */
export function synthBall(cam, rng, { sigmaPx = 1, z = BALL_R } = {}) {
  const p = project(cam, [0, 0, z]);
  return [p.u + gauss(rng, 0, sigmaPx), p.v + gauss(rng, 0, sigmaPx)];
}

// ----------------------------------------------------------------------------- rendering

function clipPoly(poly, a, b, c) {
  // keep a·u + b·v + c ≥ 0
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i];
    const Q = poly[(i + 1) % poly.length];
    const dp = a * P[0] + b * P[1] + c;
    const dq = a * Q[0] + b * Q[1] + c;
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
    }
  }
  return out;
}

function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    s += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(s) / 2;
}

/**
 * Render a grayscale image: a bright-ish (green mat luminance) quadrilateral with fine texture on a darker,
 * blotchy textured floor, exact area anti-aliasing, sensor noise and 8-bit quantisation.
 * opts: { mat_level = 150, floor_level = 70, mat_tex = 5, floor_tex = 8, blotch = 18, noise = 2, quad (pixel
 * corners; default projected mat corners) }. Returns { data: Uint8ClampedArray(W·H), W, H, quad }.
 */
export function renderMatImage(cam, venue, rng, opts = {}) {
  const { W, H } = cam;
  const quad = opts.quad ?? projectMany(cam, matCorners(venue ?? DEFAULT_VENUE)).uv.reduce((acc, x, i, arr) => {
    if (i % 2 === 0) acc.push([arr[i], arr[i + 1]]);
    return acc;
  }, []);
  // orient edges so that inside is a·u + b·v + c ≥ 0
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const q = quad[(i + 1) % 4];
    area2 += quad[i][0] * q[1] - q[0] * quad[i][1];
  }
  const sgn = area2 > 0 ? 1 : -1;
  const edges = [];
  for (let i = 0; i < 4; i++) {
    const P = quad[i];
    const Q = quad[(i + 1) % 4];
    let a = -(Q[1] - P[1]);
    let b = Q[0] - P[0];
    const n = Math.hypot(a, b);
    a = (sgn * a) / n;
    b = (sgn * b) / n;
    edges.push([a, b, -(a * P[0] + b * P[1])]);
  }
  const matL = opts.mat_level ?? 150;
  const floorL = opts.floor_level ?? 70;
  const matT = opts.mat_tex ?? 5;
  const floorT = opts.floor_tex ?? 8;
  const blotch = opts.blotch ?? 18;
  const noise = opts.noise ?? 2;
  // coarse floor blotches: value noise on a 24 px grid
  const gs = 24;
  const gw = Math.ceil(W / gs) + 2;
  const gh = Math.ceil(H / gs) + 2;
  const grid = new Float64Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = gauss(rng, 0, blotch);
  const data = new Uint8ClampedArray(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = i + 0.5;
      const v = j + 0.5;
      let dmin = Infinity;
      for (const [a, b, c] of edges) dmin = Math.min(dmin, a * u + b * v + c);
      let cov;
      if (dmin >= 0.71) cov = 1;
      else if (dmin <= -0.71) cov = 0;
      else {
        let poly = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        for (const [a, b, c] of edges) {
          poly = clipPoly(poly, a, b, c);
          if (!poly.length) break;
        }
        cov = poly.length ? polyArea(poly) : 0;
      }
      const gx = u / gs;
      const gy = v / gs;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const k = iy * gw + ix;
      const bl = (1 - fy) * ((1 - fx) * grid[k] + fx * grid[k + 1]) + fy * ((1 - fx) * grid[k + gw] + fx * grid[k + gw + 1]);
      const floorV = floorL + bl + gauss(rng, 0, floorT);
      const matV = matL + gauss(rng, 0, matT);
      data[j * W + i] = cov * matV + (1 - cov) * floorV + gauss(rng, 0, noise);
    }
  }
  return { data, W, H, quad };
}

// ----------------------------------------------------------------------------- ball drop (K11)

/**
 * Ball released at rest from (x0, y0, z0) at t_release; frames at t_frame = n / fps. Detection times follow the
 * rolling-shutter mapping of interfaces.md §2 for cam.readout (solved by fixed-point iteration), so dropTest
 * with applyReadout = true is exact. opts: { cam, rng, z0 = 1.0, x0 = 0, y0 = 0, fps = 240, g = G,
 * t_release = 0.0021, sigmaPx = 0 }. Returns { obs: [{ frame, t_s, u, v }], truth: { g, z0 } }.
 */
export function synthDrop(o) {
  const { cam, rng } = o;
  const fps = o.fps ?? 240;
  const g = o.g ?? G;
  const z0 = o.z0 ?? 1.0;
  const x0 = o.x0 ?? 0;
  const y0 = o.y0 ?? 0;
  const tr = o.t_release ?? 0.0021;
  const s = o.sigmaPx ?? 0;
  const ro = cam.readout ?? { ms: 0, axis: 'v', dir: 1 };
  const pos = (t) => {
    const dt = Math.max(0, t - tr);
    return [x0, y0, z0 - 0.5 * g * dt * dt];
  };
  const obs = [];
  for (let n = 1; n < 10 * fps; n++) {
    const tf = n / fps;
    let t = tf;
    let p;
    for (let it = 0; it < 8; it++) {
      p = project(cam, pos(t));
      const frac = ro.axis === 'u' ? p.u / cam.W : p.v / cam.H;
      t = tf + ((ro.ms ?? 0) / 1000) * (ro.dir ?? 1) * (frac - 0.5);
    }
    if (pos(t)[2] < BALL_R) break;
    if (t <= tr) continue;
    obs.push({ frame: n, t_s: tf, u: p.u + (s ? gauss(rng, 0, s) : 0), v: p.v + (s ? gauss(rng, 0, s) : 0) });
  }
  return { obs, truth: { g, z0 } };
}

/** Camera with the same rotation and focal length but its centre scaled by k about the ball spot (scale error). */
export function scaledCamera(cam, k) {
  const C = center(cam);
  return makeCamera({ ...cam, t: undefined, C: [C[0] * k, C[1] * k, C[2] * k] });
}
