import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const TRACK = join(ROOT, 'app/src/track');
const files = readdirSync(TRACK).filter((f) => f.endsWith('.js'));

const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/window|document|navigator/, 'browser globals'],
  [/\bself\b|\bglobalThis\b/, 'global object'],
  [/setTimeout|setInterval|requestAnimationFrame/, 'timers'],
  [/location\.hash|history\.(pushState|replaceState)/, 'routing'],
  [/https?:\/\//, 'hard-coded URL'],
  [/\beval\s*\(|new\s+Function/, 'eval'],
  [/\brequire\s*\(|from\s+['"]node:/, 'Node-only import'],
  [/\bDate\.now\b|new Date\b/, 'wall-clock date'],
];

test('track sources are pure and browser-safe (no DOM, timers, randomness, Node-only imports)', () => {
  assert.deepEqual(files.sort(), ['ball.js', 'bgsub.js', 'ccl.js', 'club.js', 'index.js', 'pipeline.js']);
  for (const f of files) {
    const src = readFileSync(join(TRACK, f), 'utf8');
    for (const [re, what] of FORBIDDEN) assert.ok(!re.test(src), `${f}: contains ${what}`);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${f}: import '${m[1]}' must be relative`);
      assert.ok(m[1].endsWith('.js'), `${f}: import '${m[1]}' needs the .js extension`);
      // a pure module may use geom and contract only
      if (m[1].startsWith('../')) assert.ok(/^\.\.\/(geom|contract)\//.test(m[1]), `${f}: unexpected cross-module import ${m[1]}`);
    }
  }
});

test('reason codes are used only through RC.<NAME> and exist in contract/reason-codes.js', async () => {
  const { REASON_CODES } = await import('../../app/src/contract/reason-codes.js');
  for (const f of files) {
    const src = readFileSync(join(TRACK, f), 'utf8');
    for (const m of src.matchAll(/RC\.([A-Z_]+)/g)) assert.ok(m[1] in REASON_CODES, `${f}: RC.${m[1]} is not defined`);
    for (const code of Object.keys(REASON_CODES)) assert.ok(!new RegExp(`['"\`]${code}['"\`]`).test(src), `${f}: bare reason-code string '${code}'`);
  }
});

test('index.js re-exports every public name of every module and starts with an API summary', async () => {
  const src = readFileSync(join(TRACK, 'index.js'), 'utf8');
  assert.ok(src.startsWith('//') && src.includes('API'));
  const idx = await import('../../app/src/track/index.js');
  for (const f of files.filter((x) => x !== 'index.js')) {
    const mod = await import(`../../app/src/track/${f}`);
    for (const name of Object.keys(mod)) assert.ok(name in idx, `${name} from ${f} missing in index.js`);
  }
  for (const name of ['medianBackground', 'RunningBackground', 'diffFrame', 'findComponents', 'detectRestBall', 'detectTee',
    'detectCandidates', 'trackBall', 'findDeparture', 'trackClubHead', 'analyzeClip']) assert.ok(name in idx, name);
});

test('the synthetic renderer does not import physics or any app module except geom/rng', () => {
  const src = readFileSync(join(ROOT, 'tests/synth/render.js'), 'utf8');
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.equal(m[1], '../../app/src/geom/rng.js');
  assert.ok(!/Math\.random/.test(src));
});
