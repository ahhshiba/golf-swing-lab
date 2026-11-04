import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../app/src/contract');
const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));

const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/window|document|navigator/, 'browser globals'],
  [/\bself\b|\bglobalThis\b/, 'global object'],
  [/setTimeout|setInterval|requestAnimationFrame/, 'timers'],
  [/\bDate\b|performance\.now/, 'clock'],
  [/location\.hash|history\.(pushState|replaceState)/, 'routing'],
  [/https?:\/\//, 'hard-coded URL'],
  [/\beval\s*\(|new\s+Function/, 'eval'],
  [/\brequire\s*\(|from\s+['"]node:|\bprocess\./, 'Node-only API'],
  [/structuredClone/, 'structuredClone (use the local clone)'],
];

test('contract sources are pure and browser-safe', () => {
  for (const f of ['enums.js', 'index.js', 'metric.js', 'reason-codes.js', 'shot.js', 'validate.js']) assert.ok(files.includes(f), f);
  for (const f of files) {
    const src = readFileSync(join(DIR, f), 'utf8');
    for (const [re, what] of FORBIDDEN) assert.ok(!re.test(src), `${f}: contains ${what}`);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(/^\.{1,2}\/.*\.js$/.test(m[1]), `${f}: import '${m[1]}' must be relative with .js`);
      assert.ok(m[1].startsWith('./') || m[1].startsWith('../geom/'), `${f}: import '${m[1]}' reaches outside contract and geom`);
    }
  }
});

test('index.js starts with an API summary and re-exports every public name', async () => {
  const src = readFileSync(join(DIR, 'index.js'), 'utf8');
  assert.ok(src.startsWith('//') && src.includes('API summary'));
  const idx = await import('../../app/src/contract/index.js');
  for (const f of files.filter((x) => x !== 'index.js')) {
    const mod = await import(`../../app/src/contract/${f}`);
    for (const name of Object.keys(mod).filter((k) => k !== 'default')) assert.ok(name in idx, `${name} from ${f} missing in index.js`);
  }
  for (const name of ['RC', 'REASON_CODES', 'describe', 'metricValue', 'metricNull', 'downgrade', 'validateShot', 'validate',
    'validateMetric', 'assertValid', 'newShot', 'bumpRevision', 'METRIC_IDS', 'EVENTS', 'ContractError']) {
    assert.ok(name in idx, name);
  }
  for (const name of Object.keys(idx)) {
    if (/^[a-z]/.test(name)) assert.ok(src.includes(name), `API summary does not mention ${name}`);
  }
});

test('reason-codes.js still defines every code the F3 contract names, and the RC/describe exports', async () => {
  const { REASON_CODES, RC, describe } = await import('../../app/src/contract/reason-codes.js');
  // the 26 codes that existed when the contract was written; adding codes is allowed, removing is not
  const original = ['VIEW_DEPTH_AXIS', 'VIEW_PLANE_MISMATCH', 'FPS_TOO_LOW', 'TRACK_TOO_SHORT', 'TRACK_MAY_BE_SHORT',
    'LAUNCH_DIR_UNOBSERVABLE', 'DEPENDS_ON_NULL', 'SPIN_ASSUMED', 'WIND_IGNORED', 'TIMESTAMPS_NOMINAL', 'TIMEBASE_SUSPECT',
    'SETUP_UNVERIFIED', 'CALIB_STALE', 'PRESET_MISMATCH', 'DEPTH_DRIFT_SUSPECT', 'ROLLING_SHUTTER_ASSUMED',
    'BODY_PLANE_ASSUMED', 'NO_GRAVITY_REF', 'AUDIO_UNAVAILABLE', 'THERMAL_DEGRADED', 'TEE_LIFT_ASSUMED', 'POSE_LOW_VISIBILITY',
    'EVENTS_UNCERTAIN', 'OUT_OF_FRAME', 'IMPLAUSIBLE_VALUE', 'NOT_IMPLEMENTED'];
  for (const c of original) {
    assert.ok(c in REASON_CODES, c);
    assert.equal(RC[c], c);
    assert.equal(describe(c), REASON_CODES[c]);
  }
  assert.ok(Object.isFrozen(REASON_CODES) && Object.isFrozen(RC));
  assert.equal(describe('NOPE'), null);
});
