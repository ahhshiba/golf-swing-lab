import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CALIB = join(dirname(fileURLToPath(import.meta.url)), '../../app/src/calib');
const files = readdirSync(CALIB).filter((f) => f.endsWith('.js'));

const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/window|document|navigator/, 'browser globals'],
  [/\bself\b|\bglobalThis\b/, 'global object'],
  [/setTimeout|setInterval|requestAnimationFrame/, 'timers'],
  [/\bDate\b|performance\.now/, 'clock'],
  [/location\.hash|history\.(pushState|replaceState)/, 'routing'],
  [/https?:\/\//, 'hard-coded URL'],
  [/\beval\s*\(|new\s+Function/, 'eval'],
  [/\brequire\s*\(|from\s+['"]node:/, 'Node-only import'],
];

test('calib sources are pure and browser-safe', () => {
  assert.ok(files.length >= 12, files.join(','));
  for (const f of files) {
    const src = readFileSync(join(CALIB, f), 'utf8');
    for (const [re, what] of FORBIDDEN) assert.ok(!re.test(src), `${f}: contains ${what}`);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const p = m[1];
      assert.ok((p.startsWith('./') || p.startsWith('../geom/') || p === '../contract/reason-codes.js') && p.endsWith('.js'),
        `${f}: import '${p}' must be relative (.js) and only from calib, geom or contract/reason-codes`);
    }
  }
});

test('reason codes are only used as RC.<NAME> and every name exists', async () => {
  const { RC } = await import('../../app/src/contract/reason-codes.js');
  for (const f of files) {
    const src = readFileSync(join(CALIB, f), 'utf8');
    for (const m of src.matchAll(/\bRC\.([A-Z_]+)/g)) assert.ok(m[1] in RC, `${f}: RC.${m[1]} is not defined`);
    for (const code of Object.keys(RC)) {
      assert.ok(!new RegExp(`['"\`]${code}['"\`]`).test(src), `${f}: bare string '${code}' (use RC.${code})`);
    }
  }
});

test('index.js re-exports every module and starts with an API summary', async () => {
  const src = readFileSync(join(CALIB, 'index.js'), 'utf8');
  assert.ok(src.startsWith('//') && src.includes('API summary'));
  const idx = await import('../../app/src/calib/index.js');
  for (const f of files.filter((x) => x !== 'index.js')) {
    const mod = await import(`../../app/src/calib/${f}`);
    for (const name of Object.keys(mod)) {
      assert.ok(name in idx, `${name} from ${f} missing in index.js`);
      assert.ok(src.includes(name), `${name} from ${f} missing in the index.js API summary`);
    }
  }
});
