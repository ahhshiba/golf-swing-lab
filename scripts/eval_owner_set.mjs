#!/usr/bin/env node
// scripts/eval_owner_set.mjs — CAFCR P14: score the event detector against the owner's own labels.
//
//   node scripts/eval_owner_set.mjs <export.json> [--baseline PATH] [--update-baseline] [--json]
//
// <export.json> is a 歷史 → 匯出 JSON file made with 「包含標註」 (format golf-swing-lab-export/1 with labels[]).
// For every label whose shot is in the file, the detector's events are the shot's ORIGINAL events (the first
// `history` entry that replaced `events`, i.e. before any P6 manual correction; else the current events). Errors are
// in frames at 60 Hz: (t_detected − t_label) × 60. Impact hit = |error| ≤ 1 frame.
//
// First run: writes the baseline next to the input (owner-set-baseline.json, or --baseline PATH) and exits 0.
// Later runs: compare with the baseline on the shots both runs scored, then apply the gates:
//   * Impact ±1 frame rate ≥ 0.90 once at least 20 shots are labelled (CAFCR P14; fewer → reported, not gated);
//   * no regression on the common shots: fewer Impact hits than the baseline on the same shots = FAIL.
// --update-baseline rewrites the baseline after a passing run. Exit 0 = pass / baseline written, 1 = gate failed,
// 2 = unreadable input.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLabel } from '../app/src/store/labels.js';

export const EVENTS = Object.freeze(['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact',
  'mid_follow_through', 'finish']);
export const EVAL_HZ = 60;
export const GATE = Object.freeze({ impact_within_1_min: 0.90, min_labelled: 20, tol_frames: 1 });
export const BASELINE_NAME = 'owner-set-baseline.json';

/** The detector's events of a shot: the events before the first manual correction (P6 history), else the current. */
export function detectedEvents(shot) {
  for (const h of Array.isArray(shot?.history) ? shot.history : []) {
    if (h && h.before && h.before.events) return h.before.events;
  }
  return shot?.events ?? null;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Score an export object. Returns the result object (also the baseline format). */
export function evaluateOwnerSet(data, { tol = GATE.tol_frames } = {}) {
  if (!data || typeof data !== 'object' || !/^golf-swing-lab-export\/1$/.test(String(data.format))) {
    throw new Error('not a golf-swing-lab-export/1 file');
  }
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const shots = new Map((Array.isArray(data.shots) ? data.shots : []).map((s) => [s.shot_id, s]));
  const problems = [];
  const perShot = {};
  const errs = Object.fromEntries(EVENTS.map((n) => [n, []]));
  const sources = {};
  for (const l of labels) {
    const v = validateLabel(l);
    if (!v.ok) { problems.push(`label ${l?.shot_id}: ${v.errors.join('; ')}`); continue; }
    const shot = shots.get(l.shot_id);
    if (!shot) { problems.push(`label ${l.shot_id}: shot not in the export`); continue; }
    const det = detectedEvents(shot);
    if (!det) { problems.push(`shot ${l.shot_id}: no events`); continue; }
    const row = {};
    for (const n of EVENTS) {
      const d = det[n];
      if (!d || !Number.isFinite(d.t_s)) { row[n] = null; continue; }
      const e = (d.t_s - l.events[n].t_s) * EVAL_HZ;
      row[n] = e;
      errs[n].push(e);
    }
    const src = det.impact?.source ?? 'unknown';
    sources[src] = (sources[src] ?? 0) + 1;
    perShot[l.shot_id] = row;
  }
  const per_event = {};
  for (const n of EVENTS) {
    const a = errs[n].map(Math.abs);
    per_event[n] = {
      n: a.length,
      mean_abs_frames: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null,
      median_abs_frames: median(a),
      bias_frames: a.length ? errs[n].reduce((x, y) => x + y, 0) / a.length : null,
      within_1_rate: a.length ? a.filter((x) => x <= tol + 1e-9).length / a.length : null,
    };
  }
  const nScored = Object.keys(perShot).length;
  return {
    schema: 'gsl-owner-eval/1',
    hz: EVAL_HZ,
    tol_frames: tol,
    n_labels: labels.length,
    n_scored: nScored,
    impact_within_1_rate: per_event.impact.within_1_rate,
    per_event,
    detector_sources: sources,
    shots: perShot,
    problems,
  };
}

/** Gate a result, optionally against a baseline. -> { pass, lines: string[], gated } */
export function compareWithBaseline(cur, base) {
  const lines = [];
  let pass = true;
  const rate = cur.impact_within_1_rate;
  const pct = (x) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(1)}%`);
  const gated = cur.n_scored >= GATE.min_labelled;
  if (gated) {
    const ok = rate !== null && rate >= GATE.impact_within_1_min;
    lines.push(`${ok ? 'PASS' : 'FAIL'} Impact ±1 frame: ${pct(rate)} (need ≥ ${pct(GATE.impact_within_1_min)}, n=${cur.n_scored})`);
    if (!ok) pass = false;
  } else {
    lines.push(`NOT GATED Impact ±1 frame: ${pct(rate)} on ${cur.n_scored} shot(s) — the P14 gate needs ≥ ${GATE.min_labelled} labelled shots`);
  }
  if (base) {
    const common = Object.keys(cur.shots).filter((id) => base.shots && id in base.shots);
    const hits = (set, ids) => ids.filter((id) => set[id] && Number.isFinite(set[id].impact) && Math.abs(set[id].impact) <= GATE.tol_frames + 1e-9).length;
    const hc = hits(cur.shots, common);
    const hb = hits(base.shots, common);
    const ok = hc >= hb;
    lines.push(`${ok ? 'PASS' : 'FAIL'} no regression on ${common.length} common shot(s): Impact hits ${hc} now vs ${hb} at baseline`);
    if (!ok) pass = false;
    for (const n of EVENTS) {
      const a = cur.per_event[n].mean_abs_frames;
      const b = base.per_event?.[n]?.mean_abs_frames;
      const f = (x) => (x === null || x === undefined ? '—' : x.toFixed(2));
      lines.push(`  ${n.padEnd(19)} mean |err| ${f(a)} frames (baseline ${f(b)})`);
    }
  }
  return { pass, lines, gated };
}

function parseArgs(argv) {
  const o = { input: null, baseline: null, update: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') o.baseline = argv[++i];
    else if (a === '--update-baseline') o.update = true;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!o.input) o.input = a;
    else throw new Error(`unknown argument '${a}'`);
  }
  return o;
}

export function main(argv = process.argv.slice(2), log = console.log) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(e.message); return 2; }
  if (o.help || !o.input) { log('usage: node scripts/eval_owner_set.mjs <export.json> [--baseline PATH] [--update-baseline] [--json]'); return o.help ? 0 : 2; }
  let data;
  try {
    const txt = fs.readFileSync(o.input, 'utf8');
    data = JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt);
  } catch (e) { log(`eval_owner_set: cannot read ${o.input}: ${e.message}`); return 2; }
  let cur;
  try { cur = evaluateOwnerSet(data); } catch (e) { log(`eval_owner_set: ${e.message}`); return 2; }
  const bpath = o.baseline ?? path.join(path.dirname(path.resolve(o.input)), BASELINE_NAME);
  const out = { ...cur, input: path.basename(o.input), exported_at: data.exported_at ?? null, app_version: data.app_version ?? null };
  log(`eval_owner_set: ${cur.n_scored} labelled shot(s) scored of ${cur.n_labels} label(s); detector impact sources ${JSON.stringify(cur.detector_sources)}`);
  for (const p of cur.problems) log(`  skipped: ${p}`);
  if (o.json) log(JSON.stringify(out, null, 2));
  if (!fs.existsSync(bpath)) {
    fs.writeFileSync(bpath, JSON.stringify(out, null, 2) + '\n');
    const r = compareWithBaseline(cur, null);
    for (const l of r.lines) log(l);
    log(`BASELINE written: ${bpath} (first run; later runs compare with it)`);
    return 0;
  }
  let base;
  try { base = JSON.parse(fs.readFileSync(bpath, 'utf8')); } catch (e) { log(`eval_owner_set: cannot read baseline ${bpath}: ${e.message}`); return 2; }
  const r = compareWithBaseline(cur, base);
  for (const l of r.lines) log(l);
  if (r.pass && o.update) { fs.writeFileSync(bpath, JSON.stringify(out, null, 2) + '\n'); log(`baseline updated: ${bpath}`); }
  log(r.pass ? 'eval_owner_set: PASS' : 'eval_owner_set: FAIL');
  return r.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
