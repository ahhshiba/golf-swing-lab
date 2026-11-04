#!/usr/bin/env node
// scripts/check_model_card.mjs — the recorded M3 result of the event model is checked on every verify run
// (verify.sh stage model-parity). Reads app/models/event-tcn-v1.json (the "model card" written by training/export.py)
// and asserts, from its results.split1 block (GolfDB split 1 test set, PCE at the GolfDB tolerance):
//   overall PCE ≥ 0.70, PCE excluding address/finish ≥ 0.88, Impact ≥ 0.95, Top ≥ 0.80, TCN overall − rules overall
//   ≥ 0.05 (CAFCR M3 / K9), each recomputed from the recorded per-event numbers where possible — not only the
//   recorded `pass` flags — and every recorded gate must say pass with the same threshold;
// plus sha256(app/models/event-tcn-v1.bin) == json.sha256 and byte length == json.bin_bytes, and the licence note.
// A build without the model files (they are not in app/models) is a FAIL here: the repository must keep the model.
// Usage: node scripts/check_model_card.mjs [--models app/models]. Exit code = number of problems (0 = PASS).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The M3 gates (CAFCR M3 / K9). Thresholds are fixed here, independent of what the card claims. */
export const M3_GATES = Object.freeze({
  overall: 0.70,
  excl_address_finish: 0.88,
  impact: 0.95,
  top: 0.80,
  beats_rules_overall: 0.05,
});

const EV = ['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact', 'mid_follow_through', 'finish'];
const close = (a, b) => Math.abs(a - b) <= 1e-9;

export function checkModelCard(json, bin) {
  const problems = [];
  const notes = [];
  const sha = createHash('sha256').update(bin).digest('hex');
  if (sha !== json.sha256) problems.push(`bin sha256 ${sha} != json.sha256 ${json.sha256}`);
  else notes.push(`bin sha256 ${sha.slice(0, 16)}… matches the card`);
  if (bin.length !== json.bin_bytes) problems.push(`bin is ${bin.length} B, card says ${json.bin_bytes} B`);
  const r = json.results?.split1;
  if (!r || !r.tcn || !r.rules) { problems.push('card has no results.split1 { tcn, rules }'); return { problems, notes }; }
  const pe = r.tcn.per_event ?? {};
  const missing = EV.filter((e) => !Number.isFinite(pe[e]));
  if (missing.length) problems.push(`card tcn.per_event misses ${missing.join(', ')}`);
  else {
    const overall = EV.reduce((s, e) => s + pe[e], 0) / EV.length;
    const excl = EV.filter((e) => e !== 'address' && e !== 'finish').reduce((s, e) => s + pe[e], 0) / 6;
    if (!close(overall, r.tcn.overall)) problems.push(`tcn.overall ${r.tcn.overall} != mean of per_event ${overall}`);
    if (!close(excl, r.tcn.excl_address_finish)) problems.push(`tcn.excl_address_finish ${r.tcn.excl_address_finish} != recomputed ${excl}`);
  }
  const values = {
    overall: r.tcn.overall,
    excl_address_finish: r.tcn.excl_address_finish,
    impact: pe.impact,
    top: pe.top,
    beats_rules_overall: r.tcn.overall - r.rules.overall,
  };
  for (const [g, thr] of Object.entries(M3_GATES)) {
    const v = values[g];
    const ok = Number.isFinite(v) && v >= thr;
    notes.push(`${ok ? 'PASS' : 'FAIL'} ${g} = ${Number.isFinite(v) ? v.toFixed(4) : v} (need ≥ ${thr})`);
    if (!ok) problems.push(`M3 gate ${g}: ${v} < ${thr}`);
    const rec = (r.gates ?? []).find((x) => x.gate === g);
    if (!rec) problems.push(`card records no gate '${g}'`);
    else {
      if (rec.pass !== true) problems.push(`card records gate '${g}' as not passed`);
      if (!close(rec.threshold, thr)) problems.push(`card gate '${g}' threshold ${rec.threshold} != ${thr}`);
      if (Number.isFinite(v) && !close(rec.value, v)) problems.push(`card gate '${g}' value ${rec.value} != recomputed ${v}`);
    }
  }
  if (r.tcn.n !== r.rules.n || !(r.tcn.n > 0)) problems.push(`tcn and rules were scored on different or empty sets (${r.tcn.n} vs ${r.rules.n})`);
  if (typeof json.licence !== 'string' || !/CC BY-NC/.test(json.licence)) problems.push('card has no CC BY-NC licence note');
  return { problems, notes };
}

function main() {
  const i = process.argv.indexOf('--models');
  const dir = i > 0 ? process.argv[i + 1] : join(ROOT, 'app', 'models');
  const jp = join(dir, 'event-tcn-v1.json');
  const bp = join(dir, 'event-tcn-v1.bin');
  const missing = [jp, bp].filter((p) => !existsSync(p));
  if (missing.length) { for (const p of missing) console.log(`model-card: missing ${p}`); process.exit(missing.length); }
  const json = JSON.parse(readFileSync(jp, 'utf8'));
  const { problems, notes } = checkModelCard(json, readFileSync(bp));
  console.log(`model-card: ${json.version} (${json.results?.split1?.tcn?.n ?? '?'} test clips, split 1)`);
  for (const n of notes) console.log(`  ${n}`);
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  console.log(problems.length ? `model-card: FAIL (${problems.length})` : 'model-card: PASS');
  process.exit(Math.min(problems.length, 125));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
