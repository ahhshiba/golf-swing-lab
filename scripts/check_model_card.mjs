#!/usr/bin/env node
// scripts/check_model_card.mjs — event-model cards (PRODUCT-SPEC §7.4; verify stage model-parity).
//
// Owner models (training/train_owner.py; the only kind a shipped build may use): checkOwnerCard(json, bin) requires
//   sha256(bin) == json.sha256 and byte length == json.bin_bytes; model_card.schema gsl-model-card/1 with
//   golfdb === false, training_data ⊆ ["owner", "synthetic"] (non-empty), owner_holdout metrics (n, Impact ±1,
//   address ±3, tempo ±0.3 rates, rules baseline, gate { passed }); an embedded golden that the app's JS inference
//   (events/tcn.js) reproduces within 1e-4 with the same per-frame argmax.
// Research model (the GolfDB-derived event-tcn-v1, CC BY-NC; dev-only, never in a shipped build, docs/ADR/0004):
//   checkModelCard(json, bin) = the recorded M3 gates of its GolfDB split-1 results, kept as a research report.
//
// Usage: node scripts/check_model_card.mjs [--card M.json] [--models app/models] [--research]
//   --card M.json   check one owner model (M.bin next to it)
//   (default)       every event-tcn-*.json in --models: a card with model_card is an owner card; the legacy research
//                   model (no model_card, CC BY-NC licence) gets the M3 research check and a "not shippable" note;
//                   any other card (e.g. golfdb != false) FAILS. No event model at all: PASS (shipped builds use the rules).
// Exit code = number of problems (0 = PASS).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readdirSync } from 'node:fs';
import { loadTcn } from '../app/src/events/tcn.js';
import { goldenProblems, problemText } from '../app/src/session/models.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OWNER_TRAINING_DATA = Object.freeze(['owner', 'synthetic']);

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

/** Research model (GolfDB split-1 M3 gates; dev-only report, never a ship criterion). */
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

/** Owner model card (§7.4). -> { problems, notes } */
export function checkOwnerCard(json, bin) {
  const problems = [];
  const notes = [];
  const sha = createHash('sha256').update(bin).digest('hex');
  if (sha !== json.sha256) problems.push(`bin sha256 ${sha} != json.sha256 ${json.sha256}`);
  if (bin.length !== json.bin_bytes) problems.push(`bin is ${bin.length} B, card says ${json.bin_bytes} B`);
  const c = json.model_card;
  if (!c || c.schema !== 'gsl-model-card/1') { problems.push('no model_card (gsl-model-card/1)'); return { problems, notes }; }
  if (c.golfdb !== false) problems.push(`model_card.golfdb must be false (is ${JSON.stringify(c.golfdb)})`);
  const td = Array.isArray(c.training_data) ? c.training_data : [];
  if (!td.length || td.some((x) => !OWNER_TRAINING_DATA.includes(x))) problems.push(`model_card.training_data must be a non-empty subset of ${JSON.stringify(OWNER_TRAINING_DATA)} (is ${JSON.stringify(c.training_data)})`);
  if (/golfdb|cc by-nc/i.test(JSON.stringify(c.labels_files ?? '')) || /golfdb/i.test(String(c.init ?? ''))) problems.push('model_card names GolfDB data or weights');
  const h = c.owner_holdout;
  const rates = ['impact_within_1_rate', 'address_within_3_rate', 'tempo_within_rate'];
  if (!h || !(h.n >= 1) || rates.some((k) => !Number.isFinite(h[k]))) problems.push('model_card.owner_holdout metrics missing (run training/node/owner_card.mjs)');
  else {
    if (!h.rules || rates.some((k) => !Number.isFinite(h.rules[k]))) problems.push('model_card.owner_holdout.rules baseline missing');
    if (!h.gate || typeof h.gate.passed !== 'boolean') problems.push('model_card.owner_holdout.gate missing');
    notes.push(`owner holdout n=${h.n}: Impact ±1 ${h.impact_within_1_rate.toFixed(3)}, address ±3 ${h.address_within_3_rate.toFixed(3)}, tempo ±0.3 ${h.tempo_within_rate.toFixed(3)}; gate ${h.gate?.passed ? 'passed (the app uses the model)' : 'not passed (the app keeps the rules)'}`);
  }
  if (!json.golden || !Array.isArray(json.golden.cases) || !json.golden.cases.length) problems.push('no embedded golden (json.golden.cases)');
  else if (!problems.some((p) => /sha256|B, card/.test(p))) {
    try {
      const tcn = loadTcn(json, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
      const g = goldenProblems(tcn, json.golden);
      for (const p of g.problems) problems.push(`golden: ${p.code} ${JSON.stringify(p.params)}`);
      notes.push(`golden: ${json.golden.cases.length} case(s), worst max|dprob| ${g.worst.toExponential(2)} (≤ 1e-4)`);
    } catch (e) { problems.push(`loadTcn failed: ${e.message}`); }
  }
  return { problems, notes };
}

const isResearchCard = (json) => !json.model_card && typeof json.licence === 'string' && /CC BY-NC/.test(json.licence);

function report(label, r) {
  for (const n of r.notes) console.log(`  ${n}`);
  for (const p of r.problems) console.log(`  PROBLEM: ${p}`);
  console.log(`${label}: ${r.problems.length ? `FAIL (${r.problems.length})` : 'PASS'}`);
  return r.problems.length;
}

function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const card = arg('--card');
  if (card) {
    const bp = card.replace(/\.json$/, '.bin');
    if (!existsSync(card) || !existsSync(bp)) { console.log(`model-card: missing ${card} or ${bp}`); process.exit(1); }
    const json = JSON.parse(readFileSync(card, 'utf8'));
    console.log(`model-card: owner model ${json.version}`);
    process.exit(Math.min(125, report('model-card', checkOwnerCard(json, readFileSync(bp)))));
  }
  const dir = arg('--models') ?? join(ROOT, 'app', 'models');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^event-tcn-.*\.json$/.test(f)).sort() : [];
  if (!files.length) { console.log(`model-card: no event model in ${dir} (shipped builds detect events with the rules): PASS`); process.exit(0); }
  let bad = 0;
  for (const f of files) {
    const jp = join(dir, f);
    const bp = jp.replace(/\.json$/, '.bin');
    if (!existsSync(bp)) { console.log(`model-card: missing ${bp}`); bad++; continue; }
    const json = JSON.parse(readFileSync(jp, 'utf8'));
    const bin = readFileSync(bp);
    if (isResearchCard(json)) {
      console.log(`model-card: ${json.version} is a RESEARCH model (GolfDB-derived, CC BY-NC): not shippable, only in --include-golfdb-model dev builds (docs/ADR/0004-no-golfdb-in-product.md)`);
      console.log(`  research report (${json.results?.split1?.tcn?.n ?? '?'} test clips, split 1):`);
      bad += report('model-card (research)', checkModelCard(json, bin));
    } else {
      console.log(`model-card: owner model ${json.version}`);
      bad += report('model-card', checkOwnerCard(json, bin));
    }
  }
  process.exit(Math.min(bad, 125));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
