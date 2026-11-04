import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkSw, hashOf, sha256 } from '../../scripts/check-sw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/check-sw.mjs');

// A dist/ in the shape scripts/build.mjs writes: sw.js with an embedded MANIFEST, shell files, assets.
function fixture({ version = '0.1.0', hash, assetSha } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-sw-'));
  const dist = path.join(dir, 'dist');
  const files = { 'index.html': '<html>', 'src/a.js': 'x=1', 'vendor/w.wasm': 'WASM', 'models/heavy.task': 'HEAVY' };
  for (const [k, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dist, k)), { recursive: true });
    fs.writeFileSync(path.join(dist, k), v);
  }
  const sh = (k) => sha256(Buffer.from(files[k]));
  const shell = ['index.html', 'src/a.js'];
  const assets = [
    { url: 'models/heavy.task', sha256: assetSha ?? sh('models/heavy.task'), precache: false },
    { url: 'vendor/w.wasm', sha256: sh('vendor/w.wasm'), precache: true },
  ];
  const h = hash ?? hashOf([{ url: 'index.html', sha256: sh('index.html') }, { url: 'src/a.js', sha256: sh('src/a.js') }, { url: 'vendor/w.wasm', sha256: sh('vendor/w.wasm') }]);
  const manifest = { version: `${version}+${h}`, dev: false, shell, assets };
  fs.writeFileSync(path.join(dist, 'sw.js'), `// sw\nconst MANIFEST = ${JSON.stringify(manifest)};\nconst VERSION = MANIFEST.version;\n`);
  const pkg = path.join(dir, 'package.json');
  fs.writeFileSync(pkg, JSON.stringify({ version: '0.1.0' }));
  return { dir, dist, pkg, last: path.join(dir, 'last-deploy.json'), h };
}
const fails = (r) => r.filter((x) => !x.ok).map((x) => x.name);

test('a consistent dist passes', () => {
  assert.deepEqual(fails(checkSw(fixture())), []);
});

test('hash mismatch, missing file, tampered asset, wrong semver and missing sw.js fail', () => {
  assert.ok(fails(checkSw(fixture({ hash: '0000000000' }))).includes('VERSION hash == recomputed hash'));
  const f = fixture();
  fs.unlinkSync(path.join(f.dist, 'src/a.js'));
  assert.ok(fails(checkSw(f)).includes('every manifest file exists and matches'));
  assert.ok(fails(checkSw(fixture({ assetSha: 'ab'.repeat(32) }))).includes('every manifest file exists and matches'));
  assert.ok(fails(checkSw(fixture({ version: '0.2.0' }))).includes('VERSION semver == package.json version'));
  assert.ok(fails(checkSw({ ...f, dist: path.join(f.dir, 'none') })).includes('sw.js present'));
});

test('changing a precached file changes the hash; changing a runtime-only asset does not', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.dist, 'src/a.js'), 'x=2');
  assert.ok(fails(checkSw(f)).includes('VERSION hash == recomputed hash'));
  const g = fixture();
  fs.writeFileSync(path.join(g.dist, 'models/heavy.task'), 'OTHER');
  const bad = fails(checkSw(g));
  assert.ok(!bad.includes('VERSION hash == recomputed hash') || bad.includes('every manifest file exists and matches'));
  assert.ok(bad.includes('every manifest file exists and matches'), 'manifest sha of the runtime asset is stale');
});

test('last-deploy: same semver + different contents fails, bumped semver passes', () => {
  const f = fixture();
  fs.writeFileSync(f.last, JSON.stringify({ version: '0.1.0+ffffffffff' }));
  assert.ok(fails(checkSw(f)).some((n) => n.startsWith('contents unchanged since last deploy')));
  fs.writeFileSync(f.last, JSON.stringify({ version: `0.1.0+${f.h}` }));
  assert.deepEqual(fails(checkSw(f)), []);
  fs.writeFileSync(f.last, JSON.stringify({ version: '0.0.9+ffffffffff' }));
  assert.deepEqual(fails(checkSw(f)), []);
  fs.writeFileSync(f.last, JSON.stringify({ version: '0.3.0+ffffffffff' }));
  assert.ok(fails(checkSw(f)).includes('semver not lower than last deploy'));
});

test('path traversal in the manifest is rejected; CLI exit code = fail count', () => {
  const f = fixture();
  const sw = fs.readFileSync(path.join(f.dist, 'sw.js'), 'utf8').replace('"src/a.js"', '"../package.json"');
  fs.writeFileSync(path.join(f.dist, 'sw.js'), sw);
  assert.ok(fails(checkSw(f)).includes('every manifest file exists and matches'));
  const ok = fixture();
  const r = spawnSync(process.execPath, [script, '--dist', ok.dist, '--pkg', ok.pkg, '--last', ok.last], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const bad = spawnSync(process.execPath, [script, '--dist', path.join(ok.dir, 'x'), '--pkg', ok.pkg, '--last', ok.last], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

test('agrees with the real scripts/build.mjs output (same hash algorithm)', async (t) => {
  const buildFile = path.join(root, 'scripts/build.mjs');
  if (!fs.existsSync(buildFile) || !fs.existsSync(path.join(root, 'app/sw.template.js'))) return t.skip('scripts/build.mjs not present');
  const { build } = await import(buildFile);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-realbuild-'));
  const app = path.join(dir, 'app');
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.mkdirSync(path.join(app, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(app, 'src/main.js'), 'export {};\n');
  fs.writeFileSync(path.join(app, 'vendor/v.js'), 'export const v = 1;\n');
  fs.copyFileSync(path.join(root, 'app/sw.template.js'), path.join(app, 'sw.template.js'));
  const out = path.join(dir, 'out');
  build({ app, out, quiet: true });
  const res = checkSw({ dist: out, last: path.join(dir, 'none.json'), pkg: path.join(root, 'package.json') });
  assert.deepEqual(fails(res), []);
  fs.appendFileSync(path.join(out, 'src/main.js'), '// tamper\n');
  assert.ok(fails(checkSw({ dist: out, last: path.join(dir, 'none.json'), pkg: path.join(root, 'package.json') })).length > 0);
});
