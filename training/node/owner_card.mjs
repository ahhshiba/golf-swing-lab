#!/usr/bin/env node
// training/node/owner_card.mjs — fill the model card's owner-set holdout metrics and gate (PRODUCT-SPEC §7.3, §7.4)
// of a model written by training/train_owner.py. The holdout swings (card.split.holdout) are scored with the app's
// own code: events/tcn.js inference + events/detect.js ordered decode (exactly what the app runs), and the rules
// (events/timescale.js detectTimeScaled) on the same swings as the baseline. Gate = holdout ≥ 20 swings, Impact ±1
// frame @60 Hz ≥ 0.90, address ±3 frames ≥ 0.80, tempo ±0.3 ≥ 0.80, and no fewer hits than the rules on any of the
// three. The json is rewritten in place (the .bin and its sha256 are unchanged).
//   node training/node/owner_card.mjs --model M.json --labels L.json [L2.json ...]
import fs from 'node:fs';
import { loadTcn } from '../../app/src/events/tcn.js';
import { detect } from '../../app/src/events/detect.js';
import { detectTimeScaled, scalePoseTime } from '../../app/src/events/timescale.js';
import { EVENTS } from '../../app/src/contract/enums.js';
import { swingPose, GATE, LABELS_FORMAT } from '../../scripts/eval_owner_set.mjs';

const tempo = (ev) => (ev.top.t_s - ev.address.t_s) / (ev.impact.t_s - ev.top.t_s);

export function scoreSwing(ev, label, k = 1) {
  const err = {};
  for (const e of EVENTS) err[e] = ev && Number.isFinite(ev[e]?.t_s) ? ((ev[e].t_s - label.events[e].t_s) / k) * 60 : null;
  const tl = tempo(label.events);
  const td = ev ? tempo(ev) : NaN;
  return { err, tempo_err: Number.isFinite(td) ? td - tl : null };
}

export function summarise(rows) {
  const n = rows.length;
  const rate = (f) => (n ? rows.filter(f).length / n : null);
  const per_event = {};
  for (const e of EVENTS) {
    const a = rows.map((r) => r.err[e]).filter(Number.isFinite).map(Math.abs);
    per_event[e] = { n: a.length, mean_abs_frames: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null };
  }
  return {
    n,
    impact_within_1_rate: rate((r) => Number.isFinite(r.err.impact) && Math.abs(r.err.impact) <= GATE.tol_frames + 1e-9),
    address_within_3_rate: rate((r) => Number.isFinite(r.err.address) && Math.abs(r.err.address) <= GATE.address_tol_frames + 1e-9),
    tempo_within_rate: rate((r) => Number.isFinite(r.tempo_err) && Math.abs(r.tempo_err) <= GATE.tempo_tol + 1e-9),
    per_event,
  };
}

export function ownerHoldout(json, bin, swings) {
  const tcn = loadTcn(json, bin);
  const want = new Set(json.model_card?.split?.holdout ?? []);
  const rowsT = [];
  const rowsR = [];
  for (const sw of swings) {
    if (!want.has(sw.shot_id)) continue;
    const pose = swingPose(sw);
    if (!pose) continue;
    const k = sw.time_scale ?? 1;
    const opts = { view: sw.view, handedness: sw.handedness ?? 'right', audioOnset_t: Number.isFinite(sw.audio_onset_t) ? sw.audio_onset_t / k : undefined };
    const scaled = scalePoseTime(pose, k);
    const evT = detect(scaled, { ...opts, useTcn: true, tcn });
    const media = (ev) => Object.fromEntries(EVENTS.map((e) => [e, { ...ev[e], t_s: ev[e].t_s * k }]));
    rowsT.push(scoreSwing(media(evT), sw.label, k));
    const n = pose.t_s.length;
    const evR = detectTimeScaled(pose, { ...opts, audioOnset_t: sw.audio_onset_t ?? undefined }, { duration_s: pose.t_s[n - 1] - pose.t_s[0] });
    rowsR.push(scoreSwing(Number.isFinite(evR.impact?.t_s) ? evR : null, sw.label, k));
  }
  const t = summarise(rowsT);
  const r = summarise(rowsR);
  const reasons = [];
  if (t.n < GATE.min_labelled) reasons.push(`holdout has ${t.n} swings (need ≥ ${GATE.min_labelled})`);
  const checks = [['impact_within_1_rate', GATE.impact_within_1_min], ['address_within_3_rate', GATE.address_within_3_min], ['tempo_within_rate', GATE.tempo_within_min]];
  for (const [key, thr] of checks) {
    if (!(t[key] >= thr)) reasons.push(`${key} ${t[key]} < ${thr}`);
    if (!(t[key] >= r[key])) reasons.push(`${key} ${t[key]} below the rules (${r[key]})`);
  }
  return { ...t, rules: r, gate: { passed: reasons.length === 0, min_n: GATE.min_labelled, thresholds: Object.fromEntries(checks), reasons } };
}

function main() {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf('--model');
  const li = argv.indexOf('--labels');
  if (mi < 0 || li < 0) { console.error('usage: owner_card.mjs --model M.json --labels L.json [...]'); process.exit(2); }
  const modelPath = argv[mi + 1];
  const labels = argv.slice(li + 1).filter((a) => !a.startsWith('--'));
  const json = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const binBuf = fs.readFileSync(modelPath.replace(/\.json$/, '.bin'));
  const bin = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
  const swings = [];
  for (const f of labels) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (d.format !== LABELS_FORMAT) { console.error(`${f}: not ${LABELS_FORMAT}`); process.exit(2); }
    swings.push(...d.swings);
  }
  const h = ownerHoldout(json, bin, swings);
  json.model_card.owner_holdout = h;
  fs.writeFileSync(modelPath, JSON.stringify(json, null, 1) + '\n');
  const pct = (x) => (x === null ? '—' : `${(100 * x).toFixed(1)}%`);
  console.log(`owner holdout (${h.n} swings): Impact ±1 ${pct(h.impact_within_1_rate)} (rules ${pct(h.rules.impact_within_1_rate)}), address ±3 ${pct(h.address_within_3_rate)} (rules ${pct(h.rules.address_within_3_rate)}), tempo ±0.3 ${pct(h.tempo_within_rate)} (rules ${pct(h.rules.tempo_within_rate)})`);
  console.log(`gate: ${h.gate.passed ? 'PASSED' : `NOT PASSED (${h.gate.reasons.join('; ')})`} -> ${modelPath}`);
}

if (process.argv[1] && process.argv[1].endsWith('owner_card.mjs')) main();
