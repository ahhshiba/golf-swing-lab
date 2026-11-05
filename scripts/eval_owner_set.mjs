#!/usr/bin/env node
// scripts/eval_owner_set.mjs — CAFCR P14 / PRODUCT-SPEC §7.3: score the event detector against the owner's own labels.
//
//   node scripts/eval_owner_set.mjs <file.json> [--split session] [--tune-frac 0.2] [--detector rules|stored]
//                                   [--baseline PATH] [--update-baseline] [--json]
//
// <file.json> is either
//   * golf-swing-lab-export/1 (歷史 → 匯出 with labels[]): the detector's events are each shot's ORIGINAL events (the
//     first `history` entry that replaced `events`, i.e. before any manual correction; else the current events), or
//   * golf-swing-lab-labels/1 (the teach-mode training-set export, format in docs/training.md): swings with the pose
//     sequence, the detected events and the owner label. By default the CURRENT rules re-detect the events from the
//     pose (--detector stored scores the events the app produced when the shot was analysed).
// Errors are in frames at 60 Hz: (t_detected − t_label) × 60. Tempo = (top − address) / (impact − top).
//
// --split session (§7.3): sessions are ordered by a fixed hash of their id; the first ones form the tune split while
// it stays within --tune-frac of the swings (default 0.2, never above 0.5), the rest is the holdout. Only the
// holdout is gated, once it has at least 20 labelled swings: Impact ±1 frame ≥ 0.90, address ±3 frames ≥ 0.80,
// tempo ±0.3 ≥ 0.80, and no regression against the baseline on the common holdout swings (Impact, address and tempo
// hits each ≥ the baseline's). Without --split the P14 gate applies to all swings (Impact ±1 ≥ 0.90 at ≥ 20 swings,
// no fewer Impact hits than the baseline on common shots).
//
// First run: writes the baseline next to the input (owner-set-baseline.json, or --baseline PATH) and exits 0.
// --update-baseline rewrites it after a passing run. Exit 0 = pass / baseline written, 1 = gate failed,
// 2 = unreadable input.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLabel } from '../app/src/store/labels.js';
import { detectTimeScaled } from '../app/src/events/timescale.js';

export const EVENTS = Object.freeze(['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact',
  'mid_follow_through', 'finish']);
export const EVAL_HZ = 60;
export const GATE = Object.freeze({
  impact_within_1_min: 0.90, min_labelled: 20, tol_frames: 1,
  address_within_3_min: 0.80, address_tol_frames: 3, tempo_tol: 0.3, tempo_within_min: 0.80,
  max_tune_frac: 0.5,
});
export const BASELINE_NAME = 'owner-set-baseline.json';
export const LABELS_FORMAT = 'golf-swing-lab-labels/1';

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

/** base64 (little-endian Float32) -> Float32Array. */
export function decodeF32(b64) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, bytes.length >> 2);
}

/** Float32Array -> base64 (little-endian). */
export function encodeF32(f32) {
  const bytes = new Uint8Array(Float32Array.from(f32).buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

/** base64 (little-endian Uint16) -> Float32Array of lo + u / 65535 · (hi − lo). */
export function decodeU16(b64, lo, hi) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = lo + ((bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) / 65535) * (hi - lo);
  return out;
}

/** Float array -> base64 little-endian Uint16 quantised on [lo, hi] (values are clamped). */
export function encodeU16(x, lo, hi) {
  let s = '';
  for (let i = 0; i < x.length; i++) {
    const q = Math.round(Math.min(1, Math.max(0, (x[i] - lo) / (hi - lo))) * 65535);
    s += String.fromCharCode(q & 255, q >> 8);
  }
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

/**
 * The PoseSeq of a labels/1 swing ({ t_s, img, world: null, W, H, model }) or null. pose.img_f32 = base64 of the
 * little-endian Float32 image landmarks (N × 33 × [x, y, z, visibility]); or pose.img_u16 + pose.q = [lo, hi] for the
 * same values quantised to 16 bits.
 */
export function swingPose(sw) {
  const p = sw?.pose;
  if (!p || !Array.isArray(p.t_s)) return null;
  let img;
  if (typeof p.img_f32 === 'string') img = decodeF32(p.img_f32);
  else if (typeof p.img_u16 === 'string' && Array.isArray(p.q) && p.q.length === 2) img = decodeU16(p.img_u16, p.q[0], p.q[1]);
  else return null;
  if (img.length !== p.t_s.length * 132) return null;
  return { t_s: Float64Array.from(p.t_s), img, world: null, W: p.W, H: p.H, model: p.model ?? 'unknown' };
}

/** Rules events of a labels/1 swing re-detected from its pose (time-scale search included). */
export function redetect(sw) {
  const pose = swingPose(sw);
  if (!pose) return null;
  const n = pose.t_s.length;
  const ev = detectTimeScaled(pose, { view: sw.view, handedness: sw.handedness ?? 'right', audioOnset_t: sw.audio_onset_t ?? undefined },
    { container_fps: sw.container_fps ?? undefined, duration_s: n > 1 ? pose.t_s[n - 1] - pose.t_s[0] : 0 });
  return ev && ev.impact && Number.isFinite(ev.impact.t_s) ? ev : null;
}

/** Normalised items { shot_id, session_id, view, label, detected } of either input format (+ problems). */
export function ownerItems(data, { detector = null } = {}) {
  if (!data || typeof data !== 'object') throw new Error('not a JSON object');
  const fmt = String(data.format);
  const problems = [];
  const items = [];
  if (/^golf-swing-lab-export\/1$/.test(fmt)) {
    if (detector === 'rules') throw new Error('--detector rules needs a golf-swing-lab-labels/1 file (it carries the pose)');
    const shots = new Map((Array.isArray(data.shots) ? data.shots : []).map((s) => [s.shot_id, s]));
    for (const l of Array.isArray(data.labels) ? data.labels : []) {
      const v = validateLabel(l);
      if (!v.ok) { problems.push(`label ${l?.shot_id}: ${JSON.stringify(v.errors)}`); continue; }
      const shot = shots.get(l.shot_id);
      if (!shot) { problems.push(`label ${l.shot_id}: shot not in the export`); continue; }
      const det = detectedEvents(shot);
      if (!det) { problems.push(`shot ${l.shot_id}: no events`); continue; }
      items.push({ shot_id: l.shot_id, session_id: shot.session_id ?? 'unknown', view: shot.capture?.view ?? null, label: l, detected: det });
    }
  } else if (fmt === LABELS_FORMAT) {
    const det = detector ?? 'rules';
    for (const sw of Array.isArray(data.swings) ? data.swings : []) {
      const l = sw?.label;
      const v = validateLabel(l);
      if (!v.ok) { problems.push(`label ${sw?.shot_id}: ${JSON.stringify(v.errors)}`); continue; }
      const ev = det === 'stored' ? sw.detected : redetect(sw);
      if (!ev) { problems.push(`swing ${sw.shot_id}: ${det === 'stored' ? 'no detected events' : 'no swing found in the pose'}`); continue; }
      items.push({ shot_id: sw.shot_id, session_id: sw.session_id ?? 'unknown', view: sw.view ?? null, label: l, detected: ev });
    }
  } else {
    throw new Error(`not a golf-swing-lab-export/1 or ${LABELS_FORMAT} file`);
  }
  return { items, problems };
}

/** 32-bit FNV-1a of a string (the session order of the split; stable across runs and machines). */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Session-wise split: { tune: Set(shot_id), holdout: Set(shot_id), tune_sessions, holdout_sessions }. */
export function splitBySession(items, tuneFrac = 0.2) {
  const frac = Math.min(GATE.max_tune_frac, Math.max(0, tuneFrac));
  const bySess = new Map();
  for (const it of items) {
    if (!bySess.has(it.session_id)) bySess.set(it.session_id, []);
    bySess.get(it.session_id).push(it.shot_id);
  }
  const order = [...bySess.keys()].sort((a, b) => fnv1a(a) - fnv1a(b) || (a < b ? -1 : 1));
  const tune = new Set();
  const holdout = new Set();
  const tuneS = [];
  const holdS = [];
  let n = 0;
  for (const s of order) {
    const ids = bySess.get(s);
    if (holdS.length === 0 && n + ids.length <= frac * items.length) { ids.forEach((i) => tune.add(i)); n += ids.length; tuneS.push(s); } else { ids.forEach((i) => holdout.add(i)); holdS.push(s); }
  }
  return { tune, holdout, tune_sessions: tuneS, holdout_sessions: holdS };
}

const tempoOf = (ev) => {
  const a = ev?.address?.t_s;
  const tp = ev?.top?.t_s;
  const i = ev?.impact?.t_s;
  return [a, tp, i].every(Number.isFinite) && i > tp ? (tp - a) / (i - tp) : null;
};

/** Per-event and tempo statistics of a list of scored rows. */
function summarise(rows, tol) {
  const per_event = {};
  for (const n of EVENTS) {
    const errs = rows.map((r) => r.err[n]).filter(Number.isFinite);
    const a = errs.map(Math.abs);
    per_event[n] = {
      n: a.length,
      mean_abs_frames: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null,
      median_abs_frames: median(a),
      bias_frames: a.length ? errs.reduce((x, y) => x + y, 0) / a.length : null,
      within_1_rate: a.length ? a.filter((x) => x <= tol + 1e-9).length / a.length : null,
    };
  }
  const addr = rows.map((r) => r.err.address).filter(Number.isFinite);
  const tempo = rows.map((r) => r.tempo_err).filter(Number.isFinite);
  return {
    n_scored: rows.length,
    impact_within_1_rate: per_event.impact.within_1_rate,
    address_within_3_rate: addr.length ? addr.filter((x) => Math.abs(x) <= GATE.address_tol_frames + 1e-9).length / addr.length : null,
    tempo_within_rate: rows.length ? tempo.filter((x) => Math.abs(x) <= GATE.tempo_tol + 1e-9).length / rows.length : null,
    per_event,
  };
}

/** Score an input object. Returns the result object (also the baseline format). */
export function evaluateOwnerSet(data, { tol = GATE.tol_frames, split = null, tuneFrac = 0.2, detector = null } = {}) {
  const { items, problems } = ownerItems(data, { detector });
  const perShot = {};
  const sources = {};
  const rows = [];
  for (const it of items) {
    const row = {};
    for (const n of EVENTS) {
      const d = it.detected[n];
      const l = it.label.events[n];
      row[n] = d && Number.isFinite(d.t_s) && l ? (d.t_s - l.t_s) * EVAL_HZ : null;
    }
    const tl = tempoOf(it.label.events);
    const td = tempoOf(it.detected);
    const tempo_err = tl !== null && td !== null ? td - tl : null;
    const src = it.detected.impact?.source ?? 'unknown';
    sources[src] = (sources[src] ?? 0) + 1;
    perShot[it.shot_id] = { ...row, tempo_err, session_id: it.session_id };
    rows.push({ id: it.shot_id, err: row, tempo_err });
  }
  const all = summarise(rows, tol);
  const out = {
    schema: 'gsl-owner-eval/2',
    input_format: String(data.format),
    detector: String(data.format) === LABELS_FORMAT ? (detector ?? 'rules') : 'stored',
    hz: EVAL_HZ,
    tol_frames: tol,
    n_labels: String(data.format) === LABELS_FORMAT ? (data.swings ?? []).length : (data.labels ?? []).length,
    n_scored: all.n_scored,
    impact_within_1_rate: all.impact_within_1_rate,
    address_within_3_rate: all.address_within_3_rate,
    tempo_within_rate: all.tempo_within_rate,
    per_event: all.per_event,
    detector_sources: sources,
    shots: perShot,
    problems,
  };
  if (split === 'session') {
    const sp = splitBySession(items, tuneFrac);
    out.split = { by: 'session', tune_frac: tuneFrac, tune_sessions: sp.tune_sessions, holdout_sessions: sp.holdout_sessions,
      tune: [...sp.tune], holdout: [...sp.holdout] };
    out.tune = summarise(rows.filter((r) => sp.tune.has(r.id)), tol);
    out.holdout = summarise(rows.filter((r) => sp.holdout.has(r.id)), tol);
  }
  return out;
}

const pct = (x) => (x === null || x === undefined ? '—' : `${(100 * x).toFixed(1)}%`);

/** Gate a result, optionally against a baseline. -> { pass, lines: string[], gated } */
export function compareWithBaseline(cur, base) {
  const lines = [];
  let pass = true;
  if (cur.split) {
    const h = cur.holdout;
    const gated = h.n_scored >= GATE.min_labelled;
    lines.push(`split by session: tune ${cur.split.tune.length} swing(s) in ${cur.split.tune_sessions.length} session(s), holdout ${cur.split.holdout.length} in ${cur.split.holdout_sessions.length}`);
    const gates = [
      ['Impact ±1 frame', h.impact_within_1_rate, GATE.impact_within_1_min],
      ['address ±3 frames', h.address_within_3_rate, GATE.address_within_3_min],
      ['tempo ±0.3', h.tempo_within_rate, GATE.tempo_within_min],
    ];
    for (const [name, v, thr] of gates) {
      if (gated) {
        const ok = v !== null && v >= thr;
        lines.push(`${ok ? 'PASS' : 'FAIL'} holdout ${name}: ${pct(v)} (need ≥ ${pct(thr)}, n=${h.n_scored})`);
        if (!ok) pass = false;
      } else {
        lines.push(`NOT GATED holdout ${name}: ${pct(v)} on ${h.n_scored} swing(s) — the gate needs ≥ ${GATE.min_labelled} holdout swings`);
      }
    }
    if (base) {
      const ids = cur.split.holdout.filter((id) => base.shots && id in base.shots);
      const count = (set, f) => ids.filter((id) => set[id] && f(set[id])).length;
      const checks = [
        ['Impact', (r) => Number.isFinite(r.impact) && Math.abs(r.impact) <= GATE.tol_frames + 1e-9],
        ['address', (r) => Number.isFinite(r.address) && Math.abs(r.address) <= GATE.address_tol_frames + 1e-9],
        ['tempo', (r) => Number.isFinite(r.tempo_err) && Math.abs(r.tempo_err) <= GATE.tempo_tol + 1e-9],
      ];
      for (const [name, f] of checks) {
        const hc = count(cur.shots, f);
        const hb = count(base.shots, f);
        const ok = hc >= hb;
        lines.push(`${ok ? 'PASS' : 'FAIL'} no regression on ${ids.length} common holdout swing(s): ${name} hits ${hc} now vs ${hb} at baseline`);
        if (!ok) pass = false;
      }
    }
    return { pass, lines, gated };
  }
  const rate = cur.impact_within_1_rate;
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
  const o = { input: null, baseline: null, update: false, json: false, split: null, tuneFrac: 0.2, detector: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') o.baseline = argv[++i];
    else if (a === '--update-baseline') o.update = true;
    else if (a === '--json') o.json = true;
    else if (a === '--split') { o.split = argv[++i]; if (o.split !== 'session') throw new Error(`--split must be 'session'`); }
    else if (a === '--tune-frac') { o.tuneFrac = Number(argv[++i]); if (!(o.tuneFrac >= 0 && o.tuneFrac <= GATE.max_tune_frac)) throw new Error(`--tune-frac must be in [0, ${GATE.max_tune_frac}]`); }
    else if (a === '--detector') { o.detector = argv[++i]; if (!['rules', 'stored'].includes(o.detector)) throw new Error(`--detector must be rules or stored`); }
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!o.input) o.input = a;
    else throw new Error(`unknown argument '${a}'`);
  }
  return o;
}

export function main(argv = process.argv.slice(2), log = console.log) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(e.message); return 2; }
  if (o.help || !o.input) { log('usage: node scripts/eval_owner_set.mjs <file.json> [--split session] [--tune-frac F] [--detector rules|stored] [--baseline PATH] [--update-baseline] [--json]'); return o.help ? 0 : 2; }
  let data;
  try {
    const txt = fs.readFileSync(o.input, 'utf8');
    data = JSON.parse(txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt);
  } catch (e) { log(`eval_owner_set: cannot read ${o.input}: ${e.message}`); return 2; }
  let cur;
  try { cur = evaluateOwnerSet(data, { split: o.split, tuneFrac: o.tuneFrac, detector: o.detector }); } catch (e) { log(`eval_owner_set: ${e.message}`); return 2; }
  const bpath = o.baseline ?? path.join(path.dirname(path.resolve(o.input)), BASELINE_NAME);
  const out = { ...cur, input: path.basename(o.input), exported_at: data.exported_at ?? null, app_version: data.app_version ?? null };
  log(`eval_owner_set: ${cur.n_scored} labelled swing(s) scored of ${cur.n_labels} label(s) (detector: ${cur.detector}); impact sources ${JSON.stringify(cur.detector_sources)}`);
  for (const p of cur.problems) log(`  skipped: ${p}`);
  if (o.json) log(JSON.stringify(out, null, 2));
  if (!fs.existsSync(bpath)) {
    fs.writeFileSync(bpath, JSON.stringify(out, null, 2) + '\n');
    const r = compareWithBaseline(cur, null);
    for (const l of r.lines) log(l);
    if (!r.pass) { log('eval_owner_set: FAIL'); return 1; }
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
