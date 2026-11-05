// P14 owner annotation: shot-screen label helpers and scripts/eval_owner_set.mjs on a synthetic export
// (Impact ±1 frame at 60 Hz, per-event errors, baseline on the first run, comparison + gates afterwards).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateOwnerSet, compareWithBaseline, detectedEvents, main, BASELINE_NAME, GATE } from '../../scripts/eval_owner_set.mjs';
import { makeLabelRecord } from '../../app/src/store/labels.js';
import { labelStartEvents, buildLabel } from '../../app/src/ui/shot.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EV = ['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact', 'mid_follow_through', 'finish'];
const FPS = 240;

/** n shots whose detected impact is off by impactErr[i] frames at 60 Hz (others by 2 frames). */
function synthExport(n, impactErr = () => 0, { corrected = false } = {}) {
  const shots = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    const truth = Object.fromEntries(EV.map((e, k) => [e, { frame: 100 + 60 * k, t_s: (100 + 60 * k) / FPS }]));
    const det = {};
    for (const e of EV) {
      const errFrames60 = e === 'impact' ? impactErr(i) : 2;
      const t = truth[e].t_s + errFrames60 / 60;
      det[e] = { frame: Math.round(t * FPS), t_s: t, conf: 0.8, source: 'tcn' };
    }
    const shot = { schema: 'golf-shot/1', shot_id: `s${i}`, session_id: 'sess', created_at: `2026-11-04T10:${String(i % 60).padStart(2, '0')}:00.000Z`, events: det, revision: 0 };
    if (corrected) {
      // a later P6 manual correction: current events = truth, the detector's result is kept in history
      shot.history = [{ revision: 0, at: null, before: { events: det } }];
      shot.events = Object.fromEntries(EV.map((e) => [e, { ...truth[e], conf: 1, source: 'manual' }]));
      shot.revision = 1;
    }
    shots.push(shot);
    labels.push(makeLabelRecord({ shot_id: shot.shot_id, events: truth, labelled_at: '2026-11-04T12:00:00.000Z', fps: FPS }));
  }
  return { format: 'golf-swing-lab-export/1', exported_at: '2026-11-04T12:00:00.000Z', app_version: '0.1.0', venues: [], presets: [], sessions: [], shots, labels };
}

test('labelStartEvents prefers the stored label; buildLabel needs all 8 events in order', () => {
  const shot = { shot_id: 'x', events: Object.fromEntries(EV.map((e, k) => [e, { frame: 10 * k, t_s: k / 6, conf: 0.5, source: 'rules' }])) };
  const label = makeLabelRecord({ shot_id: 'x', events: Object.fromEntries(EV.map((e, k) => [e, { frame: 10 * k + 1, t_s: (10 * k + 1) / 60 }])), labelled_at: '2026-11-04T00:00:00Z', fps: 60 });
  assert.equal(labelStartEvents(shot, null).top.frame, 30);
  assert.equal(labelStartEvents(shot, label).top.frame, 31);
  const ok = buildLabel(shot, labelStartEvents(shot, label), { previous: label, at: '2026-11-04T01:00:00Z', fps: 60 });
  assert.equal(ok.record.revision, 1);
  const ev = labelStartEvents(shot);
  delete ev.finish;
  const miss = buildLabel(shot, ev, { at: '2026-11-04T01:00:00Z', fps: 60 });
  assert.equal(miss.record, undefined);
  assert.equal(miss.params.n, 1, 'one missing event reported'); // ui/shot.js now returns { code, params } (PRODUCT-SPEC §3.4)
  const bad = labelStartEvents(shot);
  bad.top = { ...bad.top, frame: 1000, t_s: 10 };
  const order = buildLabel(shot, bad, { at: '2026-11-04T01:00:00Z', fps: 60 });
  assert.equal(order.record, undefined);
  assert.match(String(order.code), /order|monoton/i, `order code: ${order.code}`);
});

test('evaluateOwnerSet: Impact ±1 frame rate and per-event errors at 60 Hz', () => {
  const errs = [0, 1, -1, 2, -3, 0.5, 0, 0, 1, 0]; // 8 of 10 within ±1
  const r = evaluateOwnerSet(synthExport(10, (i) => errs[i]));
  assert.equal(r.n_scored, 10);
  assert.equal(r.impact_within_1_rate, 0.8);
  assert.ok(Math.abs(r.per_event.top.mean_abs_frames - 2) < 1e-9);
  assert.ok(Math.abs(r.per_event.top.bias_frames - 2) < 1e-9);
  assert.equal(r.per_event.top.within_1_rate, 0);
  assert.ok(Math.abs(r.per_event.impact.mean_abs_frames - errs.reduce((s, x) => s + Math.abs(x), 0) / 10) < 1e-9);
  assert.deepEqual(r.detector_sources, { tcn: 10 });
  // the detector's ORIGINAL events are scored even after a manual correction
  const c = evaluateOwnerSet(synthExport(10, (i) => errs[i], { corrected: true }));
  assert.equal(c.impact_within_1_rate, 0.8);
  assert.equal(detectedEvents(synthExport(1, () => 0, { corrected: true }).shots[0]).impact.source, 'tcn');
  // a label without its shot is reported, not scored
  const d = synthExport(3);
  d.shots.pop();
  const rd = evaluateOwnerSet(d);
  assert.equal(rd.n_scored, 2);
  assert.equal(rd.problems.length, 1);
  assert.throws(() => evaluateOwnerSet({ format: 'other' }));
});

test('gates: < 20 shots is reported but not gated; ≥ 20 needs ≥ 90 %; fewer hits on common shots = regression', () => {
  const small = evaluateOwnerSet(synthExport(5, () => 3));
  assert.equal(compareWithBaseline(small, null).pass, true);
  assert.equal(compareWithBaseline(small, null).gated, false);
  const rng = mulberry32(7);
  const good = evaluateOwnerSet(synthExport(25, (i) => (i < 23 ? (rng() - 0.5) * 1.8 : 3)));
  assert.ok(good.impact_within_1_rate >= GATE.impact_within_1_min);
  assert.equal(compareWithBaseline(good, null).pass, true);
  const bad = evaluateOwnerSet(synthExport(25, (i) => (i < 20 ? 0 : 3)));
  assert.equal(bad.impact_within_1_rate, 0.8);
  assert.equal(compareWithBaseline(bad, null).pass, false);
  // regression: same 25 shots, one hit lost against the baseline
  const worse = evaluateOwnerSet(synthExport(25, (i) => (i < 22 ? 0 : 3)));
  const better = evaluateOwnerSet(synthExport(25, (i) => (i < 23 ? 0 : 3)));
  assert.equal(compareWithBaseline(worse, better).pass, false);
  assert.equal(compareWithBaseline(better, worse).pass, true);
});

test('CLI: first run writes the baseline next to the input, later runs compare (exit 0 / 1), bad input exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-owner-'));
  try {
    const f = path.join(dir, 'export.json');
    fs.writeFileSync(f, JSON.stringify(synthExport(24, (i) => (i < 23 ? 0 : 2))));
    const log = [];
    assert.equal(main([f], (l) => log.push(l)), 0);
    const base = path.join(dir, BASELINE_NAME);
    assert.ok(fs.existsSync(base));
    assert.ok(log.some((l) => /BASELINE written/.test(l)));
    assert.equal(JSON.parse(fs.readFileSync(base, 'utf8')).n_scored, 24);
    // same data again: pass
    assert.equal(main([f], () => {}), 0);
    // detector got worse on the same shots: FAIL (exit 1), the baseline is unchanged
    fs.writeFileSync(f, JSON.stringify(synthExport(24, (i) => (i < 20 ? 0 : 2))));
    const log2 = [];
    assert.equal(main([f], (l) => log2.push(l)), 1);
    assert.ok(log2.some((l) => /^FAIL/.test(l)));
    assert.equal(JSON.parse(fs.readFileSync(base, 'utf8')).impact_within_1_rate, 23 / 24);
    // the script itself, as the owner runs it
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'eval_owner_set.mjs'), f], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    assert.equal(main([path.join(dir, 'bad.json')], () => {}), 2);
    assert.equal(main([], () => {}), 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('§7.3 --split session on the 24-swing fixture: holdout ≥ 20 swings gated (Impact ±1, address ±3, tempo ±0.3) and passes', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/owner/labels-fixture.json'), 'utf8'));
  const r = evaluateOwnerSet(fx, { split: 'session' });
  assert.equal(r.n_scored, 24);
  assert.ok(r.split.tune.length <= 12 && r.split.holdout.length >= 20);
  assert.equal(new Set([...r.split.tune_sessions, ...r.split.holdout_sessions]).size, 6, 'whole sessions');
  const g = compareWithBaseline(r, null);
  assert.equal(g.gated, true);
  assert.equal(g.pass, true, g.lines.join('\n'));
  // the stored detections score the same way
  assert.equal(compareWithBaseline(evaluateOwnerSet(fx, { split: 'session', detector: 'stored' }), null).pass, true);
  // a detector that misses impact by 2 frames on every holdout swing fails the gate
  const worse = JSON.parse(JSON.stringify(fx));
  for (const sw of worse.swings) sw.detected.impact.t_s += 2 / 60;
  assert.equal(compareWithBaseline(evaluateOwnerSet(worse, { split: 'session', detector: 'stored' }), null).pass, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-owner-split-'));
  try {
    const base = path.join(dir, 'b.json');
    assert.equal(main([path.join(ROOT, 'tests/fixtures/owner/labels-fixture.json'), '--split', 'session', '--baseline', base], () => {}), 0);
    assert.equal(main([path.join(ROOT, 'tests/fixtures/owner/labels-fixture.json'), '--split', 'session', '--baseline', base], () => {}), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
