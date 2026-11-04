// Seeded pseudo-random numbers. Pure modules never use a global PRNG; callers pass rng = mulberry32(seed).

/**
 * mulberry32 PRNG. Returns a function producing uniform numbers in [0, 1).
 * The seed is coerced to an unsigned 32-bit integer; equal seeds give identical sequences.
 */
export function mulberry32(seed) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new TypeError('mulberry32: seed must be a finite number');
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal deviate N(mean, sd²) by Box–Muller; consumes exactly two rng() draws per call. */
export function gauss(rng, mean = 0, sd = 1) {
  const u1 = 1 - rng(); // (0, 1], log is finite
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Uniform deviate in [lo, hi). */
export function uniform(rng, lo = 0, hi = 1) {
  return lo + (hi - lo) * rng();
}
