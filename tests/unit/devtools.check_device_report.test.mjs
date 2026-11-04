import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MILESTONES, checkReport } from '../../scripts/check_device_report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/check_device_report.mjs');
const fx = (n) => path.join(root, 'tests/fixtures/reports', n);
const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });

for (const m of Object.keys(MILESTONES)) {
  test(`${m}: pass fixture exits 0, fail fixture exits non-zero`, () => {
    const p = run(fx(`pass_${m}.json`), '--milestone', m);
    assert.equal(p.status, 0, p.stdout);
    assert.ok(!/^FAIL/m.test(p.stdout));
    const f = run(fx(`fail_${m}.json`), '--milestone', m);
    assert.ok(f.status > 0, f.stdout);
    assert.equal(f.status, (f.stdout.match(/^FAIL /gm) || []).length, 'exit code = number of FAIL lines');
  });

  test(`${m}: an empty report fails every check (missing field is never PASS)`, () => {
    const { results, fails } = checkReport({}, m);
    assert.equal(fails, results.length);
  });
}

test('every field of a pass fixture is needed: deleting any single checked leaf makes the milestone fail', () => {
  for (const m of ['M1', 'M5', 'M6']) {
    const base = JSON.parse(fs.readFileSync(fx(`pass_${m}.json`), 'utf8'));
    for (const c of MILESTONES[m].filter((x) => x.path)) {
      const r = JSON.parse(JSON.stringify(base));
      const parts = c.path.split('.');
      let n = r;
      for (const k of parts.slice(0, -1)) n = n[k];
      delete n[parts.at(-1)];
      assert.ok(checkReport(r, m).fails >= 1, `${m} ${c.path}`);
    }
  }
});

test('thresholds at the boundary', () => {
  const m5 = JSON.parse(fs.readFileSync(fx('pass_M5.json'), 'utf8'));
  m5.live.detections = 11;
  assert.equal(checkReport(m5, 'M5').fails, 0, '|d-a| = 1 passes');
  m5.live.detections = 12;
  assert.equal(checkReport(m5, 'M5').fails, 1);
  const m2 = JSON.parse(fs.readFileSync(fx('pass_M2.json'), 'utf8'));
  m2.import.last.effective_fps = 199.9;
  assert.equal(checkReport(m2, 'M2').fails, 1);
  m2.import.files = { effective_fps: 240, decoded: 10, sample_count: 10, hevc: true };
  assert.equal(checkReport(m2, 'M2').fails, 0, 'one good path is enough');
  const m1 = JSON.parse(fs.readFileSync(fx('pass_M1.json'), 'utf8'));
  m1.precache_complete = 0.99;
  assert.equal(checkReport(m1, 'M1').fails, 1);
  m1.precache_complete = '1';
  assert.equal(checkReport(m1, 'M1').fails, 1, 'a string is not a number');
});

test('usage errors exit 64', () => {
  assert.equal(run().status, 64);
  assert.equal(run(fx('pass_M1.json')).status, 64);
  assert.equal(run(fx('pass_M1.json'), '--milestone', 'M9').status, 64);
  const bad = path.join(os.tmpdir(), `gsl-bad-${process.pid}.json`);
  fs.writeFileSync(bad, '{nope');
  try { assert.equal(run(bad, '--milestone', 'M1').status, 64); } finally { fs.unlinkSync(bad); }
});
