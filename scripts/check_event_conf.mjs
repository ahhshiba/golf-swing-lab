#!/usr/bin/env node
// scripts/check_event_conf.mjs — reliability of the calibrated event confidence (PRODUCT-SPEC §7.2 EV-4, §7.3;
// proposed verify stage `event-conf`). On the synthetic stress suite + calibration modes, seeds 1–40 at 60 and 240 Hz (the calibration
// is fitted on seeds 41–80, training/node/fit_event_conf.mjs) plus the owner tune split, the events are binned by
// conf (width 0.1); a bin with n ≥ 20 whose within-tolerance rate differs from its mean conf by more than 0.15 is a
// FAIL. Checked per event and pooled over the 8 events. Also checks the calibration's provenance (fitted_on,
// golfdb:false) and that calib-conf.js mirrors calib-conf.json.
//   node scripts/check_event_conf.mjs [--owner FILE] [--quick]      exit code = number of problems (0 = PASS)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS } from '../app/src/contract/enums.js';
import { CONF_CALIB } from '../app/src/events/calib-conf.js';
import { syntheticSamples, ownerSamples, mergeSamples, reliability, CONF_MODES } from '../training/node/event_conf_data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_DEV = 0.15;
export const MIN_BIN_N = 20;

export function checkReliability(samples) {
  const problems = [];
  const lines = [];
  const pooled = { conf: [], y: [] };
  for (const e of EVENTS) {
    const { conf, y } = samples[e];
    pooled.conf.push(...conf);
    pooled.y.push(...y);
    const rows = reliability(conf, y);
    for (const r of rows) {
      const gated = r.n >= MIN_BIN_N;
      const bad = gated && r.dev > MAX_DEV;
      lines.push(`${bad ? 'FAIL' : gated ? 'ok  ' : '    '} ${e.padEnd(19)} conf [${r.lo.toFixed(1)}, ${r.hi.toFixed(1)}) n=${String(r.n).padStart(5)} mean conf ${r.mean_conf.toFixed(3)} within-tol ${r.rate.toFixed(3)} dev ${r.dev.toFixed(3)}`);
      if (bad) problems.push(`${e} bin [${r.lo.toFixed(1)}, ${r.hi.toFixed(1)}): |${r.rate.toFixed(3)} − ${r.mean_conf.toFixed(3)}| > ${MAX_DEV} (n=${r.n})`);
    }
  }
  for (const r of reliability(pooled.conf, pooled.y)) {
    const gated = r.n >= MIN_BIN_N;
    const bad = gated && r.dev > MAX_DEV;
    lines.push(`${bad ? 'FAIL' : gated ? 'ok  ' : '    '} ${'pooled'.padEnd(19)} conf [${r.lo.toFixed(1)}, ${r.hi.toFixed(1)}) n=${String(r.n).padStart(5)} mean conf ${r.mean_conf.toFixed(3)} within-tol ${r.rate.toFixed(3)} dev ${r.dev.toFixed(3)}`);
    if (bad) problems.push(`pooled bin [${r.lo.toFixed(1)}, ${r.hi.toFixed(1)}): dev ${r.dev.toFixed(3)} > ${MAX_DEV} (n=${r.n})`);
  }
  return { problems, lines };
}

export function checkProvenance(calib = CONF_CALIB, jsonPath = path.join(ROOT, 'app', 'src', 'events', 'calib-conf.json')) {
  const problems = [];
  if (calib.golfdb !== false) problems.push('calib-conf: golfdb must be false');
  if (!Array.isArray(calib.fitted_on) || !calib.fitted_on.includes('synthetic-v2')) problems.push('calib-conf: fitted_on must include synthetic-v2');
  if ((calib.fitted_on ?? []).some((s) => /golfdb/i.test(s))) problems.push('calib-conf: fitted on GolfDB');
  for (const e of EVENTS) if (!Array.isArray(calib.events?.[e]?.w) || calib.events[e].w.length !== (calib.features ?? []).length) problems.push(`calib-conf: no weights for ${e}`);
  try {
    const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (JSON.stringify(j) !== JSON.stringify(calib)) problems.push('calib-conf.js does not mirror calib-conf.json (rerun training/node/fit_event_conf.mjs)');
  } catch (e) { problems.push(`calib-conf.json unreadable: ${e.message}`); }
  return problems;
}

function main() {
  const quick = process.argv.includes('--quick');
  const oi = process.argv.indexOf('--owner');
  const ownerFile = oi > 0 ? process.argv[oi + 1] : path.join(ROOT, 'tests', 'fixtures', 'owner', 'labels-fixture.json');
  const problems = checkProvenance();
  const syn = syntheticSamples({ seeds: quick ? [1, 10] : [1, 40] });
  const own = fs.existsSync(ownerFile) ? ownerSamples(ownerFile, { split: 'tune' }) : { acc: null, n: 0 };
  const data = own.acc ? mergeSamples(syn, own.acc) : syn;
  const r = checkReliability(data);
  console.log(`event-conf: ${CONF_CALIB.version} fitted on ${JSON.stringify(CONF_CALIB.fitted_on)}; checked on synthetic seeds ${quick ? '1–10' : '1–40'} × 3 views × ${CONF_MODES.length} modes (8 stress + ${CONF_MODES.length - 8} calibration) × 60/240 Hz + ${own.n} owner-tune swing(s)`);
  for (const l of r.lines) console.log(`  ${l}`);
  problems.push(...r.problems);
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  console.log(problems.length ? `event-conf: FAIL (${problems.length})` : 'event-conf: PASS');
  process.exit(Math.min(problems.length, 125));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
