import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GEOM = join(dirname(fileURLToPath(import.meta.url)), '../../app/src/geom');
const files = readdirSync(GEOM).filter((f) => f.endsWith('.js'));

const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/window|document|navigator/, 'browser globals'],
  [/\bself\b|\bglobalThis\b/, 'global object'],
  [/setTimeout|setInterval|requestAnimationFrame/, 'timers'],
  [/location\.hash|history\.(pushState|replaceState)/, 'routing'],
  [/https?:\/\//, 'hard-coded URL'],
  [/\beval\s*\(|new\s+Function/, 'eval'],
  [/\brequire\s*\(|from\s+['"]node:/, 'Node-only import'],
];

test('geom sources are pure and browser-safe', () => {
  assert.ok(files.length >= 7, files.join(','));
  for (const f of files) {
    const src = readFileSync(join(GEOM, f), 'utf8');
    for (const [re, what] of FORBIDDEN) assert.ok(!re.test(src), `${f}: contains ${what}`);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('./') && m[1].endsWith('.js'), `${f}: import '${m[1]}' must be relative with .js`);
    }
  }
});

test('index.js re-exports every module and starts with an API summary', async () => {
  const src = readFileSync(join(GEOM, 'index.js'), 'utf8');
  assert.ok(src.startsWith('//') && src.includes('API summary'));
  const idx = await import('../../app/src/geom/index.js');
  for (const f of files.filter((x) => x !== 'index.js')) {
    const mod = await import(`../../app/src/geom/${f}`);
    for (const name of Object.keys(mod)) assert.ok(name in idx, `${name} from ${f} missing in index.js`);
  }
  for (const name of ['makeCamera', 'project', 'projectMany', 'ray', 'center', 'lookAt', 'eulerFromR', 'rFromEuler',
    'fFromHfov', 'lm', 'mulberry32', 'gauss', 'eigenSym', 'solve', 'cholesky', 'rodrigues', 'orthonormalize',
    'smallestSingularVector', 'percentile', 'rmse', 'G', 'BALL_D', 'TEE_LIFT_PRIOR_SIGMA_M']) {
    assert.ok(name in idx, name);
  }
});
