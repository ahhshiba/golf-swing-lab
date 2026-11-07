// course/detmath.js — engine-independent arithmetic for the course generator and the hole geometry (V04-SPEC §C.2).
// The built-in transcendental functions (sine, cosine, exponential …) are not required to be bit-identical across V8 and JavaScriptCore, so
// course/** uses only + − × ÷ and sqrt (IEEE-754 correctly rounded everywhere) plus the polynomials below, and
// quantises every output coordinate to 0.1 m. Lazy, pure.
//
//   PI, TAU, deg2rad(d)       dsin(x), dcos(x)  (radians; |error| < 1e-13 on any finite x)
//   q1(x) 0.1 m quantisation (never −0)   q2(x) 0.01   clamp(x, lo, hi)   lerp(a, b, t)
//   rngOf(seed) → () => [0, 1) (mulberry32, integer ops only)   mix32(a, b) → uint32   range(rng, [lo, hi])
//   pick(rng, list)   shuffle(rng, list)

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

export const deg2rad = (d) => (d * PI) / 180;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Round half away from zero to a step (1 / k); never returns −0. */
function quant(x, k) {
  const y = x * k;
  const r = y < 0 ? -Math.floor(-y + 0.5) : Math.floor(y + 0.5);
  return r === 0 ? 0 : r / k;
}
export const q1 = (x) => quant(x, 10);
export const q2 = (x) => quant(x, 100);

/** Taylor series of sin on [−π/2, π/2] (terms up to x^19; truncation < 1e-15). */
function sinPoly(x) {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let k = 1; k <= 9; k++) {
    term = (-term * x2) / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

/** sin(x) with arithmetic-only range reduction to [−π/2, π/2]. */
export function dsin(x) {
  if (!Number.isFinite(x)) return NaN;
  let r = x - TAU * Math.floor(x / TAU + 0.5); // [−π, π]
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinPoly(r);
}
export const dcos = (x) => dsin(x + HALF_PI);

/** 32-bit mixing of two integers (murmur3 finaliser on a ^ b·φ). */
export function mix32(a, b = 0) {
  let h = (a >>> 0) ^ Math.imul((b >>> 0) + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 (same sequence as geom/rng.js), integer ops only. */
export function rngOf(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();
export const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
export function shuffle(rng, list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
