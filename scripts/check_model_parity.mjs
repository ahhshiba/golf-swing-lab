// Model-parity gate (CAFCR R2 / P9): the exported event TCN (app/models/event-tcn-v1.{bin,json}) run by the pure-JS
// inference (app/src/events/tcn.js) reproduces the torch golden (tests/fixtures/event-tcn-v1.golden.json):
// max |dprob| <= 1e-4 and identical per-frame argmax; the bin matches the sha256 in the json and in the golden; the
// model's feature version is the app's FEATURE_VERSION. Exit code = number of problems (0 = PASS).
// Usage: node scripts/check_model_parity.mjs [--models app/models] [--golden tests/fixtures/event-tcn-v1.golden.json]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { FEATURE_VERSION } from '../app/src/events/features.js';
import { loadTcn } from '../app/src/events/tcn.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const modelsDir = arg('--models', join(ROOT, 'app', 'models'));
const goldenPath = arg('--golden', join(ROOT, 'tests', 'fixtures', 'event-tcn-v1.golden.json'));
const TOL = 1e-4;

export function checkParity(json, bin, golden) {
  const problems = [];
  const notes = [];
  const sha = createHash('sha256').update(bin).digest('hex');
  if (sha !== json.sha256) problems.push(`bin sha256 ${sha} != json.sha256 ${json.sha256}`);
  if (golden.sha256 !== json.sha256) problems.push(`golden was made for sha256 ${golden.sha256}, json has ${json.sha256}`);
  if (json.feature_version !== FEATURE_VERSION) problems.push(`json feature_version ${json.feature_version} != ${FEATURE_VERSION}`);
  if (golden.feature_version !== FEATURE_VERSION) problems.push(`golden feature_version ${golden.feature_version} != ${FEATURE_VERSION}`);
  let tcn;
  try {
    const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
    tcn = loadTcn(json, ab);
  } catch (err) {
    problems.push(`loadTcn failed: ${err.message}`);
    return { problems, notes };
  }
  if (!Array.isArray(golden.cases) || golden.cases.length < 3) problems.push('golden needs >= 3 cases');
  let worst = 0;
  for (const c of golden.cases ?? []) {
    const p = tcn.predict({ K: c.K, F: c.F, data: Float64Array.from(c.features) });
    if (p.length !== c.K * 9) { problems.push(`${c.name}: output length ${p.length} != ${c.K * 9}`); continue; }
    let maxd = 0;
    let argBad = 0;
    for (let t = 0; t < c.K; t++) {
      let best = 0;
      for (let k = 0; k < 9; k++) {
        const d = Math.abs(p[t * 9 + k] - c.probs[t * 9 + k]);
        if (!(d <= maxd)) maxd = Number.isFinite(d) ? d : Infinity;
        if (p[t * 9 + k] > p[t * 9 + best]) best = k;
      }
      if (best !== c.argmax[t]) argBad++;
    }
    worst = Math.max(worst, maxd);
    notes.push(`${c.name}: K=${c.K} max|dprob|=${maxd.toExponential(2)} argmax mismatches=${argBad}`);
    if (!(maxd <= TOL)) problems.push(`${c.name}: max |dprob| ${maxd} > ${TOL}`);
    if (argBad) problems.push(`${c.name}: ${argBad} frame(s) with a different argmax`);
  }
  notes.push(`worst max|dprob| = ${worst.toExponential(2)} (tolerance ${TOL})`);
  return { problems, notes };
}

function main() {
  const jp = join(modelsDir, 'event-tcn-v1.json');
  const bp = join(modelsDir, 'event-tcn-v1.bin');
  const missing = [jp, bp, goldenPath].filter((p) => !existsSync(p));
  if (missing.length) {
    for (const p of missing) console.log(`model-parity: missing ${p}`);
    process.exit(missing.length);
  }
  const json = JSON.parse(readFileSync(jp, 'utf8'));
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  const { problems, notes } = checkParity(json, readFileSync(bp), golden);
  console.log(`model-parity: ${json.version} (${json.n_params} params, ${json.feature_version}, sha256 ${json.sha256.slice(0, 12)}…)`);
  for (const n of notes) console.log(`  ${n}`);
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  console.log(problems.length ? `model-parity: FAIL (${problems.length})` : 'model-parity: PASS');
  process.exit(Math.min(problems.length, 125));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
