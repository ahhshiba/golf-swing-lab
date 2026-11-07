// course/validate.js — geometric course rules (V04-SPEC §C.2). Lazy, pure (course/detmath.js arithmetic rule).
// Owner V4-C. (The record shape is checked by contract/round.js validateRound.)
//
//   validateCourse(course) -> { ok, problems: [{ hole: n|null, rule, detail }] }
//   rules: par_mix (course: 18 = 4/10/4, 9 = 2/5/2), par_length (middle tees: par 3 90–200, par 4 250–420,
//     par 5 420–530 m along the centre line), green_water (green ≥ 1 m from every water polygon), pin_edge (pin on the
//     green, ≥ 3 m from its edge), landing_zone (par 4/5: a centre-line station 160–240 m from the middle tee —
//     REFERENCE_CARRY_M.driver ± 20 % — where the fairway is ≥ 25 m wide across the line; a par 3 has none),
//     hazard_centerline (water + bunkers cover ≤ 35 % of the centre line, 1 m samples), self_intersection (no
//     polygon crosses itself), tee_lie (no tee in water, a bunker or OB).

import { PAR_PLAN } from './generate.js';
import { inPoly, lieAt, dist, polySelfIntersects, nearestOnPoly, polylineLength, pointAlong, segHit } from './model.js';

export const PAR_LENGTHS = Object.freeze({ 3: Object.freeze([90, 200]), 4: Object.freeze([250, 420]), 5: Object.freeze([420, 530]) });
export const LANDING = Object.freeze({ from_m: 160, to_m: 240, step_m: 5, min_width_m: 25 });
export const HAZARD_MAX_FRAC = 0.35;
export const PIN_EDGE_MIN_M = 3;
export const GREEN_WATER_MIN_M = 1;

/** Middle-tee length along the centre line (the centre line starts at, or on the line through, the middle tee). */
export function middleLength(hole) {
  const cl = hole.centerline;
  const [mx, my] = hole.tees.middle;
  return dist(mx, my, cl[1][0], cl[1][1]) + polylineLength(cl.slice(1));
}

/** Width of the fairway interval through (px, py) across direction (nx, ny); 0 when the point is off the fairway. */
export function fairwayWidthAt(fairways, px, py, nx, ny) {
  let best = 0;
  for (const poly of fairways) {
    if (!inPoly(poly, px, py)) continue;
    const ts = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0] - px, ay = poly[j][1] - py, bx = poly[i][0] - px, by = poly[i][1] - py;
      // signed distance of each end from the line through P along n: d = cross(n, v)
      const da = nx * ay - ny * ax, db = nx * by - ny * bx;
      if ((da > 0) === (db > 0) || da === db) continue;
      const t = da / (da - db);
      const ix = ax + (bx - ax) * t, iy = ay + (by - ay) * t;
      ts.push(ix * nx + iy * ny);
    }
    ts.sort((p, q) => p - q);
    let lo = -Infinity, hi = Infinity;
    for (const t of ts) {
      if (t <= 0 && t > lo) lo = t;
      if (t >= 0 && t < hi) hi = t;
    }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi - lo > best) best = hi - lo;
  }
  return best;
}

function polyGap(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) if (segHit(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return 0;
  }
  if (inPoly(a, b[0][0], b[0][1]) || inPoly(b, a[0][0], a[0][1])) return 0;
  let d = Infinity;
  for (const [x, y] of a) d = Math.min(d, nearestOnPoly(b, x, y).d);
  for (const [x, y] of b) d = Math.min(d, nearestOnPoly(a, x, y).d);
  return d;
}

function checkHole(h, push) {
  const L = middleLength(h);
  const [lo, hi] = PAR_LENGTHS[h.par] ?? [0, 0];
  if (!(L >= lo && L <= hi)) push('par_length', `par ${h.par} middle length ${L.toFixed(1)} m outside ${lo}–${hi} m`);

  for (const w of h.water) {
    const g = polyGap(h.green.poly, w);
    if (g < GREEN_WATER_MIN_M) push('green_water', `green ${g.toFixed(2)} m from water (< ${GREEN_WATER_MIN_M} m)`);
  }

  const [px, py] = h.pin;
  const edge = nearestOnPoly(h.green.poly, px, py).d;
  if (!inPoly(h.green.poly, px, py) || edge < PIN_EDGE_MIN_M) push('pin_edge', `pin ${inPoly(h.green.poly, px, py) ? `${edge.toFixed(2)} m from the green edge` : 'off the green'}`);

  const cl = [h.tees.middle.slice(0, 2), ...h.centerline.slice(1)];
  const Lc = polylineLength(cl);
  if (h.par >= 4) {
    let widest = 0;
    for (let s = LANDING.from_m; s <= LANDING.to_m && s < Lc; s += LANDING.step_m) {
      const p = pointAlong(cl, s);
      widest = Math.max(widest, fairwayWidthAt(h.fairway, p.x, p.y, p.uy, -p.ux));
    }
    if (widest < LANDING.min_width_m) push('landing_zone', `widest fairway across the line at ${LANDING.from_m}–${LANDING.to_m} m is ${widest.toFixed(1)} m (< ${LANDING.min_width_m} m)`);
  }

  let n = 0, hit = 0;
  const hazards = [...h.water, ...h.bunkers];
  for (let s = 0; s <= Lc; s += 1) {
    const p = pointAlong(cl, s);
    n++;
    for (const poly of hazards) if (inPoly(poly, p.x, p.y)) { hit++; break; }
  }
  if (n && hit / n > HAZARD_MAX_FRAC) push('hazard_centerline', `hazards cover ${((100 * hit) / n).toFixed(1)} % of the centre line (> ${HAZARD_MAX_FRAC * 100} %)`);

  const polys = [['green', h.green.poly], ['bounds', h.bounds], ...h.fairway.map((p, i) => [`fairway.${i}`, p]),
    ...h.bunkers.map((p, i) => [`bunkers.${i}`, p]), ...h.water.map((p, i) => [`water.${i}`, p])];
  for (const [name, p] of polys) if (polySelfIntersects(p)) push('self_intersection', `${name} crosses itself`);

  for (const t of ['forward', 'middle', 'back']) {
    const lie = lieAt(h, h.tees[t][0], h.tees[t][1]);
    if (lie === 'water' || lie === 'bunker' || lie === 'ob') push('tee_lie', `${t} tee is in ${lie}`);
  }
}

/**
 * @param {import('./generate.js').Course} course
 * @returns {{ ok: boolean, problems: Array<{ hole: number|null, rule: string, detail: string }> }}
 */
export function validateCourse(course) {
  const problems = [];
  const holes = Array.isArray(course?.holes) ? course.holes : [];
  const plan = PAR_PLAN[course?.holes_n];
  const count = { 3: 0, 4: 0, 5: 0 };
  for (const h of holes) count[h.par] = (count[h.par] ?? 0) + 1;
  if (!plan || holes.length !== course.holes_n || [3, 4, 5].some((p) => count[p] !== plan[p])) {
    problems.push({ hole: null, rule: 'par_mix', detail: `par 3/4/5 = ${count[3]}/${count[4]}/${count[5]} for ${holes.length} holes` });
  }
  for (const h of holes) checkHole(h, (rule, detail) => problems.push({ hole: h.n, rule, detail }));
  return { ok: problems.length === 0, problems };
}
