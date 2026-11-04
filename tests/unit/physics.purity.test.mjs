import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHYS = join(HERE, '../../app/src/physics');
const files = readdirSync(PHYS).filter((f) => f.endsWith('.js'));

const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/\b(window|document|navigator|self|globalThis)\s*[.[(]/, 'browser / global objects'],
  [/\b(addEventListener|postMessage|importScripts|localStorage|indexedDB)\b/, 'DOM / worker APIs'],
  [/setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.now/, 'timers / clock'],
  [/location\.hash|history\.(pushState|replaceState)/, 'routing'],
  [/https?:\/\//, 'hard-coded URL'],
  [/\beval\s*\(|new\s+Function/, 'eval'],
  [/\brequire\s*\(|from\s+['"]node:/, 'Node-only import'],
];

test('physics sources are pure and browser-safe; reason codes only via RC.<NAME>', async () => {
  assert.ok(files.length >= 10, files.join(','));
  const { REASON_CODES } = await import('../../app/src/contract/reason-codes.js');
  const bare = new RegExp(`['"](${Object.keys(REASON_CODES).join('|')})['"]`);
  for (const f of files) {
    const src = readFileSync(join(PHYS, f), 'utf8');
    for (const [re, what] of FORBIDDEN) assert.ok(!re.test(src), `${f}: contains ${what}`);
    assert.ok(!bare.test(src), `${f}: bare reason-code string (use RC.<NAME>)`);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${f}: import '${m[1]}' must be relative`);
      assert.ok(m[1].endsWith('.js'), `${f}: import '${m[1]}' needs .js`);
    }
  }
});

test('synthetic generator uses only the seeded rng', () => {
  const src = readFileSync(join(HERE, '../synth/ballflight.js'), 'utf8');
  assert.ok(!/Math\.random/.test(src));
});

test('physics/index.js starts with an API summary and re-exports every module', async () => {
  const src = readFileSync(join(PHYS, 'index.js'), 'utf8');
  assert.ok(src.startsWith('//') && src.includes('API summary'));
  const idx = await import('../../app/src/physics/index.js');
  for (const f of files.filter((x) => x !== 'index.js')) {
    const mod = await import(`../../app/src/physics/${f}`);
    for (const name of Object.keys(mod)) assert.ok(name in idx, `${name} from ${f} missing in index.js`);
  }
  for (const name of ['readoutFor', 'observationTime', 'fit3d', 'fit2d', 'propagate', 'flight', 'carryEstimate', 'clubSpeed',
    'isPlausible', 'toMetrics', 'analyzeFaceOn', 'startFromStaticBall', 'SPIN_PRIORS', 'GATES']) {
    assert.ok(name in idx, name);
  }
});
