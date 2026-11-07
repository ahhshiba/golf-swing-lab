// course/generate.js — seeded, engine-independent course generator (V04-SPEC §C.2). Lazy, pure. Owner V4-C.
// Only + − × ÷ sqrt, the course/detmath.js polynomials and integer PRNG ops; every coordinate quantised to 0.1 m, so
// the same { seed, style, holes, tees } gives a byte-identical course in every JS engine (golden:
// tests/fixtures/v4/course-golden.json). A round stores the whole geometry snapshot, so changing this generator
// (bump COURSE_GENERATOR) never alters an old round.
//
//   generateCourse({ seed, style: 'parkland'|'links'|'desert'|'mixed', holes: 9|18, tees }) -> Course
//   courseCanonical(course) -> string   canonical JSON (sorted keys) — sha256 of it is the golden / cross-engine check
//   PAR_PLAN  { 18: { 3: 4, 4: 10, 5: 4 } (par 72), 9: { 3: 2, 4: 5, 5: 2 } }   TEE_FACTORS { forward .85, middle 1, back 1.12 }
//
// Hole frame: the middle tee at (0, 0), the hole plays toward +y (x east, y north, metres); one optional dogleg at
// the corner. All styles and templates are original (course/styles.js).

import { STYLES, STYLE_IDS } from './styles.js';
import { dsin, dcos, deg2rad, q1, mix32, rngOf, range, shuffle, clamp } from './detmath.js';
import { inPoly, bbox, polylineLength, pointAlong, elevationAt } from './model.js';

/** Generator version written into golf-round/1 course.generator (a round stores the whole geometry snapshot). */
export const COURSE_GENERATOR = 'course-1';
export const PAR_PLAN = Object.freeze({ 18: Object.freeze({ 3: 4, 4: 10, 5: 4 }), 9: Object.freeze({ 3: 2, 4: 5, 5: 2 }) });
export const TEE_FACTORS = Object.freeze({ forward: 0.85, middle: 1, back: 1.12 });
const TEE_IDS = ['forward', 'middle', 'back'];

const C45 = 0.7071067811865476;
/** Greenside bunker positions: [along (− = toward the tee), across (− = left)] unit directions. */
const GREEN_POS = Object.freeze({ F: [-1, 0], FL: [-C45, -C45], FR: [-C45, C45], L: [0, -1], R: [0, 1], B: [1, 0] });

const qp = (x, y) => [q1(x), q1(y)];

/** Centre-line frame at arc length s: point, unit direction u, right normal n = (uy, −ux). */
function frame(cl, s) {
  const p = pointAlong(cl, s);
  return { x: p.x, y: p.y, ux: p.ux, uy: p.uy, nx: p.uy, ny: -p.ux };
}

/**
 * A band polygon between lateral offsets lo(s) < hi(s) (right = +) for s in [s0, s1] along a one-corner centre line,
 * with an optional cap tip at each end. Stations near the corner are replaced by a mitred corner point.
 */
function ribbon(geo, s0, s1, lo, hi, { stations = 4, caps = 0 } = {}) {
  const { cl, a, cosHalf, tanHalf } = geo;
  const maxOff = Math.max(Math.abs(lo(s0)), Math.abs(hi(s0)), Math.abs(lo(s1)), Math.abs(hi(s1)));
  const skip = maxOff * tanHalf + 6;
  const ss = [];
  const k = Math.max(1, stations);
  for (let i = 0; i <= k; i++) {
    const s = s0 + ((s1 - s0) * i) / k;
    if (i > 0 && i < k && Math.abs(s - a) < skip) continue;
    ss.push(s);
  }
  if (s0 < a - skip && a + skip < s1 && tanHalf > 0) {
    ss.push(a);
    ss.sort((p, q) => p - q);
  }
  const at = (s, off) => {
    if (s === a && tanHalf > 0) {
      // mitre: bisector of the two segment normals, length off / cos(θ/2)
      const f1 = frame(cl, a - 1), f2 = frame(cl, a + 1);
      let mx = f1.nx + f2.nx, my = f1.ny + f2.ny;
      const m = Math.sqrt(mx * mx + my * my);
      mx /= m; my /= m;
      const c = cl[1];
      return [c[0] + (mx * off) / cosHalf, c[1] + (my * off) / cosHalf];
    }
    const f = frame(cl, s);
    return [f.x + f.nx * off, f.y + f.ny * off];
  };
  const right = ss.map((s) => at(s, hi(s)));
  const left = ss.map((s) => at(s, lo(s))).reverse();
  const pts = [...right];
  if (caps) {
    const f = frame(cl, s1);
    const mid = (lo(s1) + hi(s1)) / 2;
    pts.push([f.x + f.nx * mid + f.ux * caps, f.y + f.ny * mid + f.uy * caps]);
  }
  pts.push(...left);
  if (caps) {
    const f = frame(cl, s0);
    const mid = (lo(s0) + hi(s0)) / 2;
    pts.push([f.x + f.nx * mid - f.ux * caps, f.y + f.ny * mid - f.uy * caps]);
  }
  return pts.map(([x, y]) => qp(x, y));
}

/** Jittered ellipse of k points around (cx, cy), semi-axes ra along (ux, uy) and rb across. */
function blob(rng, cx, cy, ux, uy, ra, rb, k, jitter) {
  const nx = uy, ny = -ux;
  const pts = [];
  for (let i = 0; i < k; i++) {
    const ang = deg2rad((360 * i) / k);
    const j = 1 + jitter * (2 * rng() - 1);
    const ca = dcos(ang) * ra * j, sb = dsin(ang) * rb * j;
    pts.push(qp(cx + ux * ca + nx * sb, cy + uy * ca + ny * sb));
  }
  return pts;
}

function makeHole(n, style, tpl, rng, tees) {
  const L = q1(range(rng, tpl.len));
  const theta = tpl.dogleg[1] > 0 ? range(rng, tpl.dogleg) * (rng() < 0.5 ? -1 : 1) : 0;
  const a = q1(L * range(rng, tpl.corner));
  const tr = deg2rad(theta);
  const d2x = dsin(tr), d2y = dcos(tr);
  const pinX = q1(d2x * (L - a)), pinY = q1(a + d2y * (L - a));
  const cl = [[0, 0], [0, a], [pinX, pinY]];
  const half = Math.abs(tr) / 2;
  const cosHalf = dcos(half);
  const tanHalf = dsin(half) / cosHalf;
  const geo = { cl, a, cosHalf, tanHalf };
  const Lc = polylineLength(cl); // middle tee → pin along the centre line (≈ L after quantisation)
  const nRx = d2y, nRy = -d2x; // right normal of the second segment

  // green: centre offset from the pin so that the pin sits ≥ 3 m inside the edge
  const rx = range(rng, tpl.green.rx), ry = range(rng, tpl.green.ry);
  const ox = clamp((2 * rng() - 1) * 0.25 * rx, -3.5, 3.5), oy = clamp((2 * rng() - 1) * 0.25 * ry, -3.5, 3.5);
  const gx = pinX - d2x * oy - nRx * ox, gy = pinY - d2y * oy - nRy * ox;
  const green = { poly: blob(rng, gx, gy, d2x, d2y, ry, rx, 12, 0.05), z: 0, slope_pct: q1(range(rng, tpl.green.slope)) };
  const sG = Lc - oy; // arc length of the green centre (approx.)

  // bounds corridor
  const fwHalf = range(rng, tpl.fw.half);
  let B = range(rng, tpl.bound);
  const water = [];
  const bunkers = [];
  const waterSpecs = tpl.water.map((w) => {
    if (w.kind === 'side') {
      const sd = w.side === 'L' ? -1 : w.side === 'R' ? 1 : (rng() < 0.5 ? -1 : 1);
      const s = [L * w.s[0], L * w.s[1]], gap = range(rng, w.gap), width = range(rng, w.width);
      B = Math.max(B, fwHalf + gap + width + 6);
      return { ...w, sd, sRange: s, gap, width };
    }
    if (w.kind === 'cross') return { ...w, sc: L * range(rng, w.s), depth: range(rng, w.depth) };
    return { ...w, gap: range(rng, w.gap), depth: range(rng, w.depth), wide: range(rng, w.wide) };
  });
  const sBack = -L * (TEE_FACTORS.back - 1) - 15;
  const sEnd = sG + ry + 25;
  const bounds = ribbon(geo, sBack, sEnd, () => -B, () => B, { stations: 1 });

  // fairway(s)
  const sFw0 = L * (1 - TEE_FACTORS.forward) + 15;
  const fairway = [];
  const sOf = (v) => (v < 0 ? Lc + v : v >= 1 ? v : L * v);
  let spans;
  if (tpl.fw.apron) spans = [[sG - ry - 22, sG - ry + 2]];
  else if (tpl.fw.islands) spans = tpl.fw.islands.map(([f, t]) => [sOf(f), sOf(t)]);
  else spans = [[sFw0, sG - 8]]; // runs into the green front
  let prevEnd = -Infinity;
  for (let [s0, s1] of spans) {
    if (s0 < prevEnd + 8) s0 = prevEnd + 8;
    if (s1 - s0 < 15) continue;
    const w = tpl.fw.apron ? Math.min(fwHalf, rx * 0.9) : fwHalf;
    const k = clamp(Math.floor((s1 - s0) / 45), 1, 9);
    const jit = Array.from({ length: k + 1 }, () => 0.94 + 0.12 * rng());
    const wAt = (s) => w * jit[clamp(Math.floor(((s - s0) / (s1 - s0)) * k + 0.5), 0, k)];
    fairway.push(ribbon(geo, s0, s1, (s) => -wAt(s), (s) => wAt(s), { stations: k, caps: w * 0.35 }));
    prevEnd = s1;
  }

  // water
  for (const w of waterSpecs) {
    if (w.kind === 'side') {
      const inner = fwHalf + w.gap, outer = inner + w.width;
      const lo = w.sd < 0 ? () => -outer : () => inner;
      const hi = w.sd < 0 ? () => -inner : () => outer;
      water.push(ribbon(geo, w.sRange[0], w.sRange[1], lo, hi, { stations: 3, caps: w.width * 0.3 }));
    } else if (w.kind === 'cross') {
      let sc = w.sc;
      const clear = (B - 3) * tanHalf + 10;
      if (Math.abs(sc - a) < w.depth + clear) sc = a + w.depth + clear;
      const lim = B - 3;
      water.push(ribbon(geo, sc, sc + w.depth, () => -lim, () => lim, { stations: 2 }));
    } else {
      const s1 = sG - ry * 1.06 - w.gap, s0 = s1 - w.depth;
      water.push(ribbon(geo, s0, s1, () => -w.wide, () => w.wide, { stations: 2, caps: w.depth * 0.25 }));
    }
  }

  // bunkers
  const waterSides = waterSpecs.filter((w) => w.kind === 'side').map((w) => w.sd);
  for (const b of tpl.bunkers) {
    const r = range(rng, b.r);
    if (b.at === 'fw') {
      let sd = b.side === 'L' ? -1 : b.side === 'R' ? 1 : (rng() < 0.5 ? -1 : 1);
      if (b.side === 'any' && waterSides.includes(sd)) sd = -sd;
      const s = L * range(rng, b.s);
      const f = frame(cl, s);
      const off = sd * (fwHalf + r * 0.25);
      bunkers.push(blob(rng, f.x + f.nx * off, f.y + f.ny * off, f.ux, f.uy, r * 1.4, r, 8, 0.08));
    } else {
      const [al, ac] = GREEN_POS[b.pos];
      const da = al * (ry + r + 1.5), dc = ac * (rx + r + 1.5);
      const cx = gx + d2x * da + nRx * dc, cy = gy + d2y * da + nRy * dc;
      bunkers.push(blob(rng, cx, cy, d2x, d2y, r, r * 1.3, 8, 0.08));
    }
  }

  // trees
  const trees = [];
  const blocked = [...fairway, ...bunkers, ...water, green.poly];
  const boxes = blocked.map(bbox);
  const free = (x, y, r) => {
    if (!inPoly(bounds, x - r, y) || !inPoly(bounds, x + r, y) || !inPoly(bounds, x, y - r) || !inPoly(bounds, x, y + r)) return false;
    for (let i = 0; i < blocked.length; i++) {
      const b = boxes[i];
      if (x + r + 1 < b[0] || x - r - 1 > b[2] || y + r + 1 < b[1] || y - r - 1 > b[3]) continue;
      for (const [px, py] of [[x, y], [x - r, y], [x + r, y], [x, y - r], [x, y + r]]) if (inPoly(blocked[i], px, py)) return false;
    }
    if (x * x + y * y < 400) return false; // keep the tee area clear
    return true;
  };
  const tz = tpl.trees;
  if (tz && tz.kind === 'rows') {
    const gap = range(rng, tz.gap);
    for (const sd of [-1, 1]) {
      let s = 15 + 10 * rng();
      while (s < sG + ry && trees.length < 60) {
        const r = range(rng, tz.r), h = range(rng, tz.h);
        const off = sd * (fwHalf + gap + r + 2 * (2 * rng() - 1));
        const f = frame(cl, s);
        const x = f.x + f.nx * off, y = f.y + f.ny * off;
        if (free(x, y, r)) trees.push([q1(x), q1(y), q1(r), q1(h)]);
        s += range(rng, tz.spacing);
      }
    }
  } else if (tz && tz.kind === 'scatter') {
    const want = Math.floor(range(rng, [tz.n[0], tz.n[1] + 1]));
    for (let tries = 0; tries < want * 4 && trees.length < want; tries++) {
      const s = 20 + (sG - 20) * rng();
      const sd = rng() < 0.5 ? -1 : 1;
      const r = range(rng, tz.r), h = range(rng, tz.h);
      const off = sd * (fwHalf + 5 + (B - fwHalf - 12) * rng());
      const f = frame(cl, s);
      const x = f.x + f.nx * off, y = f.y + f.ny * off;
      if (free(x, y, r)) trees.push([q1(x), q1(y), q1(r), q1(h)]);
    }
  }

  const greenZ = q1(range(rng, tpl.green.z));
  green.z = greenZ;
  const hole = {
    n, par: tpl.par, style, template: tpl.id, length_m: 0,
    tees: { forward: [0, q1(L * (1 - TEE_FACTORS.forward)), 0], middle: [0, 0, 0], back: [0, q1(-L * (TEE_FACTORS.back - 1)), 0] },
    pin: [pinX, pinY], green, fairway, bunkers, water, trees, bounds, centerline: cl, elevation: { tee_z: 0, green_z: greenZ },
  };
  for (const t of TEE_IDS) hole.tees[t][2] = q1(elevationAt(hole, hole.tees[t][0], hole.tees[t][1]));
  hole.length_m = q1(polylineLength(cl) * TEE_FACTORS[tees]);
  return hole;
}

/**
 * @typedef {object} Course  golf-round/1 `course`: { generator, style, seed, holes_n, tees, holes: Hole[] }
 * @param {{ seed: number, style: 'parkland'|'links'|'desert'|'mixed', holes: 9|18, tees: 'forward'|'middle'|'back' }} opts
 *   seed: uint32. 18 holes = 4 × par 3 + 10 × par 4 + 4 × par 5 (par 72); 9 holes = 2 / 5 / 2.
 * @returns {Course}
 */
export function generateCourse({ seed, style: styleOpt, holes = 18, tees = 'middle' } = {}) {
  const style = styleOpt ?? 'mixed';
  if (!(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) throw new RangeError('generateCourse: seed must be a uint32');
  if (!(style === 'mixed' || STYLE_IDS.includes(style))) throw new RangeError(`generateCourse: unknown style ${style}`);
  if (holes !== 9 && holes !== 18) throw new RangeError('generateCourse: holes must be 9 or 18');
  if (!TEE_IDS.includes(tees)) throw new RangeError(`generateCourse: unknown tees ${tees}`);
  const rng = rngOf(mix32(seed, 0x636f7572));
  const plan = PAR_PLAN[holes];
  const pars = shuffle(rng, [...Array(plan[3]).fill(3), ...Array(plan[4]).fill(4), ...Array(plan[5]).fill(5)]);
  const cycles = new Map(); // style → par → shuffled template cycle
  const nextTpl = (st, par) => {
    const key = `${st}/${par}`;
    let c = cycles.get(key);
    if (!c || c.i >= c.list.length) {
      c = { list: shuffle(rng, STYLES[st].filter((t) => t.par === par)), i: 0 };
      cycles.set(key, c);
    }
    return c.list[c.i++];
  };
  const out = [];
  for (let i = 0; i < holes; i++) {
    const st = style === 'mixed' ? STYLE_IDS[Math.floor(rng() * 3) % 3] : style;
    const tpl = nextTpl(st, pars[i]);
    out.push(makeHole(i + 1, st, tpl, rngOf(mix32(seed, i + 1)), tees));
  }
  return { generator: COURSE_GENERATOR, style, seed, holes_n: holes, tees, holes: out };
}

/** Canonical JSON (object keys sorted, arrays in order) — what the golden sha256 is taken over. */
export function courseCanonical(v) {
  if (Array.isArray(v)) return `[${v.map(courseCanonical).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${courseCanonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
