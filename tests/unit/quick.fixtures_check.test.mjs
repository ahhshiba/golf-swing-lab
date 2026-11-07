// Integration (V4-B request 4): tests/fixtures/v4/quick-swings.json is exactly what tests/unit/quick.fixtures.mjs
// generates now (`--check` exit 0), like scripts/make_carry_table.mjs --check in quick.perf.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('quick-swings.json matches a fresh generation (quick.fixtures.mjs --check)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tests/unit/quick.fixtures.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
