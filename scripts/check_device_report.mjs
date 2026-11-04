#!/usr/bin/env node
// scripts/check_device_report.mjs - CAFCR P12: judge a P11 diagnostic report against the R6 device thresholds.
//
//   node scripts/check_device_report.mjs report.json --milestone M1|M2|M2b|M4|M4b|M5|M6
//
// Prints one PASS/FAIL line per check; exit code = number of FAIL checks (capped at 255); usage error = 64.
// Rules: a missing / null / non-finite field is FAIL, never PASS. Thresholds are data (MILESTONES below).
//
// Fields beyond the app-architecture.md section 6 shape (the app records them with diag.record, or the tester adds
// the manual ones before running this script) are marked "manual" or "extension":
//   M2b  repro.<face_on|dtl|high_behind> = {n, yaw_sd_deg, roll_sd_deg, d_sd_mm, h_sd_mm, ball_diam_cv_pct, corner_sd_px}
//        setup.p90_s, setup.n, setup.new_venue_s, droptest.g_mps2
//   M4   ballstats.<iron|driver> = {n, speed_non_null}; ballstats.monitor.median_err_pct (only with a launch monitor)
//        or ballstats.monitor.uncalibrated_declared = true
//   M4b  highspeed.analysis_s_max, highspeed.n
//   M5   live.actual_swings (manual: swings the tester really made)
//   M6   offline = {was_offline, import_ok, analyze_ok, result_ok, export_ok}
//   M2   import.photos / import.files (optional, same shape as import.last)

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'gsl-device-report/1';
export const G = 9.81;

export function getPath(obj, path) {
  let n = obj;
  for (const k of path.split('.')) {
    if (n === null || typeof n !== 'object' || !Object.prototype.hasOwnProperty.call(n, k)) return undefined;
    n = n[k];
  }
  return n;
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

// check = { id, desc, path, op, arg? }  or  { id, desc, fn(report) -> {ok, value} }
// ops: true | eq | gte | lte | between | nonEmptyArray | recorded | bool
export function evalCheck(report, c) {
  if (c.fn) {
    try {
      const r = c.fn(report);
      return { ok: r.ok === true, value: r.value };
    } catch (e) {
      return { ok: false, value: `error: ${e.message}` };
    }
  }
  const v = getPath(report, c.path);
  if (v === undefined || v === null) return { ok: false, value: 'MISSING' };
  switch (c.op) {
    case 'true': return { ok: v === true, value: v };
    case 'eq': return { ok: v === c.arg, value: v };
    case 'gte': return { ok: num(v) && v >= c.arg, value: v };
    case 'lte': return { ok: num(v) && v <= c.arg, value: v };
    case 'between': return { ok: num(v) && v >= c.arg[0] && v <= c.arg[1], value: v };
    case 'nonEmptyArray': return { ok: Array.isArray(v) && v.length > 0, value: Array.isArray(v) ? `${v.length} item(s)` : v };
    case 'bool': return { ok: typeof v === 'boolean', value: v };
    case 'recorded': return { ok: !(typeof v === 'number' && !Number.isFinite(v)) && v !== '', value: v };
    case 'positive': return { ok: num(v) && v > 0, value: v };
    default: throw new Error(`unknown op ${c.op}`);
  }
}

const schemaCheck = { id: 'schema', desc: `schema == ${SCHEMA}`, path: 'schema', op: 'eq', arg: SCHEMA };

function m2Import() {
  const paths = ['import.photos', 'import.files', 'import.last'];
  return (r) => {
    const seen = [];
    let ok = false;
    for (const p of paths) {
      const o = getPath(r, p);
      if (o === undefined || o === null) continue;
      const good = num(o.effective_fps) && o.effective_fps >= 200 && num(o.sample_count) && o.sample_count > 0 && o.decoded === o.sample_count;
      seen.push(`${p}: fps=${o.effective_fps} decoded=${o.decoded}/${o.sample_count}`);
      if (good) ok = true;
    }
    return { ok, value: seen.length ? seen.join('; ') : 'MISSING' };
  };
}

function reproChecks(view) {
  const p = `repro.${view}`;
  return [
    { id: `${view}.n`, desc: `${view}: >=5 reinstalls`, path: `${p}.n`, op: 'gte', arg: 5 },
    { id: `${view}.yaw`, desc: `${view}: yaw SD <= 0.5 deg`, path: `${p}.yaw_sd_deg`, op: 'lte', arg: 0.5 },
    { id: `${view}.roll`, desc: `${view}: roll SD <= 0.3 deg`, path: `${p}.roll_sd_deg`, op: 'lte', arg: 0.3 },
    { id: `${view}.D`, desc: `${view}: D SD <= 20 mm`, path: `${p}.d_sd_mm`, op: 'lte', arg: 20 },
    { id: `${view}.h`, desc: `${view}: h SD <= 15 mm`, path: `${p}.h_sd_mm`, op: 'lte', arg: 15 },
    { id: `${view}.ball`, desc: `${view}: ball diameter CV <= 2 %`, path: `${p}.ball_diam_cv_pct`, op: 'lte', arg: 2 },
    { id: `${view}.corner`, desc: `${view}: mat corner SD <= 4 px`, path: `${p}.corner_sd_px`, op: 'lte', arg: 4 },
  ];
}

function ballChecks(club) {
  return [
    { id: `${club}.n`, desc: `${club}: >=10 shots`, path: `ballstats.${club}.n`, op: 'gte', arg: 10 },
    { id: `${club}.speed`, desc: `${club}: >=7 shots with non-null ball speed`, path: `ballstats.${club}.speed_non_null`, op: 'gte', arg: 7 },
  ];
}

export const MILESTONES = {
  M1: [
    schemaCheck,
    { id: 'standalone', desc: 'running from the home screen (standalone)', path: 'standalone', op: 'true' },
    { id: 'sw_controlled', desc: 'service worker controls the page', path: 'sw_controlled', op: 'true' },
    { id: 'precache', desc: 'precache_complete == 1.0', path: 'precache_complete', op: 'gte', arg: 1 },
    { id: 'avc1', desc: 'WebCodecs avc1 supported', path: 'webcodecs.avc1', op: 'true' },
    { id: 'recorder', desc: 'media_recorder.types not empty', path: 'media_recorder.types', op: 'nonEmptyArray' },
    { id: 'gum_fps', desc: 'actual getUserMedia frameRate measured', path: 'gum.actual_fps', op: 'positive' },
    { id: 'gum_req', desc: 'requested frameRate recorded', path: 'gum.requested_fps', op: 'positive' },
    { id: 'motion', desc: 'DeviceMotion permission behaviour recorded', path: 'motion.permission', op: 'recorded' },
  ],
  M2: [
    schemaCheck,
    { id: 'import', desc: 'photos or files path: effective_fps >= 200 and decoded == sample_count', fn: m2Import() },
    { id: 'hevc', desc: 'HEVC decode result recorded', fn: (r) => {
      const a = getPath(r, 'import.last.hevc');
      const b = getPath(r, 'webcodecs.hevc');
      return { ok: typeof a === 'boolean' || typeof b === 'boolean', value: `import.last.hevc=${a} webcodecs.hevc=${b}` };
    } },
    { id: 'pose_full', desc: 'pose.full_ms_p50 measured (<= 60 ms means full is the default model, else lite)', path: 'pose.full_ms_p50', op: 'positive' },
  ],
  M2b: [
    schemaCheck,
    ...reproChecks('face_on'), ...reproChecks('dtl'), ...reproChecks('high_behind'),
    { id: 'setup_n', desc: 'setup timing sample n >= 10', path: 'setup.n', op: 'gte', arg: 10 },
    { id: 'setup_p90', desc: 'setup time P90 <= 300 s', path: 'setup.p90_s', op: 'lte', arg: 300 },
    { id: 'new_venue', desc: 'new venue setup <= 600 s', path: 'setup.new_venue_s', op: 'lte', arg: 600 },
    { id: 'drop_g', desc: 'drop test g within 9.81 +-3 %', path: 'droptest.g_mps2', op: 'between', arg: [G * 0.97, G * 1.03] },
  ],
  M4: [
    schemaCheck,
    ...ballChecks('iron'), ...ballChecks('driver'),
    { id: 'monitor', desc: 'launch-monitor median error <= 3 %, or "uncalibrated on device" declared', fn: (r) => {
      const e = getPath(r, 'ballstats.monitor.median_err_pct');
      if (e !== undefined && e !== null) return { ok: num(e) && e <= 3, value: e };
      const d = getPath(r, 'ballstats.monitor.uncalibrated_declared');
      return { ok: d === true, value: d === undefined ? 'MISSING' : d };
    } },
  ],
  M4b: [
    schemaCheck,
    { id: 'clips', desc: 'at least 1 high-speed clip analysed', path: 'highspeed.n', op: 'gte', arg: 1 },
    { id: 'per_clip', desc: 'every clip analysed in <= 45 s (iPhone 12)', path: 'highspeed.analysis_s_max', op: 'lte', arg: 45 },
    { id: 'touches', desc: 'touches_per_shot <= 2', path: 'live.touches_per_shot', op: 'lte', arg: 2 },
  ],
  M5: [
    schemaCheck,
    { id: 'detections', desc: '|detections - actual swings| <= 1', fn: (r) => {
      const d = getPath(r, 'live.detections');
      const a = getPath(r, 'live.actual_swings');
      if (!num(d) || !num(a)) return { ok: false, value: `detections=${d ?? 'MISSING'} actual_swings=${a ?? 'MISSING'}` };
      return { ok: Math.abs(d - a) <= 1, value: `detections=${d} actual=${a}` };
    } },
    { id: 'latency', desc: 'live.latency_p95_s <= 8', path: 'live.latency_p95_s', op: 'lte', arg: 8 },
    { id: 'gum_calls', desc: 'gum.calls == 1', path: 'gum.calls', op: 'eq', arg: 1 },
    { id: 'touches', desc: 'touches_per_shot == 0', path: 'live.touches_per_shot', op: 'eq', arg: 0 },
  ],
  M6: [
    schemaCheck,
    { id: 'persisted', desc: 'storage.persisted == true', path: 'storage.persisted', op: 'true' },
    { id: 'was_offline', desc: 'flow ran in airplane mode', path: 'offline.was_offline', op: 'true' },
    { id: 'import_ok', desc: 'offline: import ok', path: 'offline.import_ok', op: 'true' },
    { id: 'analyze_ok', desc: 'offline: analysis ok', path: 'offline.analyze_ok', op: 'true' },
    { id: 'result_ok', desc: 'offline: result card ok', path: 'offline.result_ok', op: 'true' },
    { id: 'export_ok', desc: 'offline: export ok', path: 'offline.export_ok', op: 'true' },
  ],
};

/** -> { results: [{id, desc, ok, value}], fails } */
export function checkReport(report, milestone) {
  const list = MILESTONES[milestone];
  if (!list) throw new Error(`unknown milestone '${milestone}'`);
  const results = list.map((c) => ({ id: c.id, desc: c.desc, ...evalCheck(report, c) }));
  return { results, fails: results.filter((r) => !r.ok).length };
}

function main(argv) {
  const args = argv.slice(2);
  let file = null;
  let ms = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--milestone') ms = args[++i];
    else if (args[i].startsWith('--milestone=')) ms = args[i].slice(12);
    else if (!file) file = args[i];
    else { file = null; break; }
  }
  if (!file || !ms || !MILESTONES[ms]) {
    console.error(`usage: check_device_report.mjs report.json --milestone ${Object.keys(MILESTONES).join('|')}`);
    return 64;
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`cannot read report '${file}': ${e.message}`);
    return 64;
  }
  const { results, fails } = checkReport(report, ms);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}: ${r.desc} [${typeof r.value === 'object' ? JSON.stringify(r.value) : r.value}]`);
  if (ms === 'M2') {
    const p = getPath(report, 'pose.full_ms_p50');
    if (num(p)) console.log(`INFO default pose model: ${p <= 60 ? 'full' : 'lite'} (full p50 = ${p} ms)`);
  }
  console.log(`${ms}: ${results.length - fails}/${results.length} checks passed, ${fails} FAIL`);
  return Math.min(fails, 255);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv);
