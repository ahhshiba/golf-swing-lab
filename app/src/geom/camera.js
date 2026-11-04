// Pinhole camera in the mat frame M (interfaces.md §2, §5, §6). Ported from
// baseball-digital-twin-demo tools/monocular/mono/camera.py and extended with k1, view-relative Euler angles.
//
// Camera frame (OpenCV): +x right, +y down, +z forward; Xc = R·Xw + t, centre C = −Rᵀ·t.
// Pixels: u right, v down, origin at the top-left image corner, principal point fixed at (W/2, H/2).
// Distortion: one radial term on normalised coordinates, xd = x·(1 + k1·r²).

import { DEFAULT_READOUT_MS, IPHONE_HFOV_1080P240_DEG, DEG, RAD2DEG } from './constants.js';
import { cross3, dot3, mat3TMulVec, norm3, normalize3, sub3 } from './linalg.js';

/** Nominal optical-axis heading (azimuth from +x, CCW seen from above) per view. */
export const VIEW_HEADING = Object.freeze({ face_on: Math.PI / 2, dtl: 0, high_behind: 0 });

/** Nominal setup geometry per view (interfaces.md §5; ranges collapsed to their midpoints). */
export const NOMINAL_GEOMETRY = Object.freeze({
  face_on: Object.freeze({ D: 2.7, h: 0.84, shift: 0.4, W: 1920, H: 1080 }),
  dtl: Object.freeze({ Db: 3.25, y: 0.35, h: 1.0, W: 1080, H: 1920 }),
  high_behind: Object.freeze({ Db: 2.875, y: 0, h: 1.7, W: 1920, H: 1080 }),
});

function headingOf(view) {
  const a = VIEW_HEADING[view];
  if (a === undefined) throw new RangeError(`unknown view '${view}'`);
  return a;
}

function wrapPi(x) {
  const twoPi = 2 * Math.PI;
  let y = x - twoPi * Math.round(x / twoPi);
  if (y <= -Math.PI) y += twoPi;
  return y;
}

function finite(x, name) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`camera: ${name} must be a finite number`);
  return x;
}

/** Focal length in pixels for an image W pixels wide with horizontal field of view hfovDeg. */
export function fFromHfov(W, hfovDeg) {
  return W / 2 / Math.tan((hfovDeg * DEG) / 2);
}

/** Horizontal field of view (deg) for width W and focal length f (px). */
export function hfovFromF(W, f) {
  return 2 * Math.atan(W / (2 * f)) * RAD2DEG;
}

/**
 * Build a camera object { W, H, f, cx, cy, k1, R, t, readout } (plain JSON).
 * o: { W, H, f | hfovDeg, k1 = 0, R (row-major 9, default identity), t | C (centre in M), readout? }.
 * cx, cy are always W/2, H/2 (any input cx/cy is ignored). If both t and C are given, t wins.
 * readout defaults to { ms: DEFAULT_READOUT_MS, axis: 'v', dir: 1 }; physics/shutter.js owns the real mapping.
 */
export function makeCamera(o) {
  const W = finite(o.W, 'W');
  const H = finite(o.H, 'H');
  if (!(W > 0 && H > 0)) throw new RangeError('camera: W and H must be > 0');
  const f = finite(o.f ?? (o.hfovDeg != null ? fFromHfov(W, o.hfovDeg) : undefined), 'f');
  if (!(f > 0)) throw new RangeError('camera: f must be > 0');
  const k1 = finite(o.k1 ?? 0, 'k1');
  const R = o.R ? Array.from(o.R) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (R.length !== 9) throw new RangeError('camera: R must have 9 entries');
  R.forEach((x, i) => finite(x, `R[${i}]`));
  let t;
  if (o.t) t = Array.from(o.t);
  else if (o.C) {
    const C = o.C;
    t = [
      -(R[0] * C[0] + R[1] * C[1] + R[2] * C[2]),
      -(R[3] * C[0] + R[4] * C[1] + R[5] * C[2]),
      -(R[6] * C[0] + R[7] * C[1] + R[8] * C[2]),
    ];
  } else t = [0, 0, 0];
  if (t.length !== 3) throw new RangeError('camera: t must have 3 entries');
  t.forEach((x, i) => finite(x, `t[${i}]`));
  const ro = o.readout ?? {};
  const readout = { ms: ro.ms ?? DEFAULT_READOUT_MS, axis: ro.axis ?? 'v', dir: ro.dir ?? 1 };
  if (readout.axis !== 'u' && readout.axis !== 'v') throw new RangeError("camera: readout.axis must be 'u' or 'v'");
  if (readout.dir !== 1 && readout.dir !== -1) throw new RangeError('camera: readout.dir must be +1 or -1');
  finite(readout.ms, 'readout.ms');
  return { W, H, f, cx: W / 2, cy: H / 2, k1, R, t, readout };
}

/** Camera centre in M: C = −Rᵀ·t. */
export function center(cam) {
  const c = mat3TMulVec(cam.R, cam.t);
  return [-c[0], -c[1], -c[2]];
}

/** World point -> camera-frame coordinates [xc, yc, zc]. */
export function toCamera(cam, X) {
  const R = cam.R;
  const t = cam.t;
  return [
    R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0],
    R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1],
    R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2],
  ];
}

/** Apply radial distortion to normalised coordinates: [x·s, y·s], s = 1 + k1·(x² + y²). */
export function distortNormalized(k1, x, y) {
  if (!k1) return [x, y];
  const s = 1 + k1 * (x * x + y * y);
  return [x * s, y * s];
}

/**
 * Invert distortNormalized by fixed-point iteration x ← xd / (1 + k1·r²(x)).
 * Returns [x, y], or [NaN, NaN] when the iteration does not converge (outside the invertible region,
 * 1 + 3·k1·r² ≤ 0) or the re-distorted point misses by more than 1e-12.
 */
export function undistortNormalized(k1, xd, yd, maxIter = 200) {
  if (!k1) return [xd, yd];
  let x = xd;
  let y = yd;
  for (let i = 0; i < maxIter; i++) {
    const s = 1 + k1 * (x * x + y * y);
    if (!(s > 0)) return [NaN, NaN];
    const xn = xd / s;
    const yn = yd / s;
    const dx = xn - x;
    const dy = yn - y;
    x = xn;
    y = yn;
    if (dx * dx + dy * dy <= 1e-32 * (1 + x * x + y * y)) break;
  }
  const s = 1 + k1 * (x * x + y * y);
  if (!(Math.abs(x * s - xd) <= 1e-12 * (1 + Math.abs(xd)) && Math.abs(y * s - yd) <= 1e-12 * (1 + Math.abs(yd)))) {
    return [NaN, NaN];
  }
  return [x, y];
}

/**
 * Project a world point. Returns { u, v, z } with z the camera-frame depth; u, v are NaN when z ≤ 0
 * (point at or behind the camera plane).
 */
export function project(cam, X) {
  const R = cam.R;
  const t = cam.t;
  const xc = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0];
  const yc = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1];
  const zc = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
  if (!(zc > 0)) return { u: NaN, v: NaN, z: zc };
  let x = xc / zc;
  let y = yc / zc;
  const k1 = cam.k1;
  if (k1) {
    const s = 1 + k1 * (x * x + y * y);
    x *= s;
    y *= s;
  }
  return { u: cam.f * x + cam.cx, v: cam.f * y + cam.cy, z: zc };
}

/**
 * Project many points: pts is an Array of [x, y, z] or a flat array of 3N numbers.
 * Returns { uv: Float64Array(2N) [u0, v0, u1, v1, …], z: Float64Array(N) } (NaN pixels behind the camera).
 */
export function projectMany(cam, pts) {
  const flat = pts.length > 0 && typeof pts[0] === 'number';
  const N = flat ? Math.floor(pts.length / 3) : pts.length;
  const uv = new Float64Array(2 * N);
  const z = new Float64Array(N);
  const X = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    if (flat) {
      X[0] = pts[3 * i];
      X[1] = pts[3 * i + 1];
      X[2] = pts[3 * i + 2];
    } else {
      X[0] = pts[i][0];
      X[1] = pts[i][1];
      X[2] = pts[i][2];
    }
    const p = project(cam, X);
    uv[2 * i] = p.u;
    uv[2 * i + 1] = p.v;
    z[i] = p.z;
  }
  return { uv, z };
}

/** Pixel -> undistorted normalised image coordinates [x, y] (NaN if undistortion fails). */
export function pixelToNormalized(cam, u, v) {
  return undistortNormalized(cam.k1, (u - cam.cx) / cam.f, (v - cam.cy) / cam.f);
}

/** Pixel -> viewing ray { C, d }: camera centre and unit direction in M (d is NaN if undistortion fails). */
export function ray(cam, u, v) {
  const C = center(cam);
  const [x, y] = pixelToNormalized(cam, u, v);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { C, d: [NaN, NaN, NaN] };
  const w = mat3TMulVec(cam.R, [x, y, 1]);
  const n = norm3(w);
  return { C, d: [w[0] / n, w[1] / n, w[2] / n] };
}

/** Intersection of a ray { C, d } with the horizontal plane z = z0; null if parallel or behind C. */
export function intersectRayZ(rayObj, z0 = 0) {
  const { C, d } = rayObj;
  if (!(Math.abs(d[2]) > 1e-12)) return null;
  const s = (z0 - C[2]) / d[2];
  if (!(s > 0)) return null;
  return [C[0] + s * d[0], C[1] + s * d[1], z0];
}

/**
 * Rotation looking from C at target: optical axis f = unit(target − C), image right r0 = unit(f × up),
 * image down d0 = f × r0, then roll about f: r = cos ρ·r0 + sin ρ·d0, d = −sin ρ·r0 + cos ρ·d0
 * (positive roll = clockwise as seen by the camera; image content turns counter-clockwise).
 * Returns { R, t } ready to spread into makeCamera. Throws if f is parallel to up.
 */
export function lookAt(C, target, up = [0, 0, 1], rollRad = 0) {
  const f = normalize3(sub3(target, C));
  const rr = cross3(f, up);
  const nr = norm3(rr);
  if (!(nr > 1e-12 * norm3(up))) throw new RangeError('lookAt: viewing direction is parallel to up');
  const r0 = [rr[0] / nr, rr[1] / nr, rr[2] / nr];
  const d0 = cross3(f, r0);
  const R = rowsWithRoll(r0, d0, f, rollRad);
  return { R, t: tFromC(R, C) };
}

function rowsWithRoll(r0, d0, f, roll) {
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  return [
    c * r0[0] + s * d0[0], c * r0[1] + s * d0[1], c * r0[2] + s * d0[2],
    -s * r0[0] + c * d0[0], -s * r0[1] + c * d0[1], -s * r0[2] + c * d0[2],
    f[0], f[1], f[2],
  ];
}

function tFromC(R, C) {
  return [
    -(R[0] * C[0] + R[1] * C[1] + R[2] * C[2]),
    -(R[3] * C[0] + R[4] * C[1] + R[5] * C[2]),
    -(R[6] * C[0] + R[7] * C[1] + R[8] * C[2]),
  ];
}

/**
 * Rotation from view-relative angles (rad), interfaces.md §6:
 *   yaw   = rotation about world +z away from the view's nominal heading (positive = CCW seen from above);
 *   pitch = elevation of the optical axis above horizontal (positive = up; absolute, not view-relative);
 *   roll  = rotation about the optical axis (positive = clockwise as seen by the camera).
 * Nominal headings: face_on +y, dtl +x, high_behind +x (its pitch is negative, ≈ −30°).
 * Returns R (row-major 9); when C is given returns { R, t } instead.
 */
export function rFromEuler(e, view, C) {
  const a = headingOf(view) + (e.yaw ?? 0);
  const p = e.pitch ?? 0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const f = [cp * ca, cp * sa, sp];
  const r0 = [sa, -ca, 0];
  const d0 = [sp * ca, sp * sa, -cp]; // f × r0
  const R = rowsWithRoll(r0, d0, f, e.roll ?? 0);
  return C ? { R, t: tFromC(R, C) } : R;
}

/**
 * Inverse of rFromEuler: { yaw, pitch, roll } in rad (yaw, roll wrapped to [−π, π)).
 * R may be a row-major 9 array or a camera object. At pitch = ±90° the heading is taken from the image
 * right axis and roll is 0.
 */
export function eulerFromR(R, view) {
  const M = Array.isArray(R) || ArrayBuffer.isView(R) ? R : R.R;
  const h0 = headingOf(view);
  const f = [M[6], M[7], M[8]];
  const r = [M[0], M[1], M[2]];
  const ch = Math.hypot(f[0], f[1]);
  const pitch = Math.atan2(f[2], ch);
  const a = ch > 1e-12 ? Math.atan2(f[1], f[0]) : Math.atan2(r[0], -r[1]);
  const r0 = [Math.sin(a), -Math.cos(a), 0];
  const d0 = cross3(f, r0);
  const roll = Math.atan2(dot3(r, d0), dot3(r, r0));
  return { yaw: wrapPi(a - h0), pitch, roll: wrapPi(roll) };
}

/** Report-boundary pose of a camera for a view: { yaw_deg, pitch_deg, roll_deg, X_m, Y_m, h_m, D_m }. */
export function poseReport(cam, view) {
  const e = eulerFromR(cam.R, view);
  const C = center(cam);
  return {
    yaw_deg: e.yaw * RAD2DEG,
    pitch_deg: e.pitch * RAD2DEG,
    roll_deg: e.roll * RAD2DEG,
    X_m: C[0],
    Y_m: C[1],
    h_m: C[2],
    D_m: Math.hypot(C[0], C[1]),
  };
}

/**
 * Nominal camera for a view (interfaces.md §5): face_on at (shift, −D, h) looking +y, landscape;
 * dtl at (−Db, y, h) looking +x, portrait; high_behind at (−Db, y, h) aimed at the ball spot, landscape.
 * opts override NOMINAL_GEOMETRY fields and may give f, hfovDeg, k1, readout, yaw/pitch/roll offsets (rad,
 * added to the nominal angles). Default f = fFromHfov(max(W, H), IPHONE_HFOV_1080P240_DEG): the FOV constant
 * spans the long image side whatever the orientation.
 */
export function nominalCamera(view, opts = {}) {
  if (!NOMINAL_GEOMETRY[view]) throw new RangeError(`unknown view '${view}'`);
  const g = { ...NOMINAL_GEOMETRY[view], ...opts };
  const f = opts.f ?? fFromHfov(Math.max(g.W, g.H), opts.hfovDeg ?? IPHONE_HFOV_1080P240_DEG);
  let C;
  let base;
  if (view === 'face_on') {
    C = [g.shift, -g.D, g.h];
    base = { yaw: 0, pitch: 0, roll: 0 };
  } else if (view === 'dtl') {
    C = [-g.Db, g.y, g.h];
    base = { yaw: 0, pitch: 0, roll: 0 };
  } else {
    C = [-g.Db, g.y, g.h];
    base = eulerFromR(lookAt(C, [0, 0, 0]).R, view);
  }
  const e = { yaw: base.yaw + (opts.yaw ?? 0), pitch: base.pitch + (opts.pitch ?? 0), roll: base.roll + (opts.roll ?? 0) };
  const { R, t } = rFromEuler(e, view, C);
  return makeCamera({ W: g.W, H: g.H, f, k1: opts.k1 ?? 0, R, t, readout: opts.readout });
}
