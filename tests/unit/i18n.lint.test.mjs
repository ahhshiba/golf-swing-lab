// scripts/check_i18n.mjs (PRODUCT-SPEC §3.6): A's namespaces pass (100 % coverage, placeholders, copy rules, every
// code key exists); other packages are WARN until --strict; CJK literals in app/src are counted per package and fail only
// with --strict; key extraction understands t('…'), plural('…'), msg codes and template prefixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkI18n, scanSources, ownerOfFile, COPY_RULE } from '../../scripts/check_i18n.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/check_i18n.mjs', import.meta.url));

test('real tree: no FAIL in the foundation scope; every foundation namespace at 100 %', () => {
  const r = checkI18n();
  assert.deepEqual(r.findings.filter((f) => f.level === 'FAIL'), []);
  const index = JSON.parse(fs.readFileSync(new URL('../../app/i18n/namespaces.json', import.meta.url), 'utf8'));
  for (const ns of index.owners.foundation) {
    const c = r.coverage.get(ns);
    assert.ok(c.en > 0 && c.en === c.zh && !c.missingEn.length && !c.missingZh.length, `${ns}: ${c.en}/${c.zh}`);
  }
  const cli = spawnSync(process.execPath, [SCRIPT, '--quiet'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout);
  assert.match(cli.stdout, /CJK literal lines in app\/src \(outside comments\): \d+/);
  assert.match(cli.stdout, /namespace coverage \(en keys \/ zh-Hant keys\)/);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' }).status, 64);
});

test('--strict turns every finding into a FAIL, including each file with CJK literals', () => {
  const loose = checkI18n();
  const strict = checkI18n({ strict: true });
  assert.ok(strict.findings.every((f) => f.level === 'FAIL'));
  assert.equal(strict.findings.filter((f) => f.kind === 'cjk').length, loose.cjk.size);
  assert.ok(strict.findings.length >= loose.findings.length);
});

test('scanSources: literal keys, msg codes, template prefixes; comments and CJK counting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-i18n-'));
  const app = path.join(dir, 'x.js');
  fs.writeFileSync(app, [
    "// t('commented.key') 中文註解",
    "const a = t('home.title', { n }) + plural('time.minutes', 3);",
    "const b = t(`club.${type}`); const m = { code: 'storage.over_limit', params: {} };",
    "const c = '中文字串';",
    "if (has('reason.X.fix')) d();",
  ].join('\n'));
  // scanSources reads paths relative to app/: point it at an absolute file through a relative climb
  const rel = path.relative(fileURLToPath(new URL('../../app/', import.meta.url)), app);
  const r = scanSources([rel]);
  assert.deepEqual([...r.keys.keys()].sort(), ['home.title', 'storage.over_limit', 'time.minutes']);
  assert.ok(r.prefixes.has('club.'));
  assert.ok(r.prefixes.has('reason.X.fix'), 'has() guards are optional keys');
  assert.equal(r.cjk.get(rel), 1, 'one line with CJK outside comments');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('copy rule and file ownership', () => {
  for (const bad of ['P14 標註', 'SETUP_UNVERIFIED', 'see eval.mjs', 'sha256', 'GolfDB', 'tcn model']) assert.ok(COPY_RULE.test(bad), bad);
  for (const ok of ['第 12 球', 'Ball speed', '7 號鐵']) assert.ok(!COPY_RULE.test(ok), ok);
  assert.equal(ownerOfFile('src/ui/components.js'), 'foundation');
  assert.equal(ownerOfFile('src/ui/setup.js'), 'practice');
  assert.equal(ownerOfFile('src/ui/history.js'), 'results');
  assert.equal(ownerOfFile('src/store/core.js'), 'platform');
  assert.equal(ownerOfFile('src/events/rules.js'), 'events');
  assert.equal(ownerOfFile('src/ui/privacy.js'), 'trust');
});

test('integration (§8.7 step 3): verify.sh runs check_i18n and check_tokens --strict; the whole tree is strict-clean', () => {
  const verify = fs.readFileSync(new URL('../../scripts/verify.sh', import.meta.url), 'utf8');
  assert.match(verify, /script_stage i18n\s+scripts\/check_i18n\.mjs --quiet --strict\s*$/m);
  assert.match(verify, /script_stage tokens\s+scripts\/check_tokens\.mjs --strict\s*$/m);
  const strict = checkI18n({ strict: true });
  assert.equal(strict.cjkTotal, 0, 'CJK literal lines in app/src');
  assert.deepEqual(strict.findings, []);
});
