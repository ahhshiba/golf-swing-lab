// Synthetic grayscale frame renderer for the track module tests (pure; no DOM, deterministic given the seed).
//
// Everything is specified in PIXEL space (per-frame start/end centres of each object during the exposure), so this
// file does not depend on the physics module. Pixel (i, j) has its centre at (i + 0.5, j + 0.5), the same
// convention as interfaces.md section 2.
//
//   renderClip(spec)  -> { frames: Uint8Array[], times: Float64Array, W, H, truth }
//   makeShotSpec(seed, opts?) -> spec of a random full shot (rest phase, club sweep, ball flight, distractor)
//   makeRestSpec(seed, opts?) -> spec of a still scene with a resting ball (for rest-ball / lie tests)
//
// spec = {
//   W = 384, H = 216, nFrames, fps = 240, seed,
//   bg: { base = 100, amp = 1, lines = 2, grain = 2.5 },     // textured static background (seeded)
//   noise = 4,                                               // Gaussian sensor noise sigma in DN
//   flicker: { gain = 0.03, offset = 2 } | null,             // per-frame global brightness change
//   psf = 0.5,                                               // optics blur sigma in px (0 = none)
//   ball: { level = 215, shade = 0, frames: [ {u0,v0,u1,v1,r,hold?} | null ] },
//       // during the exposure the centre is at (u0,v0) for the first `hold` fraction, then moves linearly to (u1,v1)
//   tee: { len = 18, width = 3, level = 235, cap = 0 } | null,     // thin vertical bar under the REST position
//   restPos: { u, v, r },                                          // where the tee / shadow sit (ball spot)
//   shadow: { depth = 20, untilFrame } | null,                     // soft shadow under the resting ball
//   distractor: { level = 205, shade = 0, frames: [...] } | null,  // a second ball, same frame format
//   club: { level = 50, frames: [ {u0,v0,u1,v1,a,b,ang} | null ], shaft: { len, w } | null } | null,
// }
// truth = { ball: [ {frame,u,v,r,w_px,inside} | null ], distractor: [...], club: [ {frame,u,v} | null ],
//           rest: {u,v,r,w_px}, tee: {...} | null }
//   u, v = exposure-averaged centre (the centroid of the rendered object); inside = whole path at least r+3 px from
//   every border (so the centroid is not truncated by the frame edge).

import { mulberry32, uniform } from '../../app/src/geom/rng.js';

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(W, H, cell, rng, amp) {
  const nx = Math.ceil(W / cell) + 2;
  const ny = Math.ceil(H / cell) + 2;
  const lat = new Float32Array(nx * ny);
  for (let i = 0; i < lat.length; i++) lat[i] = (rng() * 2 - 1) * amp;
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = y / cell;
    const iy = Math.floor(fy);
    const ty = smooth(fy - iy);
    for (let x = 0; x < W; x++) {
      const fx = x / cell;
      const ix = Math.floor(fx);
      const tx = smooth(fx - ix);
      const a = lat[iy * nx + ix], b = lat[iy * nx + ix + 1];
      const c = lat[(iy + 1) * nx + ix], d = lat[(iy + 1) * nx + ix + 1];
      out[y * W + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Seeded textured background (float, DN). Multi-scale value noise + fine grain + a few faint seams + weave. */
export function makeBackground(W, H, rng, o = {}) {
  const base = o.base ?? 100;
  const amp = o.amp ?? 1;
  const out = new Float32Array(W * H).fill(base);
  for (const [cell, a] of [[64, 6], [24, 5], [9, 4], [3, 2.5]]) {
    const n = valueNoise(W, H, cell, rng, a * amp);
    for (let i = 0; i < out.length; i++) out[i] += n[i];
  }
  const grain = (o.grain ?? 2.5) * amp;
  for (let i = 0; i < out.length; i += 2) {
    const u1 = 1 - rng(), u2 = rng();
    const rr = Math.sqrt(-2 * Math.log(u1)) * grain;
    out[i] += rr * Math.cos(2 * Math.PI * u2);
    if (i + 1 < out.length) out[i + 1] += rr * Math.sin(2 * Math.PI * u2);
  }
  // weave: faint two-direction sinusoid
  const ph1 = rng() * 6.28, ph2 = rng() * 6.28;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] += 1.5 * amp * (Math.sin(x * 1.9 + ph1) + Math.sin(y * 2.3 + ph2)) * 0.5;
  // seams: thin straight lines of low contrast (|amp| <= 6 DN)
  for (let k = 0; k < (o.lines ?? 2); k++) {
    const ang = rng() * Math.PI, cx = rng() * W, cy = rng() * H, c = (rng() > 0.5 ? 1 : -1) * (3 + rng() * 3) * amp;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.abs((x + 0.5 - cx) * nx + (y + 0.5 - cy) * ny);
      if (d < 1.5) out[y * W + x] += c * (1 - d / 1.5);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------- coverage and compositing

const SS = 6; // supersampling grid for edge pixels

function ellipseCov(px, py, cx, cy, a, b, cs, sn, lo2, hi2) {
  // coverage of the pixel [px-0.5, px+0.5]^2 by the ellipse; (cs, sn) = rotation of the major axis;
  // lo2 / hi2 = squared normalised radii below / above which the pixel is certainly inside / outside
  const dx = px - cx, dy = py - cy;
  const x = dx * cs + dy * sn, y = -dx * sn + dy * cs;
  const q = (x / a) * (x / a) + (y / b) * (y / b);
  if (q < lo2) return 1;
  if (q > hi2) return 0;
  let n = 0;
  for (let j = 0; j < SS; j++) {
    const sy = dy - 0.5 + (j + 0.5) / SS;
    for (let i = 0; i < SS; i++) {
      const sx = dx - 0.5 + (i + 0.5) / SS;
      const xr = sx * cs + sy * sn, yr = -sx * sn + sy * cs;
      if ((xr / a) * (xr / a) + (yr / b) * (yr / b) <= 1) n++;
    }
  }
  return n / (SS * SS);
}

// One moving object composited into `scene` by integrating its coverage over `samples` positions.
// samples: [{cx, cy, a, b, ang}] equally weighted; level(dx, dy, a, b) -> DN
function compositeObject(scene, W, H, samples, level) {
  // tight axis-aligned extent of a rotated ellipse (half-widths ex, ey) plus a 1.5 px margin
  const extent = (s) => {
    const cs = Math.cos(s.ang || 0), sn = Math.sin(s.ang || 0);
    return [Math.sqrt((s.a * cs) ** 2 + (s.b * sn) ** 2) + 1.5, Math.sqrt((s.a * sn) ** 2 + (s.b * cs) ** 2) + 1.5];
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of samples) {
    const [ex, ey] = extent(s);
    x0 = Math.min(x0, s.cx - ex); x1 = Math.max(x1, s.cx + ex);
    y0 = Math.min(y0, s.cy - ey); y1 = Math.max(y1, s.cy + ey);
  }
  const bx0 = Math.max(0, Math.floor(x0)), bx1 = Math.min(W, Math.ceil(x1));
  const by0 = Math.max(0, Math.floor(y0)), by1 = Math.min(H, Math.ceil(y1));
  if (bx1 <= bx0 || by1 <= by0) return;
  const bw = bx1 - bx0, bh = by1 - by0;
  const C = new Float32Array(bw * bh);
  const A = new Float32Array(bw * bh);
  const S = samples.length;
  for (const s of samples) {
    const [ex, ey] = extent(s);
    const sx0 = Math.max(bx0, Math.floor(s.cx - ex)), sx1 = Math.min(bx1, Math.ceil(s.cx + ex));
    const sy0 = Math.max(by0, Math.floor(s.cy - ey)), sy1 = Math.min(by1, Math.ceil(s.cy + ey));
    const cs = Math.cos(s.ang || 0), sn = Math.sin(s.ang || 0);
    const m = 0.9 / Math.min(s.a, s.b);
    const lo2 = (1 - m) * (1 - m), hi2 = (1 + m) * (1 + m);
    for (let y = sy0; y < sy1; y++) {
      for (let x = sx0; x < sx1; x++) {
        const c = ellipseCov(x + 0.5, y + 0.5, s.cx, s.cy, s.a, s.b, cs, sn, lo2, hi2);
        if (c <= 0) continue;
        const k = (y - by0) * bw + (x - bx0);
        C[k] += c / S;
        A[k] += (c * level(x + 0.5 - s.cx, y + 0.5 - s.cy, s)) / S;
      }
    }
  }
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const k = (y - by0) * bw + (x - bx0);
      const c = C[k];
      if (c > 0) scene[y * W + x] = scene[y * W + x] * (1 - c) + A[k];
    }
  }
}

function pathSamples(f, shapeFn) {
  // number of sub-positions: <= 1 px apart (capped)
  const len = Math.hypot(f.u1 - f.u0, f.v1 - f.v0);
  const S = clamp(Math.ceil(len / 1.0), 1, 60);
  const hold = clamp(f.hold ?? 0, 0, 1);
  const out = new Array(S);
  let mu = 0, mv = 0;
  for (let i = 0; i < S; i++) {
    const s = (i + 0.5) / S;
    const q = s < hold ? 0 : hold >= 1 ? 0 : (s - hold) / (1 - hold);
    const cx = f.u0 + (f.u1 - f.u0) * q, cy = f.v0 + (f.v1 - f.v0) * q;
    mu += cx; mv += cy;
    out[i] = shapeFn(cx, cy);
  }
  return { samples: out, u: mu / S, v: mv / S };
}

function drawRect(scene, W, H, x0, y0, x1, y1, level) {
  // exact area coverage of the axis-aligned rectangle [x0,x1] x [y0,y1] (continuous coords)
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
    const cyv = Math.min(y + 1, y1) - Math.max(y, y0);
    if (cyv <= 0) continue;
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
      const cxv = Math.min(x + 1, x1) - Math.max(x, x0);
      if (cxv <= 0) continue;
      const c = cxv * cyv;
      scene[y * W + x] = scene[y * W + x] * (1 - c) + level * c;
    }
  }
}

function blurInPlace(a, W, H, sigma, tmp) {
  // separable Gaussian; radius ceil(2.5 sigma) (sigma 0.5 -> 3 taps, the dropped tail weighs < 0.1 %)
  const rad = Math.max(1, Math.ceil(2.5 * sigma - 0.25));
  const k = new Float32Array(2 * rad + 1);
  let s = 0;
  for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + rad]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  if (rad === 1) {
    const k0 = k[0], k1 = k[1];
    for (let y = 0; y < H; y++) {
      const off = y * W;
      tmp[off] = (k0 + k1) * a[off] + k0 * a[off + 1];
      for (let x = 1; x < W - 1; x++) tmp[off + x] = k0 * (a[off + x - 1] + a[off + x + 1]) + k1 * a[off + x];
      tmp[off + W - 1] = (k0 + k1) * a[off + W - 1] + k0 * a[off + W - 2];
    }
    for (let x = 0; x < W; x++) a[x] = (k0 + k1) * tmp[x] + k0 * tmp[W + x];
    for (let y = 1; y < H - 1; y++) {
      const off = y * W;
      for (let x = 0; x < W; x++) a[off + x] = k0 * (tmp[off - W + x] + tmp[off + W + x]) + k1 * tmp[off + x];
    }
    const last = (H - 1) * W;
    for (let x = 0; x < W; x++) a[last + x] = (k0 + k1) * tmp[last + x] + k0 * tmp[last - W + x];
    return;
  }
  for (let y = 0; y < H; y++) {
    const off = y * W;
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -rad; i <= rad; i++) v += k[i + rad] * a[off + clamp(x + i, 0, W - 1)];
      tmp[off + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let i = -rad; i <= rad; i++) v += k[i + rad] * tmp[clamp(y + i, 0, H - 1) * W + x];
      a[y * W + x] = v;
    }
  }
}

// ---------------------------------------------------------------------------------- clip renderer

export function renderClip(spec) {
  const W = spec.W ?? 384, H = spec.H ?? 216;
  const n = spec.nFrames;
  const fps = spec.fps ?? 240;
  const seed = spec.seed ?? 1;
  const bgRng = mulberry32((seed * 2654435761) >>> 0);
  const bg = makeBackground(W, H, bgRng, spec.bg ?? {});
  const noiseRng = mulberry32(((seed ^ 0x9e3779b9) * 40503) >>> 0);
  const flick = spec.flicker === undefined ? { gain: 0.03, offset: 2 } : spec.flicker;
  const sigma = spec.noise ?? 4;
  const psf = spec.psf ?? 0.5;
  const rest = spec.restPos ?? null;

  const frames = new Array(n);
  const times = new Float64Array(n);
  const truth = { ball: new Array(n).fill(null), distractor: new Array(n).fill(null), club: new Array(n).fill(null), rest: null, tee: null };
  if (rest) truth.rest = { u: rest.u, v: rest.v, r: rest.r, w_px: 2 * rest.r };

  const scene = new Float32Array(W * H);
  const tmp = new Float32Array(W * H);

  const inside = (f, r) => Math.min(f.u0, f.u1) - r >= 3 && Math.max(f.u0, f.u1) + r <= W - 3 && Math.min(f.v0, f.v1) - r >= 3 && Math.max(f.v0, f.v1) + r <= H - 3;

  for (let k = 0; k < n; k++) {
    times[k] = k / fps;
    scene.set(bg);
    // static tee under the rest position
    if (spec.tee && rest) {
      const t = spec.tee;
      const x = rest.u, yTop = rest.v + rest.r - 0.6, yBot = rest.v + rest.r + t.len;
      drawRect(scene, W, H, x - t.width / 2, yTop, x + t.width / 2, yBot, t.level ?? 235);
      if (t.cap) drawRect(scene, W, H, x - t.width * 1.2, yTop, x + t.width * 1.2, yTop + t.cap, t.level ?? 235);
      truth.tee = { u: x, y0: yTop, y1: yBot, width: t.width, len: t.len };
    }
    // soft shadow while the ball is on its spot
    if (spec.shadow && rest && k <= (spec.shadow.untilFrame ?? n)) {
      const t = spec.tee ? spec.tee.len : 0;
      const sy = rest.v + rest.r + t + 0.2 * rest.r, hw = 1.15 * rest.r, hh = 0.35 * rest.r;
      for (let y = Math.max(0, Math.floor(sy - 2 * hh - 1)); y < Math.min(H, Math.ceil(sy + 2 * hh + 1)); y++) {
        for (let x = Math.max(0, Math.floor(rest.u - 2 * hw)); x < Math.min(W, Math.ceil(rest.u + 2 * hw)); x++) {
          const q = ((x + 0.5 - rest.u) / hw) ** 2 + ((y + 0.5 - sy) / hh) ** 2;
          if (q < 4) scene[y * W + x] -= (spec.shadow.depth ?? 20) * Math.exp(-1.6 * q);
        }
      }
    }
    // moving objects: club (behind), distractor, ball (front)
    if (spec.club && spec.club.frames[k]) {
      const f = spec.club.frames[k];
      const lev = spec.club.level ?? 50;
      const hd = pathSamples(f, (cx, cy) => ({ cx, cy, a: f.a, b: f.b, ang: f.ang }));
      compositeObject(scene, W, H, hd.samples, () => lev);
      truth.club[k] = { frame: k, u: hd.u, v: hd.v };
      if (spec.club.shaft) {
        const sh = spec.club.shaft;
        // shaft points from the head towards the pivot (direction angle sh.dir in radians, image axes)
        const dirAng = f.shaftAng ?? sh.ang ?? -Math.PI / 2;
        // the shaft starts at the head's edge in that direction (support radius of the head ellipse)
        const dl = dirAng - (f.ang || 0);
        const edge = (f.a * f.b) / Math.sqrt((f.b * Math.cos(dl)) ** 2 + (f.a * Math.sin(dl)) ** 2);
        const sd = pathSamples(f, (cx, cy) => ({
          cx: cx + Math.cos(dirAng) * (sh.len / 2 + edge - 1), cy: cy + Math.sin(dirAng) * (sh.len / 2 + edge - 1),
          a: sh.len / 2, b: sh.w / 2, ang: dirAng,
        }));
        compositeObject(scene, W, H, sd.samples, () => lev);
      }
    }
    for (const key of ['distractor', 'ball']) {
      const obj = spec[key];
      if (!obj || !obj.frames[k]) continue;
      const f = obj.frames[k];
      const lev = obj.level ?? 215;
      const shade = obj.shade ?? 0;
      const pp = pathSamples(f, (cx, cy) => ({ cx, cy, a: f.r, b: f.r, ang: 0 }));
      compositeObject(scene, W, H, pp.samples, (dx, dy, s) => lev * (1 - shade * (0.5 + 0.5 * (dy / s.a))));
      truth[key][k] = { frame: k, u: pp.u, v: pp.v, r: f.r, w_px: 2 * f.r, inside: inside(f, f.r) };
    }
    if (psf > 0) blurInPlace(scene, W, H, psf, tmp);
    // flicker + noise + quantisation
    const g = flick ? 1 + flick.gain * (noiseRng() * 2 - 1) : 1;
    const o = flick ? flick.offset * (noiseRng() * 2 - 1) : 0;
    const out = new Uint8Array(W * H);
    for (let i = 0; i < out.length; i += 2) {
      let z0 = 0, z1 = 0;
      if (sigma > 0) {
        const u1 = 1 - noiseRng(), u2 = noiseRng();
        const rr = Math.sqrt(-2 * Math.log(u1)) * sigma;
        z0 = rr * Math.cos(6.283185307179586 * u2);
        z1 = rr * Math.sin(6.283185307179586 * u2);
      }
      out[i] = clamp(Math.round(scene[i] * g + o + z0), 0, 255);
      if (i + 1 < out.length) out[i + 1] = clamp(Math.round(scene[i + 1] * g + o + z1), 0, 255);
    }
    frames[k] = out;
  }
  return { frames, times, W, H, truth, spec };
}

// ---------------------------------------------------------------------------------- spec generators

/** A still scene (a few identical frames) with a resting ball, optional tee and shadow. */
export function makeRestSpec(seed, o = {}) {
  const rng = mulberry32((seed * 7919 + 13) >>> 0);
  const U = (a, b) => uniform(rng, a, b);
  const r = o.r ?? U(7, 12);
  const u = o.u ?? U(150, 230) + (rng() - 0.5), v = o.v ?? U(80, 130) + (rng() - 0.5);
  const tee = o.tee === undefined ? null : o.tee === true
    ? { len: U(12, 24) * (r / 9), width: U(2, 4) * (r / 9) ** 0.5, level: U(195, 245), cap: rng() < 0.5 ? 0 : 3 }
    : o.tee;
  const base = o.base ?? U(80, 140);
  const f = { u0: u, v0: v, u1: u, v1: v, r };
  return {
    W: o.W ?? 384, H: o.H ?? 216, nFrames: o.nFrames ?? 1, fps: 240, seed,
    bg: { base, amp: o.amp ?? 1, lines: o.lines ?? 2, grain: o.grain ?? 2.5 },
    noise: o.noise ?? 4, flicker: o.flicker === undefined ? null : o.flicker, psf: o.psf ?? 0.5,
    ball: { level: o.ballLevel ?? U(205, 235), shade: o.shade ?? 0, frames: Array.from({ length: o.nFrames ?? 1 }, () => ({ ...f })) },
    tee,
    restPos: { u, v, r },
    shadow: o.shadow ? { depth: U(12, 28), untilFrame: 1e9 } : null,
    distractor: null, club: null,
  };
}

/**
 * A random full shot. opts: { r, nVis, aspectMax = 4, tee, shadow, noise = 4, distractor = true, club = true,
 *                              nPre = 14, nPost = 16 }
 * Geometry: ROI 384 x 216; the ball rests at (u, v), is struck at fractional time t_imp inside frame interval
 * [nPre-1, nPre), then flies up and to the right in a straight line (+ a little downward curvature) and leaves the
 * frame after about nVis frames (5.5..15). Exposure is a fraction e of the frame interval so the blob length/width
 * ("aspect") is at most aspectMax. A club head sweeps an arc into the ball (and on, after impact); a second ball
 * crosses the top band far from the ball path.
 */
export function makeShotSpec(seed, o = {}) {
  const rng = mulberry32((seed * 104729 + 7) >>> 0);
  const U = (a, b) => uniform(rng, a, b);
  const W = 384, H = 216;
  const r = o.r ?? U(7, 11);
  const rest = { u: o.u ?? U(110, 170), v: o.v ?? U(130, 158), r };
  const nPre = o.nPre ?? 14, nPost = o.nPost ?? 16;
  const n = nPre + nPost;
  const alpha = (o.alpha_deg ?? U(8, 38)) * Math.PI / 180;
  const dir = [Math.cos(alpha), -Math.sin(alpha)];
  const dExit = Math.min((W - 2 - rest.u) / dir[0], (rest.v - 2) / -dir[1]);
  const nVis = o.nVis ?? U(5.5, 15);
  const s = dExit / nVis; // px per frame
  const aspectMax = o.aspectMax ?? 4;
  const eRaw = o.expo ?? U(0.2, 0.9);
  const e = Math.min(eRaw, ((aspectMax - 1) * 2 * r) / s);
  const phi = o.phi ?? U(0, 1);
  const tImp = nPre - 1 + phi; // in frame units
  const gpx = U(0.02, 0.1);
  const pos = (tau) => {
    const m = Math.max(0, tau - tImp);
    return [rest.u + dir[0] * s * m, rest.v + dir[1] * s * m + 0.5 * gpx * m * m];
  };
  const ballFrames = [];
  for (let k = 0; k < n; k++) {
    const tA = k, tB = k + e;
    if (tImp >= tB) { ballFrames.push({ u0: rest.u, v0: rest.v, u1: rest.u, v1: rest.v, r }); continue; }
    const hold = Math.max(0, (tImp - tA) / e);
    const p0 = pos(Math.max(tA, tImp)), p1 = pos(tB);
    if (p0[0] > W + 2 * r + 20 || p0[1] < -2 * r - 20) { ballFrames.push(null); continue; }
    ballFrames.push({ u0: p0[0], v0: p0[1], u1: p1[0], v1: p1[1], r, hold });
  }
  const spec = {
    W, H, nFrames: n, fps: 240, seed,
    bg: { base: o.base ?? U(80, 130), amp: o.amp ?? 1, lines: 2, grain: 2.5 },
    noise: o.noise ?? 4, flicker: o.flicker === undefined ? { gain: 0.03, offset: 2 } : o.flicker, psf: 0.5,
    ball: { level: U(205, 230), shade: o.shade ?? 0.08, frames: ballFrames },
    tee: o.tee ? { len: U(12, 24) * (r / 9), width: U(2, 4), level: U(200, 245), cap: 0 } : null,
    restPos: rest,
    shadow: o.shadow === false ? null : { depth: U(10, 24), untilFrame: Math.floor(tImp) },
    distractor: null, club: null,
    meta: { s, e, phi, tImp, alpha_deg: (alpha * 180) / Math.PI, nVis, aspect: 1 + (e * s) / (2 * r), r },
  };
  if (o.distractor !== false) {
    const rd = r * U(0.8, 1.1);
    const sd = U(10, 28);
    const dirx = rng() < 0.5 ? 1 : -1;
    const vd0 = U(12 + rd, 55), slope = U(-2, 2);
    const fIn = Math.floor(U(nPre - 4, nPre + 4));
    const ed = Math.min(U(0.2, 0.9), ((aspectMax - 1) * 2 * rd) / sd);
    const u0 = dirx > 0 ? -rd - 2 : W + rd + 2;
    const frames = [];
    for (let k = 0; k < n; k++) {
      if (k < fIn) { frames.push(null); continue; }
      const ta = (k - fIn), tb = ta + ed;
      const ua = u0 + dirx * sd * ta, ub = u0 + dirx * sd * tb;
      if (ua < -3 * rd - 30 || ua > W + 3 * rd + 30) { frames.push(null); continue; }
      frames.push({ u0: ua, v0: vd0 + slope * ta, u1: ub, v1: vd0 + slope * tb, r: rd });
    }
    spec.distractor = { level: U(190, 225), shade: 0.05, frames };
  }
  if (o.club !== false) {
    const a = U(2.0, 2.4) * r, b = U(0.8, 1.0) * r;
    const Rarc = U(300, 450);
    const vc = s / U(1.3, 1.5);
    const Pc = [rest.u - (r + 0.9 * a), rest.v + 0.3 * r];
    const Cc = [Pc[0], Pc[1] - Rarc];
    const club = [];
    const cpos = (tau) => {
      const psi = ((tau - tImp) * vc) / Rarc;
      return { p: [Cc[0] + Rarc * Math.sin(psi), Cc[1] + Rarc * Math.cos(psi)], ang: -psi, psi };
    };
    for (let k = 0; k < n; k++) {
      const A = cpos(k), B = cpos(k + e);
      const visible = (q) => q.p[0] > -60 && q.p[0] < W + 60 && q.p[1] > -60 && q.p[1] < H + 60;
      if (!visible(A) && !visible(B)) { club.push(null); continue; }
      // shaft direction: from the head towards the arc centre (the pivot)
      const sa = Math.atan2(Cc[1] - A.p[1], Cc[0] - A.p[0]);
      club.push({ u0: A.p[0], v0: A.p[1], u1: B.p[0], v1: B.p[1], a, b, ang: A.ang, shaftAng: sa });
    }
    spec.club = { level: rng() < 0.5 ? U(35, 60) : U(165, 190), frames: club, shaft: { len: 90, w: 2.5 } };
    spec.meta.club = { a, b, vc, Rarc };
  }
  return spec;
}
