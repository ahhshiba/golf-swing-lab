#!/usr/bin/env node
// M4 machine gate (CAFCR R6 M4; KD2, KD9): synthetic shots through the REAL pipeline (pipeline/assemble.js
// assembleShot: events -> metrics -> track.analyzeClip on rendered frames -> physics.analyzeFaceOn -> contract).
// Owner: integration-core. Scenario generator: tests/synth/e2e.js.
//
// Usage: node scripts/synth_e2e.mjs [--quick] [--seed N] [--workers N]
//   full  : 60 main shots (30–80 m/s, launch 5–30°, every third teed 0–50 mm measured ±5 mm, yaw ±2°, ψ ±6°,
//           true readout 0–4 ms in both directions, readout measured ±0.2 ms, mat corners 3 px, noise + motion
//           blur) + 6 at 30 fps + 6 implausible + 6 dtl + 6 high_behind (84 shots); the main shots with a true
//           readout of 2–4 ms are assembled a second time as the app ships today (readout assumed 3 ms).
//   cells (F2 cells added by the "cells" owner; generator tests/synth/cells.js): 30 high_behind shots (club path
//           −6…+6°, launch direction −8…+8°, mat corners 3 px, club-head and ball observations through the real
//           assembleShot with the 2D tracking replaced by the synthetic observations) and 30 face_on swings at
//           30 / 60 fps (pose-based club speed, full assembleShot incl. event detection).
//   --quick: 12 main shots and small side sets (smoke run; gates are noisier).
// scripts/verify.sh (stage synthetic-e2e) runs the FULL gate (it finishes in about 2 min with the worker pool).
// Exit code = number of failed gates (capped at 255). Prints a table and the seed.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

// ------------------------------------------------------------------------------------------------ worker
function summarize(r, validateShot) {
  const m = r.shot.metrics;
  const pick = (x) => ({ value: x.value, ci95: x.ci95, sigma: x.sigma, validity: x.validity, codes: x.reason_codes });
  return {
    m: { ball_speed_mps: pick(m.ball_speed_mps), launch_v_deg: pick(m.launch_v_deg), carry_m: pick(m.carry_m), club_speed_mps: pick(m.club_speed_mps) },
    fit: r.debug.fit ?? null,
    fit2d: r.debug.fit2d ?? null,
    track_n: r.debug.track?.n ?? null,
    warnings: r.shot.quality.warnings,
    valid: validateShot(r.shot).ok,
    view: r.shot.capture.view,
    readout_source: r.shot.calibration.readout_source,
    // which fits break the physical gates (to check "implausible fits all validity implausible")
    fitImplausible: r.debug.fit?.ok === true && r.debug.fit.plausible === false,
    timings: r.timings_ms,
  };
}

async function workerMain() {
  const { buildE2EShot, withAssumedReadout } = await import('../tests/synth/e2e.js');
  const cells = await import('../tests/synth/cells.js');
  const { RC } = await import('../app/src/contract/reason-codes.js');
  const { assembleShot } = await import('../app/src/pipeline/assemble.js');
  const { validateShot } = await import('../app/src/contract/validate.js');
  const pick = (x) => ({ value: x.value, ci95: x.ci95, sigma: x.sigma, validity: x.validity, codes: x.reason_codes });
  parentPort.on('message', (job) => {
    if (job === null) { process.exit(0); }
    const t0 = performance.now();
    const out = { key: job.key, scenario: job.spec.scenario ?? job.spec.kind, i: job.spec.i };
    if (job.spec.kind) {
      try {
        const sp = job.spec;
        const notImpl = (shot) => Object.entries(shot.metrics).filter(([, m]) => m.reason_codes.includes(RC.NOT_IMPLEMENTED)).map(([k]) => k);
        if (sp.kind === 'cells_hb') {
          const s = cells.highBehindShot(sp);
          const r = assembleShot(cells.highBehindInput(s, sp));
          out.m = { club_path_deg: pick(r.shot.metrics.club_path_deg), launch_h_deg: pick(r.shot.metrics.launch_h_deg) };
          out.truth = s.truth;
          out.valid = validateShot(r.shot).ok;
          out.notImpl = notImpl(r.shot);
        } else {
          const c = cells.clubSpeedSwing(sp);
          const r = assembleShot(cells.clubSpeedInput(c, sp));
          out.m = { club_speed_mps: pick(r.shot.metrics.club_speed_mps) };
          out.truth = { ...c.truth, fps: sp.fps };
          out.valid = validateShot(r.shot).ok;
          out.notImpl = notImpl(r.shot);
        }
      } catch (e) {
        out.error = `${e.name}: ${e.message}`;
        out.valid = false;
      }
      out.ms = performance.now() - t0;
      parentPort.postMessage(out);
      return;
    }
    try {
      const b = buildE2EShot(job.spec);
      out.truth = { ...b.truth, events: undefined, start: undefined, roi: undefined, window: undefined };
      out.build_ms = b.build_ms;
      const r = assembleShot(b.input);
      Object.assign(out, summarize(r, validateShot));
      // shipping configuration (readout not measured, 3 ms assumed): the same rendered shot re-assembled, for
      // the main shots whose true readout lies in the range that assumption covers (C1.1: 2–4 ms)
      if (job.spec.scenario === 'main' && b.truth.readout_ms >= 2 && b.truth.readout_ms <= 4) {
        out.assumed = summarize(assembleShot({ ...withAssumedReadout(b.input), track: r.track }), validateShot);
      }
    } catch (e) {
      out.error = `${e.name}: ${e.message}`;
      out.valid = false;
    }
    out.ms = performance.now() - t0;
    parentPort.postMessage(out);
  });
}

// ------------------------------------------------------------------------------------------------ main
function parseArgs(argv) {
  const o = { quick: false, seed: 1, workers: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') o.quick = true;
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--workers') o.workers = Number(argv[++i]);
    else if (a === '-h' || a === '--help') { console.log('usage: node scripts/synth_e2e.mjs [--quick] [--seed N] [--workers N]'); process.exit(0); }
    else { console.error(`synth_e2e: unknown argument ${a}`); process.exit(64); }
  }
  if (!Number.isInteger(o.seed)) { console.error('synth_e2e: --seed needs an integer'); process.exit(64); }
  return o;
}

function runPool(jobs, nWorkers) {
  return new Promise((resolve, reject) => {
    const results = [];
    let next = 0;
    let live = 0;
    const start = () => {
      const w = new Worker(SELF, { workerData: { worker: true } });
      live++;
      const feed = () => {
        if (next < jobs.length) w.postMessage(jobs[next++]);
        else w.postMessage(null);
      };
      w.on('message', (r) => { results.push(r); feed(); });
      w.on('error', reject);
      w.on('exit', () => { live--; if (live === 0) resolve(results); });
      feed();
    };
    for (let k = 0; k < Math.min(nWorkers, jobs.length); k++) start();
  });
}

const quantile = (xs, q) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const p = q * (s.length - 1);
  const lo = Math.floor(p);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo);
};
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function accuracy(rows) {
  const num = rows.filter((r) => r.m && r.m.ball_speed_mps.value !== null && Number.isFinite(r.truth?.speed));
  const se = num.map((r) => (100 * Math.abs(r.m.ball_speed_mps.value - r.truth.speed)) / r.truth.speed);
  const le = rows.filter((r) => r.m && r.m.launch_v_deg.value !== null).map((r) => Math.abs(r.m.launch_v_deg.value - r.truth.launch_v_deg));
  const cov = num.filter((r) => r.truth.speed >= r.m.ball_speed_mps.ci95[0] && r.truth.speed <= r.m.ball_speed_mps.ci95[1]).length;
  const f3 = rows.filter((r) => r.fit?.ok && Number.isFinite(r.truth?.speed)).map((r) => (100 * Math.abs(r.fit.ball_speed_mps - r.truth.speed)) / r.truth.speed);
  const f2 = rows.filter((r) => r.fit2d?.ok && Number.isFinite(r.truth?.speed)).map((r) => (100 * Math.abs(r.fit2d.ball_speed_mps - r.truth.speed)) / r.truth.speed);
  return {
    n: rows.length, nNum: num.length, seMed: quantile(se, 0.5), seP90: quantile(se, 0.9), leMed: quantile(le, 0.5), leP90: quantile(le, 0.9),
    covPct: num.length ? (100 * cov) / num.length : NaN, cov, f3Med: quantile(f3, 0.5), f2Med: quantile(f2, 0.5), nF2: f2.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const T0 = performance.now();
  const { m4Specs } = await import('../tests/synth/e2e.js');
  const { cellsSpecs } = await import('../tests/synth/cells.js');
  const { cellFor } = await import('../app/src/metrics/registry.js');
  const { RC } = await import('../app/src/contract/reason-codes.js');
  const sets = m4Specs({ seed: args.seed, quick: args.quick });
  const jobs = [];
  for (const [name, specs] of Object.entries(sets)) for (const spec of specs) jobs.push({ key: `${name}:${spec.i}`, spec });
  for (const [name, specs] of Object.entries(cellsSpecs({ seed: args.seed, quick: args.quick }))) for (const spec of specs) jobs.push({ key: `${name}:${spec.i}`, spec });
  // rendered face_on shots first (long), the cheap dtl / high_behind shots last, so the pool drains evenly
  jobs.sort((a, b) => Number(b.spec.view === 'face_on') - Number(a.spec.view === 'face_on'));
  const nCpu = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  const nWorkers = Math.max(1, Math.min(args.workers ?? Math.max(1, nCpu - 2), 10, jobs.length));
  console.log(`# synth_e2e (M4 machine gate) seed=${args.seed} mode=${args.quick ? 'quick' : 'full'} shots=${jobs.length} workers=${nWorkers}`);
  const results = await runPool(jobs, nWorkers);
  const by = (s) => results.filter((r) => r.scenario === s).sort((a, b) => a.i - b.i);
  const main = by('main');
  const assumed = main.filter((r) => r.assumed).map((r) => ({ ...r.assumed, truth: r.truth, i: r.i }));
  const errs = results.filter((r) => r.error);
  for (const r of errs) console.log(`# ERROR ${r.key}: ${r.error}`);

  // per-shot table of the main set
  console.log('\n  i  speed  launch   psi  lift_mm ro_ms dir | v_meas  err%   ci95            cov | lv_meas  errdeg | fit2d err% | n validity');
  for (const r of main) {
    const t = r.truth ?? {};
    const b = r.m?.ball_speed_mps;
    const l = r.m?.launch_v_deg;
    const err = b?.value !== null && b ? (100 * (b.value - t.speed)) / t.speed : NaN;
    const in95 = b?.ci95 ? t.speed >= b.ci95[0] && t.speed <= b.ci95[1] : false;
    const e2 = r.fit2d?.ok ? (100 * (r.fit2d.ball_speed_mps - t.speed)) / t.speed : NaN;
    console.log(`${String(r.i).padStart(3)} ${fmt(t.speed, 1).padStart(6)} ${fmt(t.launch_v_deg, 1).padStart(6)} ${fmt(t.psi_deg, 1).padStart(5)} ${fmt((t.lift ?? 0) * 1000, 0).padStart(7)} ${fmt(t.readout_ms, 2).padStart(5)} ${String(t.readout_dir).padStart(3)} | ${fmt(b?.value, 2).padStart(6)} ${fmt(err, 2).padStart(5)}  [${fmt(b?.ci95?.[0], 1)}, ${fmt(b?.ci95?.[1], 1)}] ${in95 ? 'y' : 'N'}   | ${fmt(l?.value, 2).padStart(6)} ${fmt(l?.value - t.launch_v_deg, 2).padStart(6)} | ${fmt(e2, 2).padStart(6)} | ${r.track_n ?? '-'} ${b?.validity ?? r.error}`);
  }

  const A = accuracy(main);
  const B = accuracy(assumed);
  const gates = [];
  const gate = (name, pass, detail) => gates.push({ name, pass: Boolean(pass), detail });
  const minNum = Math.ceil(0.7 * A.n);
  gate('main: ball speed reported (non-null) >= 70 %', A.nNum >= minNum, `${A.nNum}/${A.n}`);
  gate('main: ball speed |err| median <= 2 %', A.seMed <= 2, `${fmt(A.seMed)} %`);
  gate('main: ball speed |err| P90 <= 5 %', A.seP90 <= 5, `${fmt(A.seP90)} %`);
  gate('main: launch_v |err| median <= 1 deg', A.leMed <= 1, `${fmt(A.leMed)} deg`);
  gate('main: launch_v |err| P90 <= 2.5 deg', A.leP90 <= 2.5, `${fmt(A.leP90)} deg`);
  gate('main: ball speed ci95 coverage 85–99 %', A.covPct >= 85 && A.covPct <= 99, `${A.cov}/${A.nNum} = ${fmt(A.covPct, 1)} %`);
  gate('main: fit3d median err < 1/2 of fit2d (linear) median err', A.f3Med < 0.5 * A.f2Med, `fit3d ${fmt(A.f3Med)} % vs fit2d ${fmt(A.f2Med)} % (n2d=${A.nF2})`);
  // extra (not an M4 row): the shipping configuration. Coverage is checked one-sided here: with n ≈ 30 a
  // calibrated 95 % interval covers all shots with probability 0.95^30 ≈ 21 %, so an upper bound would be noise.
  gate('assumed-readout set: speed median <= 2 %, P90 <= 5 %, coverage >= 85 %', B.nNum >= (args.quick ? 3 : 10) && B.seMed <= 2 && B.seP90 <= 5 && B.covPct >= 85,
    `median ${fmt(B.seMed)} %, P90 ${fmt(B.seP90)} %, coverage ${B.cov}/${B.nNum} = ${fmt(B.covPct, 1)} %, launch median ${fmt(B.leMed)} deg`);
  const f30 = by('fps30');
  gate('30 fps: 100 % ball_speed null + FPS_TOO_LOW', f30.length > 0 && f30.every((r) => r.m && r.m.ball_speed_mps.value === null && r.m.ball_speed_mps.codes.includes(RC.FPS_TOO_LOW)),
    `${f30.filter((r) => r.m && r.m.ball_speed_mps.value === null && r.m.ball_speed_mps.codes.includes(RC.FPS_TOO_LOW)).length}/${f30.length}`);
  const allFace = [...main, ...assumed, ...by('implausible')];
  const implFits = allFace.filter((r) => r.fitImplausible);
  const implOk = implFits.filter((r) => r.m.ball_speed_mps.validity === 'implausible' && r.m.launch_v_deg.validity === 'implausible');
  gate('implausible fits: all validity implausible (>= 1 present)', implFits.length >= 1 && implOk.length === implFits.length,
    `${implOk.length}/${implFits.length} implausible fits flagged (implausible set: ${by('implausible').map((r) => r.m?.ball_speed_mps.validity ?? 'error').join(',')})`);
  const nValid = results.filter((r) => r.valid).length + assumed.filter((r) => r.valid).length;
  const nShots = results.length + assumed.length;
  gate('every shot passes validateShot', nValid === nShots, `${nValid}/${nShots}`);
  const other = [...by('dtl'), ...by('high_behind')];
  const viewOk = other.filter((r) => r.m && r.m.ball_speed_mps.value === null && r.m.ball_speed_mps.codes.includes(cellFor('ball_speed_mps', r.view, 240).code));
  gate('dtl + high_behind: ball_speed null with the registry code', other.length > 0 && viewOk.length === other.length,
    `${viewOk.length}/${other.length} (code ${cellFor('ball_speed_mps', 'dtl', 240).code})`);
  // ---- cells: high_behind club path + launch direction, face_on pose club speed (tests/synth/cells.js)
  const hb = by('cells_hb');
  const cs = by('cells_cs');
  const errStat = (rows, id, truthKey, rel) => {
    const num = rows.filter((r) => r.m && r.m[id].value !== null);
    const e = num.map((r) => (rel ? (100 * Math.abs(r.m[id].value - r.truth[truthKey])) / r.truth[truthKey] : Math.abs(r.m[id].value - r.truth[truthKey])));
    const cov = num.filter((r) => r.truth[truthKey] >= r.m[id].ci95[0] && r.truth[truthKey] <= r.m[id].ci95[1]).length;
    return { n: rows.length, nNum: num.length, med: quantile(e, 0.5), p90: quantile(e, 0.9), cov, covPct: num.length ? (100 * cov) / num.length : NaN };
  };
  console.log('\n  cells high_behind:  i  path_true  path_meas  sigma |  psi_true  psi_meas  sigma | side_m nball');
  for (const r of hb) {
    const p = r.m?.club_path_deg;
    const l = r.m?.launch_h_deg;
    console.log(`  ${String(r.i).padStart(20)} ${fmt(r.truth?.club_path_deg, 2).padStart(9)} ${fmt(p?.value, 2).padStart(10)} ${fmt(p?.sigma, 2).padStart(6)} | ${fmt(r.truth?.launch_h_deg, 2).padStart(9)} ${fmt(l?.value, 2).padStart(9)} ${fmt(l?.sigma, 2).padStart(6)} | ${fmt(r.truth?.side_offset_m, 2).padStart(6)} ${r.truth?.ball_n ?? '-'} ${r.error ?? (p?.value === null ? p.codes.join(',') : '')}`);
  }
  console.log('\n  cells face_on club speed:  i fps  true   meas  ci95            in');
  for (const r of cs) {
    const c = r.m?.club_speed_mps;
    const t = r.truth?.club_speed_mps;
    console.log(`  ${String(r.i).padStart(28)} ${String(r.truth?.fps ?? '-').padStart(3)} ${fmt(t, 1).padStart(5)} ${fmt(c?.value, 1).padStart(6)}  [${fmt(c?.ci95?.[0], 1)}, ${fmt(c?.ci95?.[1], 1)}] ${c?.ci95 && t >= c.ci95[0] && t <= c.ci95[1] ? 'y' : 'N'} ${r.error ?? (c?.value === null ? c.codes.join(',') : '')}`);
  }
  const P = errStat(hb, 'club_path_deg', 'club_path_deg', false);
  const L = errStat(hb, 'launch_h_deg', 'launch_h_deg', false);
  const S = errStat(cs, 'club_speed_mps', 'club_speed_mps', true);
  const minHb = Math.ceil(0.7 * P.n);
  gate('cells hb: club path reported (non-null) >= 70 %', P.nNum >= minHb, `${P.nNum}/${P.n} (the rest TRACK_TOO_SHORT: < 2 head samples within ±0.15 m)`);
  gate('cells hb: club path |err| median <= 2.5 deg', P.med <= 2.5, `${fmt(P.med)} deg`);
  gate('cells hb: club path |err| P90 <= 5 deg', P.p90 <= 5, `${fmt(P.p90)} deg`);
  gate('cells hb: club path ci95 coverage 80–99 %', P.covPct >= 80 && P.covPct <= 99, `${P.cov}/${P.nNum} = ${fmt(P.covPct, 1)} %`);
  gate('cells hb: launch_h reported (non-null) >= 70 %', L.nNum >= minHb, `${L.nNum}/${L.n}`);
  gate('cells hb: launch_h |err| median <= 2 deg', L.med <= 2, `${fmt(L.med)} deg`);
  gate('cells hb: launch_h |err| P90 <= 4 deg', L.p90 <= 4, `${fmt(L.p90)} deg`);
  gate('cells hb: launch_h ci95 coverage 80–99 %', L.covPct >= 80 && L.covPct <= 99, `${L.cov}/${L.nNum} = ${fmt(L.covPct, 1)} %`);
  gate('cells face_on 30/60 fps: club speed reported >= 70 %', S.nNum >= Math.ceil(0.7 * S.n), `${S.nNum}/${S.n}`);
  gate('cells face_on 30/60 fps: club speed |err| median <= 15 %', S.med <= 15, `${fmt(S.med)} % (P90 ${fmt(S.p90)} %)`);
  gate('cells face_on 30/60 fps: club speed ci95 (>= ±25 %) coverage >= 80 %', S.covPct >= 80, `${S.cov}/${S.nNum} = ${fmt(S.covPct, 1)} %`);
  const wide = cs.filter((r) => r.m && r.m.club_speed_mps.value !== null && r.m.club_speed_mps.ci95[1] - r.m.club_speed_mps.value >= 0.25 * r.m.club_speed_mps.value - 1e-9 && r.m.club_speed_mps.value - r.m.club_speed_mps.ci95[0] >= 0.25 * r.m.club_speed_mps.value - 1e-9);
  gate('cells face_on: every club speed ci95 half-width >= 25 % (F2 ±25 %)', wide.length === S.nNum && S.nNum > 0, `${wide.length}/${S.nNum}`);
  const cellRows = [...hb, ...cs];
  const ni = cellRows.filter((r) => r.notImpl?.length);
  gate('cells: no metric carries NOT_IMPLEMENTED; every shot valid', ni.length === 0 && cellRows.every((r) => r.valid), `${ni.length} with NOT_IMPLEMENTED (${[...new Set(ni.flatMap((r) => r.notImpl))].join(',') || '-'}), ${cellRows.filter((r) => r.valid).length}/${cellRows.length} valid`);
  console.log(`\n# cells: club path n=${P.nNum}/${P.n} median ${fmt(P.med)} P90 ${fmt(P.p90)} deg coverage ${fmt(P.covPct, 1)} %; launch_h n=${L.nNum}/${L.n} median ${fmt(L.med)} P90 ${fmt(L.p90)} deg coverage ${fmt(L.covPct, 1)} %; club speed n=${S.nNum}/${S.n} median ${fmt(S.med)} % P90 ${fmt(S.p90)} % coverage ${fmt(S.covPct, 1)} %`);

  const elapsed = (performance.now() - T0) / 1000;
  gate('runtime < 300 s', elapsed < 300, `${fmt(elapsed, 1)} s`);

  console.log(`\n# main set: n=${A.n}, numbers=${A.nNum}; speed |err| median ${fmt(A.seMed)} % P90 ${fmt(A.seP90)} %; launch |err| median ${fmt(A.leMed)} P90 ${fmt(A.leP90)} deg; ci95 coverage ${fmt(A.covPct, 1)} %`);
  console.log(`# assumed-readout set: n=${B.n}, numbers=${B.nNum}; speed median ${fmt(B.seMed)} % P90 ${fmt(B.seP90)} %; launch median ${fmt(B.leMed)} P90 ${fmt(B.leP90)} deg; coverage ${fmt(B.covPct, 1)} %; fit2d median ${fmt(B.f2Med)} %`);
  const ms = results.map((r) => r.ms);
  console.log(`# per-shot wall time median ${fmt(quantile(ms, 0.5) / 1000, 1)} s (build + assemble), errors ${errs.length}`);
  console.log('\n  gate                                                            result  value');
  for (const g of gates) console.log(`  ${g.name.padEnd(64)} ${g.pass ? 'PASS' : 'FAIL'}    ${g.detail}`);
  const failed = gates.filter((g) => !g.pass).length;
  console.log(`\n# seed=${args.seed} mode=${args.quick ? 'quick' : 'full'} gates=${gates.length} failed=${failed} elapsed=${fmt(elapsed, 1)} s`);
  process.exitCode = Math.min(255, failed);
}

if (isMainThread) {
  main().catch((e) => { console.error(e); process.exitCode = 70; });
} else if (workerData?.worker) {
  workerMain();
}
