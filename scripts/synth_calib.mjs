#!/usr/bin/env node
// M2b machine gate (CAFCR R6 "M2b 校正與架設重現", verify.sh stage synthetic-calib).
//
// Synthetic mats with Gaussian corner noise, true cameras = interfaces.md §5 nominal ± C2/C3 tolerances.
//   GATES (face_on, mat only — no gravity prior, as in the CAFCR C1.1 budget; f locked to truth):
//     1 px: P95 |yaw err| ≤ 0.25°, P95 |roll err| ≤ 0.2°, P95 |D err| ≤ 10 mm
//     3 px: P95 |yaw err| ≤ 0.7°,  P95 |roll err| ≤ 0.6°, P95 |D err| ≤ 25 mm
//     f free at 1 px: SD of (f − f_true)/f_true ≤ 1 %
//     honest sigma: |err| ≤ 1.96·σ_reported for 85–99 % of trials (yaw, roll, D; 1 px and 3 px)
//     ladder: with 2 corners hidden the method is auto-selected (club_line with a club + gravity, else ball_only)
//             in every trial and the median yaw sigma grows mat_pnp < club_line < ball_only
//     framesBudget reproduces CAFCR C1.1 (12.0 / 7.4 / 6.1 at 40/60/70 m/s, driver 75 m/s 5.6; ±0.15)
//     drop test (K11): noiseless g within 1 %; ±5 % scale errors fail, 0 % passes
//   INFO (flag only): dtl and high_behind statistics vs the sigmas quoted in CAFCR C1.2 / C1.3, face_on over the
//   full C2 range (D 2.7–3.0 m), with the gravity prior.
// Usage: node scripts/synth_calib.mjs [--seed N] [--trials N]. Exit code = number of failed gates.

import { mulberry32, gauss } from '../app/src/geom/rng.js';
import { percentile, std, median } from '../app/src/geom/stats.js';
import { G } from '../app/src/geom/constants.js';
import { nominalCamera } from '../app/src/geom/camera.js';
import { solveMatPose } from '../app/src/calib/pnp.js';
import { calibrate } from '../app/src/calib/ladder.js';
import { framesBudget } from '../app/src/calib/ballspot.js';
import { dropTest } from '../app/src/calib/droptest.js';
import { synthMatScene, synthClub, synthBall, synthDrop, scaledCamera } from '../tests/synth/mat.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v)) { console.error(`synth_calib: --${name} needs a number`); process.exit(64); }
  return v;
}
const SEED = arg('seed', 20261104) >>> 0;
const TRIALS = Math.max(500, arg('trials', 500));
console.log(`synth_calib: seed ${SEED}, ${TRIALS} trials per cell (rerun with --seed ${SEED} to reproduce)`);

const rows = [];
let failed = 0;
function gate(name, value, limitText, ok, unit = '') {
  rows.push({ kind: 'GATE', name, value, unit, limit: limitText, status: ok ? 'PASS' : 'FAIL' });
  if (!ok) failed++;
}
function info(name, value, limitText, flag, unit = '', note = '', why = '') {
  rows.push({ kind: 'INFO', name, value, unit, limit: limitText, status: flag ? 'FLAG' : 'ok', note, why });
}
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/** Run one cell: returns per-key stats. */
function cell(view, sigmaPx, rng, opts = {}) {
  const keys = ['yaw_deg', 'pitch_deg', 'roll_deg', 'X_m', 'Y_m', 'h_m', 'D_m'];
  const err = Object.fromEntries(keys.map((k) => [k, []]));
  const sig = Object.fromEntries(keys.map((k) => [k, []]));
  const fRel = [];
  const fSig = [];
  let notOk = 0;
  for (let i = 0; i < TRIALS; i++) {
    const sc = synthMatScene({ view, rng, sigmaPx, range: opts.range });
    const r = solveMatPose({
      corners: sc.corners, venue: sc.venue, view, W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, fLocked: true, sigmaPx,
      gravity: opts.gravity ? sc.gravity : null,
    });
    if (!r.ok || !r.fFormat) { notOk++; continue; }
    for (const k of keys) { err[k].push(r.pose[k] - sc.truth[k]); sig[k].push(r.sigma[k]); }
    fRel.push(r.fFormat.f_free / sc.cam.f - 1);
    fSig.push(r.fFormat.sigma_rel);
  }
  const out = { notOk, n: err.yaw_deg.length };
  for (const k of keys) {
    const a = err[k];
    let inside = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) <= 1.96 * sig[k][i]) inside++;
    out[k] = { p95: percentile(a.map(Math.abs), 95), sd: std(a), sigma_med: median(sig[k]), cover: inside / a.length };
  }
  out.f = { sd: std(fRel), sigma_med: median(fSig) };
  return out;
}

// ------------------------------------------------------------------ face_on gates
const rngFace = mulberry32(SEED);
const LIM = { 1: { yaw: 0.25, roll: 0.2, D: 0.010 }, 3: { yaw: 0.7, roll: 0.6, D: 0.025 } };
const faceCells = {};
for (const s of [1, 3]) {
  const c = cell('face_on', s, rngFace);
  faceCells[s] = c;
  gate(`face_on ${s}px solves ok`, c.notOk, '0 failures', c.notOk === 0);
  gate(`face_on ${s}px P95 |yaw err|`, c.yaw_deg.p95, `≤ ${LIM[s].yaw}°`, c.yaw_deg.p95 <= LIM[s].yaw, '°');
  gate(`face_on ${s}px P95 |roll err|`, c.roll_deg.p95, `≤ ${LIM[s].roll}°`, c.roll_deg.p95 <= LIM[s].roll, '°');
  gate(`face_on ${s}px P95 |D err| (f locked)`, 1000 * c.D_m.p95, `≤ ${1000 * LIM[s].D} mm`, c.D_m.p95 <= LIM[s].D, 'mm');
  for (const k of ['yaw_deg', 'roll_deg', 'D_m']) {
    const cv = c[k].cover;
    gate(`face_on ${s}px 95% coverage of σ (${k})`, 100 * cv, '85–99 %', cv >= 0.85 && cv <= 0.99, '%');
  }
  info(`face_on ${s}px σ_yaw empirical / reported`, c.yaw_deg.sd, `CAFCR C1.1 ${s === 1 ? '0.10' : '0.31'}°`, c.yaw_deg.sd > (s === 1 ? 0.10 : 0.31) * 1.1, '°', `reported median ${fmt(c.yaw_deg.sigma_med)}`);
  info(`face_on ${s}px σ_D empirical (f locked)`, 1000 * c.D_m.sd, 'CAFCR 4–11 mm', 1000 * c.D_m.sd > 11 * 1.1, 'mm');
  info(`face_on ${s}px σ(f)/f, f free`, 100 * c.f.sd, s === 1 ? '≤ 1 % (gate)' : 'CAFCR K3: D σ 57 mm at 3 px if not locked', false, '%', `reported median ${fmt(100 * c.f.sigma_med)} %`);
}
gate('face_on 1px f free: SD (f − f_true)/f_true', 100 * faceCells[1].f.sd, '≤ 1 %', faceCells[1].f.sd <= 0.01, '%');

// ------------------------------------------------------------------ informational cells
const QUOTED = {
  dtl: { yaw_deg: [0.26, 0.31], roll_deg: [0.28, 0.28] },
  high_behind: { yaw_deg: [0.42, 0.58] },
};
const rngInfo = mulberry32(SEED ^ 0x9e3779b9);
for (const view of ['dtl', 'high_behind']) {
  for (const s of [1, 3]) {
    const c = cell(view, s, rngInfo);
    if (c.notOk) info(`${view} ${s}px failed solves`, c.notOk, '0', true);
    for (const k of ['yaw_deg', 'roll_deg']) {
      const q = QUOTED[view][k];
      const span = (a, b, d) => (a === b ? a.toFixed(d) : `${a.toFixed(d)}–${b.toFixed(d)}`);
      const quoted = q ? `CAFCR σ ${span(q[0], q[1], 2)}° @3px (${span(q[0] / 3, q[1] / 3, 2)}° @1px)` : 'not quoted';
      const worse = q ? c[k].sd > ((q[1] * s) / 3) * 1.1 : false;
      info(`${view} ${s}px σ ${k} (P95 ${fmt(c[k].p95)})`, c[k].sd, quoted, worse, '°', `cover ${fmt(100 * c[k].cover, 1)} %`,
        'the quote is one geometry (Db ≈ 3.0 m); this cell spans Db 3.0–3.5 m and ±1° pitch, and the error grows with Db');
    }
    info(`${view} ${s}px σ_D f locked (P95 ${fmt(1000 * c.D_m.p95, 1)} mm)`, 1000 * c.D_m.sd, 'not quoted', false, 'mm', `cover ${fmt(100 * c.D_m.cover, 1)} %`);
    info(`${view} ${s}px σ_h f locked`, 1000 * c.h_m.sd, 'M2b device SD ≤ 15 mm', 1000 * c.h_m.sd > 15, 'mm', '',
      'the device gate (5 re-setups) assumes magnifier taps; with 3 px automatic corners h scatters more on the far views, so C5 should fall back to manual taps when h matters');
    info(`${view} ${s}px σ(f)/f f free`, 100 * c.f.sd, s === 1 ? 'face_on gate is 1 %' : '—', s === 1 && c.f.sd > 0.01, '%', '',
      'the 1 % f-free gate is defined for face_on (where P1 locks f); the P1 average of 3 solves gives /√3');
  }
}
{
  const c = cell('face_on', 3, rngInfo, { range: 'spec' });
  info('face_on 3px full C2 range D 2.7–3.0: P95 |yaw|', c.yaw_deg.p95, 'gate 0.7° (at the tolerance box)', c.yaw_deg.p95 > 0.7, '°');
  info('face_on 3px full C2 range D 2.7–3.0: P95 |roll|', c.roll_deg.p95, 'gate 0.6°', c.roll_deg.p95 > 0.6, '°');
  info('face_on 3px full C2 range D 2.7–3.0: P95 |D|', 1000 * c.D_m.p95, 'gate 25 mm', c.D_m.p95 > 0.025, 'mm');
  const g = cell('face_on', 3, rngInfo, { gravity: true });
  info('face_on 3px + gravity prior 0.4°: P95 |roll|', g.roll_deg.p95, 'mat-only gate 0.6°', false, '°');
}

// ------------------------------------------------------------------ ladder gates
const rngL = mulberry32(SEED ^ 0x5bd1e995);
for (const view of ['face_on', 'dtl', 'high_behind']) {
  const sig = { mat_pnp: [], club_line: [], ball_only: [] };
  let wrong = 0;
  let notOk = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    const sc = synthMatScene({ view, rng: rngL, sigmaPx: 1 });
    const ctx = { venue: sc.venue, view, W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, D_assumed: sc.truth.D_m + gauss(rngL, 0, 0.05) };
    const club = synthClub(sc.cam, rngL);
    const ball = synthBall(sc.cam, rngL);
    const hide = Math.floor(rngL() * 4); // hide two adjacent corners
    const corners = sc.corners.map((c, k) => (k === hide || k === (hide + 1) % 4 ? null : c));
    const cases = [
      [{ corners: sc.corners, club, ball, gravity: sc.gravity }, 'mat_pnp'],
      [{ corners, club, ball, gravity: sc.gravity }, 'club_line'],
      [{ corners, club: null, ball, gravity: sc.gravity }, 'ball_only'],
    ];
    for (const [vis, want] of cases) {
      const r = calibrate(vis, ctx);
      if (!r.ok) { notOk++; continue; }
      if (r.method !== want || r.calibration.method !== want) wrong++;
      sig[r.method]?.push(r.calibration.pose_sigma.yaw_deg);
    }
  }
  const m = { mat_pnp: median(sig.mat_pnp), club_line: median(sig.club_line), ball_only: median(sig.ball_only) };
  gate(`${view} ladder: 2 corners hidden → auto method`, wrong + notOk, '0 wrong / failed of 600', wrong + notOk === 0);
  gate(`${view} ladder: median σ_yaw mat < club_line < ball_only`, `${fmt(m.mat_pnp, 2)} < ${fmt(m.club_line, 2)} < ${fmt(m.ball_only, 2)}`, 'strictly growing',
    m.mat_pnp < m.club_line && m.club_line < m.ball_only, '°');
  info(`${view} ladder σ_yaw club_line`, m.club_line, 'CAFCR ≈1.3–2°', !(m.club_line >= 1.3 && m.club_line <= 2.0 * 1.1), '°');
  info(`${view} ladder σ_yaw ball_only`, m.ball_only, 'CAFCR 3–5°', !(m.ball_only >= 3 && m.ball_only <= 5), '°');
}

// ------------------------------------------------------------------ frames budget and drop test gates
for (const [v, l, want] of [[40, 20, 12.0], [60, 14, 7.4], [70, 12, 6.1], [75, 10, 5.6]]) {
  const r = framesBudget(null, 'face_on', v, l, 0.4);
  gate(`framesBudget face_on shift 0.4: ${v} m/s @ ${l}°`, r.frames, `${want} ± 0.15`, Math.abs(r.frames - want) <= 0.15);
}
{
  const rngD = mulberry32(SEED ^ 0x27d4eb2f);
  const cam = nominalCamera('face_on', { readout: { ms: 3, axis: 'v', dir: 1 } });
  const d = synthDrop({ cam, rng: rngD });
  const r0 = dropTest(d, cam);
  gate('drop test noiseless: |g/9.80665 − 1|', 100 * Math.abs(r0.g / G - 1), '≤ 1 %', Math.abs(r0.g / G - 1) <= 0.01, '%');
  for (const k of [0.95, 1.0, 1.05]) {
    const r = dropTest(d, scaledCamera(cam, k));
    const want = k === 1.0;
    gate(`drop test scale ×${k}: pass = ${want}`, r.g, want ? '9.81 ± 3 % → pass' : 'outside ±3 % → fail', r.pass === want, 'm/s²');
  }
}

// ------------------------------------------------------------------ table
const w = Math.max(...rows.map((r) => r.name.length));
console.log('');
console.log(`${'kind'.padEnd(5)} ${'check'.padEnd(w)}  ${'value'.padStart(22)}  ${'limit / reference'.padEnd(46)} status`);
for (const r of rows) {
  const val = typeof r.value === 'number' ? `${fmt(r.value)} ${r.unit}` : `${r.value} ${r.unit}`;
  console.log(`${r.kind.padEnd(5)} ${r.name.padEnd(w)}  ${val.padStart(22)}  ${String(r.limit).padEnd(46)} ${r.status}${r.note ? `  (${r.note})` : ''}`);
}
const flagged = rows.filter((r) => r.status === 'FLAG');
console.log('');
console.log(`gates: ${rows.filter((r) => r.kind === 'GATE').length}, failed: ${failed}; info flags (worse than quoted, not failing): ${flagged.length}; seed ${SEED}`);
for (const r of flagged) console.log(`FLAG ${r.name}: ${r.why || 'worse than the CAFCR reference; reported, not gated'}`);
process.exit(Math.min(failed, 255));
