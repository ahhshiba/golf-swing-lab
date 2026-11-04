// Licence switch (P9 / R2): build.mjs --no-bundled-model leaves app/models/event-tcn-v1.* out of dist/ and the precache,
// passes the budgets and check-sw; the default build still bundles the model; the app's bundled-model probe reads
// the build output; check_model_card.mjs passes on the repository model; deploy_pages.sh refuses without approval
// and its --dry-run builds + lists without writing git objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, BUDGETS, EVENT_MODEL_FILES } from '../../scripts/build.mjs';
import { checkSw, EVENT_MODEL_RE } from '../../scripts/check-sw.mjs';
import { checkModelCard, M3_GATES } from '../../scripts/check_model_card.mjs';
import { bundledModelAvailable } from '../../app/src/session/models.js';
import { NO_MODEL_SKIP } from './_event_model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `gsl-${p}-`));
const outNo = tmp('nomodel');
const outYes = tmp('withmodel');
const rNo = build({ out: outNo, noBundledModel: true });
const rYes = build({ out: outYes });
const dirs = [outNo, outYes];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const fsFetch = (root) => async (url) => {
  const p = path.join(root, String(url).split('?')[0]);
  if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
  const txt = fs.readFileSync(p, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(txt) };
};

test('--no-bundled-model: no event-model file in dist/, sw manifest or precache; budgets hold', { skip: NO_MODEL_SKIP }, () => {
  assert.deepEqual(rNo.problems, []);
  assert.ok(rNo.shellBytes <= BUDGETS.shell_bytes && rNo.precacheBytes <= BUDGETS.precache_bytes);
  for (const f of EVENT_MODEL_FILES) assert.ok(!fs.existsSync(path.join(outNo, f)), f);
  assert.deepEqual([...rNo.excluded].sort(), [...EVENT_MODEL_FILES].sort());
  const man = JSON.parse(fs.readFileSync(path.join(outNo, 'precache-manifest.json'), 'utf8'));
  assert.equal(man.bundled_event_model, false);
  const sw = fs.readFileSync(path.join(outNo, 'sw.js'), 'utf8');
  assert.ok(!sw.includes('event-tcn-v1'), 'sw.js must not list the model');
  assert.ok(![...man.shell.map((e) => e.url), ...man.assets.map((a) => a.url)].some((u) => EVENT_MODEL_RE.test(u)));
  // everything else the app needs is still there (pose models, wasm, every app/src module)
  for (const must of ['models/pose_landmarker_lite.task', 'models/pose_landmarker_full.task', 'index.html', 'src/main.js', 'src/session/models.js']) assert.ok(fs.existsSync(path.join(outNo, must)), must);
  assert.notEqual(rNo.version, rYes.version);
});

test('default build is unchanged in content: the model is bundled and precached', { skip: NO_MODEL_SKIP }, () => {
  assert.equal(rYes.bundledEventModel, true);
  assert.deepEqual(rYes.excluded, []);
  for (const f of EVENT_MODEL_FILES) {
    assert.ok(fs.existsSync(path.join(outYes, f)), f);
    assert.ok(rYes.assets.find((a) => a.url === f)?.precache, `${f} precached`);
  }
});

test('check-sw passes on both variants; a no-model deploy is compared like with like', { skip: NO_MODEL_SKIP }, () => {
  const pkg = path.join(ROOT, 'package.json');
  const noLast = path.join(outNo, 'no-such-last-deploy.json');
  for (const d of [outNo, outYes]) {
    const res = checkSw({ dist: d, last: noLast, pkg });
    assert.deepEqual(res.filter((r) => !r.ok), [], d);
  }
  // last deploy = this no-model build; a default local build with the same app/ must not demand a semver bump
  const last = path.join(outNo, 'last-deploy.json');
  fs.writeFileSync(last, JSON.stringify({ version: rNo.version, bundled_event_model: false }));
  const res = checkSw({ dist: outYes, last, pkg });
  assert.deepEqual(res.filter((r) => !r.ok), [], JSON.stringify(res.filter((r) => !r.ok)));
  assert.ok(res.some((r) => /no-bundled-model/.test(r.name)));
});

test('the app boot-time probe sees the model in the default build and not in the --no-bundled-model build', { skip: NO_MODEL_SKIP }, async () => {
  assert.equal(await bundledModelAvailable(fsFetch(outYes)), true);
  assert.equal(await bundledModelAvailable(fsFetch(outNo)), false);
  // main.js loads without a bundled model: it never imports the model files, only session/models.js
  const main = fs.readFileSync(path.join(outNo, 'src/main.js'), 'utf8');
  assert.ok(!/event-tcn-v1\.(bin|json)/.test(main));
});

test('check_model_card: the recorded M3 gates pass on the repository model; a tampered card fails', { skip: NO_MODEL_SKIP }, () => {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/models/event-tcn-v1.json'), 'utf8'));
  const bin = fs.readFileSync(path.join(ROOT, 'app/models/event-tcn-v1.bin'));
  assert.deepEqual(checkModelCard(json, bin).problems, []);
  assert.deepEqual({ ...M3_GATES }, { overall: 0.70, excl_address_finish: 0.88, impact: 0.95, top: 0.80, beats_rules_overall: 0.05 });
  const t = JSON.parse(JSON.stringify(json));
  t.results.split1.tcn.per_event.impact = 0.9;
  assert.ok(checkModelCard(t, bin).problems.some((p) => /impact/.test(p)));
  const t2 = JSON.parse(JSON.stringify(json));
  t2.results.split1.rules.overall = t2.results.split1.tcn.overall - 0.01;
  assert.ok(checkModelCard(t2, bin).problems.some((p) => /beats_rules/.test(p)));
  const flipped = Buffer.from(bin);
  flipped[0] ^= 1;
  assert.ok(checkModelCard(json, flipped).problems.some((p) => /sha256/.test(p)));
});

// ---- deploy_pages.sh: refusals + dry run in a throw-away copy (never against the real repository) ----
function repoCopy() {
  const d = tmp('deploy');
  dirs.push(d);
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(d, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(d, 'package.json'));
  fs.symlinkSync(path.join(ROOT, 'app'), path.join(d, 'app'), 'dir');
  return d;
}
const sh = (cwd, args, env = {}) => spawnSync('bash', [path.join(cwd, 'scripts', 'deploy_pages.sh'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });

test('deploy_pages.sh refuses without --i-have-approval, and without an origin remote', () => {
  const d = repoCopy();
  const r1 = sh(d, []);
  assert.equal(r1.status, 2, r1.stdout + r1.stderr);
  assert.match(r1.stderr, /REFUSED.*--i-have-approval/);
  git(d, 'init', '-q');
  git(d, 'add', '-A');
  git(d, 'commit', '-qm', 'snapshot');
  const r2 = sh(d, ['--i-have-approval']);
  assert.equal(r2.status, 2, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /REFUSED: no git remote named origin/);
  const r3 = sh(d, ['--bogus']);
  assert.equal(r3.status, 64);
  assert.equal(git(d, 'branch', '--list', 'gh-pages').stdout.trim(), '');
});

test('deploy_pages.sh --dry-run builds without the model, lists the files and writes no git objects', { skip: NO_MODEL_SKIP }, () => {
  const d = repoCopy();
  git(d, 'init', '-q');
  git(d, 'add', '-A');
  git(d, 'commit', '-qm', 'snapshot');
  git(d, 'remote', 'add', 'origin', path.join(d, 'no-such-remote.git'));
  const objects = () => git(d, 'count-objects', '-v').stdout;
  const before = objects();
  const r = sh(d, ['--dry-run']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DRY RUN: would push \d+ files/);
  assert.match(r.stdout, /bundled event model: false/);
  assert.match(r.stdout, /index\.html/);
  assert.match(r.stdout, /\.nojekyll/);
  assert.ok(!/event-tcn-v1/.test(r.stdout.split('\n').filter((l) => /^\s+\d+\s+\S/.test(l)).join('\n')), 'no model file listed');
  assert.match(r.stdout, /preconditions for a real deploy: OK/);
  assert.equal(objects(), before, 'no git objects written');
  assert.equal(git(d, 'branch', '--list', 'gh-pages').stdout.trim(), '');
  assert.ok(!fs.existsSync(path.join(d, 'deploy', 'last-deploy.json')));
  // --include-golfdb-model lists the model; a dirty tree is reported
  fs.writeFileSync(path.join(d, 'dirty.txt'), 'x');
  const r2 = sh(d, ['--dry-run', '--include-golfdb-model']);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /models\/event-tcn-v1\.bin/);
  assert.match(r2.stdout, /would be REFUSED now:[\s\S]*work tree is not clean/);
});
