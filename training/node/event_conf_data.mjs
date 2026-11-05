// training/node/event_conf_data.mjs — (features, within-tolerance) samples of the rule-based events for the
// confidence calibration (PRODUCT-SPEC §7.2 EV-4) and its reliability check (scripts/check_event_conf.mjs).
//   syntheticSamples({ seeds: [a, b], rates, views, modes }) -> { [event]: { X: number[][], y: 0|1[], conf: number[] } }
//   ownerSamples(labelsFile, { split: 'tune' }) -> same shape, from a golf-swing-lab-labels/1 file's tune split
import fs from 'node:fs';
import { detectTimeScaled } from '../../app/src/events/timescale.js';
import { EVENTS } from '../../app/src/contract/enums.js';
import { stressSwing, STRESS_MODES, CALIB_EXTRA_MODES } from '../../tests/synth/swing.js';

/** The calibration data: the §7.3 stress modes plus the failure-prone extra modes. */
export const CONF_MODES = Object.freeze([...STRESS_MODES, ...CALIB_EXTRA_MODES]);
import { ownerItems, splitBySession, swingPose, redetect } from '../../scripts/eval_owner_set.mjs';

/** Within-tolerance definition (real seconds): 2 frames at 60 Hz for address / top / impact, 4 for the others. */
export const CONF_TOL_S = Object.freeze(Object.fromEntries(EVENTS.map((e) => [e, ['address', 'top', 'impact'].includes(e) ? 2 / 60 : 4 / 60])));

const empty = () => Object.fromEntries(EVENTS.map((e) => [e, { X: [], y: [], conf: [] }]));

function addSample(acc, ev, truthT, toReal = (t) => t) {
  const feats = ev?.diag?.conf_features;
  if (!feats) return;
  for (const e of EVENTS) {
    if (!Number.isFinite(truthT[e]) || !ev[e] || !Number.isFinite(ev[e].t_s)) continue;
    const err = Math.abs(toReal(ev[e].t_s) - toReal(truthT[e]));
    acc[e].X.push(feats[e]);
    acc[e].y.push(err <= CONF_TOL_S[e] + 1e-9 ? 1 : 0);
    acc[e].conf.push(ev[e].conf);
  }
}

export function syntheticSamples({ seeds = [41, 80], rates = [60, 240], views = ['face_on', 'dtl', 'high_behind'], modes = CONF_MODES } = {}) {
  const acc = empty();
  for (const view of views) for (const mode of modes) for (const fps of rates) for (let seed = seeds[0]; seed <= seeds[1]; seed++) {
    const st = stressSwing({ seed, view, fps, mode, handedness: seed % 4 === 0 ? 'left' : 'right' });
    const ev = detectTimeScaled(st.poseSeq, { view, handedness: st.swing.handedness }, { container_fps: st.container_fps, duration_s: st.duration_s });
    if (!ev.impact || !Number.isFinite(ev.impact.t_s)) continue;
    const truth = Object.fromEntries(EVENTS.map((e) => [e, st.truth.events[e]?.t_s]));
    addSample(acc, ev, truth, st.toReal);
  }
  return acc;
}

export function ownerSamples(file, { split = 'tune', tuneFrac = 0.2 } = {}) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const acc = empty();
  if (!Array.isArray(data.swings)) return { acc, n: 0 };
  const { items } = ownerItems(data, { detector: 'stored' });
  const sp = splitBySession(items, tuneFrac);
  const want = split === 'tune' ? sp.tune : sp.holdout;
  let n = 0;
  for (const sw of data.swings) {
    if (!want.has(sw.shot_id) || !swingPose(sw)) continue;
    const ev = redetect(sw);
    if (!ev) continue;
    const k = sw.time_scale ?? 1;
    addSample(acc, ev, Object.fromEntries(EVENTS.map((e) => [e, sw.label.events[e]?.t_s])), (t) => t / k);
    n++;
  }
  return { acc, n };
}

export function mergeSamples(a, b) {
  const out = empty();
  for (const e of EVENTS) for (const s of [a, b]) {
    out[e].X.push(...s[e].X);
    out[e].y.push(...s[e].y);
    out[e].conf.push(...s[e].conf);
  }
  return out;
}

/** Reliability table: bins of width `w` over conf; rows { lo, hi, n, mean_conf, rate, dev }. */
export function reliability(conf, y, w = 0.1) {
  const nb = Math.round(1 / w);
  const rows = [];
  for (let b = 0; b < nb; b++) {
    const lo = b * w;
    const hi = b === nb - 1 ? 1.000001 : (b + 1) * w;
    let n = 0; let sc = 0; let sy = 0;
    for (let i = 0; i < conf.length; i++) if (conf[i] >= lo && conf[i] < hi) { n++; sc += conf[i]; sy += y[i]; }
    if (n) rows.push({ lo, hi: Math.min(1, hi), n, mean_conf: sc / n, rate: sy / n, dev: Math.abs(sy / n - sc / n) });
  }
  return rows;
}
