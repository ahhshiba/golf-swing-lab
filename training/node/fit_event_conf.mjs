#!/usr/bin/env node
// training/node/fit_event_conf.mjs — fit the per-event logistic confidence map of the rule-based events
// (PRODUCT-SPEC §7.2 EV-4) and write app/src/events/calib-conf.json + its ES-module mirror calib-conf.js.
// Data: the synthetic stress suite on seeds 41–80 (the reliability check, scripts/check_event_conf.mjs, uses seeds
// 1–40) at 60 and 240 Hz, plus the owner tune split of a golf-swing-lab-labels/1 file (default: the synthetic-derived
// fixture tests/fixtures/owner/labels-fixture.json until real owner labels exist). GolfDB is never read.
//
//   node training/node/fit_event_conf.mjs [--owner FILE] [--quick]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS } from '../../app/src/contract/enums.js';
import { CONF_FEATURES } from '../../app/src/events/rules.js';
import { syntheticSamples, ownerSamples, mergeSamples, CONF_TOL_S } from './event_conf_data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CALIB_JSON = path.join(ROOT, 'app', 'src', 'events', 'calib-conf.json');
export const CALIB_JS = path.join(ROOT, 'app', 'src', 'events', 'calib-conf.js');
const LAMBDA = 1.0; // L2 penalty on every weight (the bias gets 1e-3)
const CLIP = [0.02, 0.98];

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

/** L2-penalised logistic regression (damped Newton with backtracking on the penalised log-likelihood). */
export function fitLogistic(X, y, lambda = LAMBDA, iters = 60) {
  const d = X[0].length;
  const lam = (a) => (a === 0 ? 1e-3 : lambda);
  const pos = y.reduce((s, v) => s + v, 0) / Math.max(1, y.length);
  let w = new Array(d).fill(0);
  w[0] = Math.log((pos + 0.01) / (1 - pos + 0.01));
  const objective = (wv) => {
    let f = 0;
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, v, k) => s + v * wv[k], 0);
      f += y[i] ? Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
    }
    for (let a = 0; a < d; a++) f += 0.5 * lam(a) * wv[a] * wv[a];
    return f;
  };
  let fw = objective(w);
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    const g = new Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, v, k) => s + v * w[k], 0);
      const p = 1 / (1 + Math.exp(-z));
      const r = y[i] - p;
      const q = Math.max(1e-9, p * (1 - p));
      for (let a = 0; a < d; a++) {
        g[a] += r * X[i][a];
        for (let b = a; b < d; b++) H[a][b] += q * X[i][a] * X[i][b];
      }
    }
    for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    for (let a = 0; a < d; a++) { H[a][a] += lam(a); g[a] -= lam(a) * w[a]; }
    const step = solve(H, g);
    let t = 1;
    let next = null;
    for (let ls = 0; ls < 30; ls++) {
      const cand = w.map((v, k) => v + t * step[k]);
      const fc = objective(cand);
      if (Number.isFinite(fc) && fc <= fw) { next = { cand, fc }; break; }
      t /= 2;
    }
    if (!next) break;
    const moved = Math.max(...step.map((v) => Math.abs(t * v)));
    w = next.cand;
    fw = next.fc;
    if (moved < 1e-7) break;
  }
  return w.map((v) => Math.round(v * 1e6) / 1e6);
}

/**
 * Isotonic second stage (pool-adjacent-violators) of the logistic output p on the fit data, blocks of at least
 * `minN` samples; returns knots [[p_min, p_max, rate], ...] per block, increasing in p and rate.
 */
export function isotonicKnots(p, y, minN = 200) {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  let blocks = [];
  // start from consecutive chunks of minN samples so every knot rests on enough data
  for (let i = 0; i < idx.length; i += minN) {
    const part = idx.slice(i, i + minN);
    const b = { n: part.length, lo: p[part[0]], hi: p[part[part.length - 1]], sy: part.reduce((s, k) => s + y[k], 0) };
    if (b.n < minN && blocks.length) { const l = blocks[blocks.length - 1]; l.n += b.n; l.hi = b.hi; l.sy += b.sy; } else blocks.push(b);
  }
  let merged = true;
  while (merged) {
    merged = false;
    const out = [];
    for (const b of blocks) {
      out.push({ ...b });
      while (out.length > 1 && out[out.length - 2].sy / out[out.length - 2].n >= out[out.length - 1].sy / out[out.length - 1].n) {
        const l = out.pop();
        const m = out[out.length - 1];
        m.n += l.n; m.hi = l.hi; m.sy += l.sy;
        merged = true;
      }
    }
    blocks = out;
  }
  const r = (x) => Math.round(x * 1e6) / 1e6;
  return blocks.map((b) => [r(b.lo), r(b.hi), r(b.sy / b.n)]);
}

export function writeCalib(calib) {
  fs.writeFileSync(CALIB_JSON, JSON.stringify(calib, null, 2) + '\n');
  fs.writeFileSync(CALIB_JS, `// Generated by training/node/fit_event_conf.mjs from calib-conf.json (same content) — do not edit by hand.\n// Kept as an ES module so the browser and Node load it without JSON import attributes.\nexport const CONF_CALIB = Object.freeze(${JSON.stringify(calib)});\n`);
}

function main() {
  const quick = process.argv.includes('--quick');
  const oi = process.argv.indexOf('--owner');
  const ownerFile = oi > 0 ? process.argv[oi + 1] : path.join(ROOT, 'tests', 'fixtures', 'owner', 'labels-fixture.json');
  const syn = syntheticSamples({ seeds: quick ? [41, 50] : [41, 80] });
  const own = fs.existsSync(ownerFile) ? ownerSamples(ownerFile, { split: 'tune' }) : { acc: null, n: 0 };
  const data = own.acc ? mergeSamples(syn, own.acc) : syn;
  const events = {};
  for (const e of EVENTS) {
    const { X, y } = data[e];
    const w = fitLogistic(X, y);
    const p = X.map((x) => 1 / (1 + Math.exp(-x.reduce((s2, v, k) => s2 + v * w[k], 0))));
    const iso = isotonicKnots(p, y);
    events[e] = { w, iso, n: y.length, within_tol_rate: Math.round((1e4 * y.reduce((s, v) => s + v, 0)) / Math.max(1, y.length)) / 1e4 };
    console.log(`${e.padEnd(19)} n=${y.length} within-tol ${(100 * events[e].within_tol_rate).toFixed(1)}%  w=${JSON.stringify(w)}`);
  }
  const calib = {
    schema: 'gsl-event-conf/1',
    version: 'conf-2',
    method: 'logistic map of the detector features, then an isotonic (PAV) step function (nearest block); conf = clip(iso(σ(w·x)))',
    fitted_on: own.n ? ['synthetic-v2', 'owner-tune'] : ['synthetic-v2'],
    synthetic: { generator: 'tests/synth/swing.js stressSwing (synthetic-v2)', seeds: quick ? [41, 50] : [41, 80], rates_hz: [60, 240] },
    owner_tune: own.n ? { file: path.relative(ROOT, ownerFile), swings: own.n, note: 'session-wise tune split (scripts/eval_owner_set.mjs splitBySession, tune_frac 0.2)' } : null,
    golfdb: false,
    tolerance_s: CONF_TOL_S,
    features: CONF_FEATURES,
    clip: CLIP,
    lambda: LAMBDA,
    iso_min_block: 200,
    events,
  };
  writeCalib(calib);
  console.log(`wrote ${path.relative(ROOT, CALIB_JSON)} and ${path.relative(ROOT, CALIB_JS)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
