// events/ and metrics/ are pure modules (docs/interfaces.md §1): no DOM, timers, randomness, URLs, Node-only
// imports; relative .js imports; index.js starts with an API summary and re-exports every module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../app/src');
const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/\b(window|document|navigator|self)\s*\./, 'browser globals'],
  [/\bglobalThis\b/, 'global object'],
  [/setTimeout|setInterval|requestAnimationFrame|Date\.now|performance\.now/, 'timers / clock'],
  [/location\.hash|history\.(pushState|replaceState)/, 'routing'],
  [/https?:\/\//, 'hard-coded URL'],
  [/\beval\s*\(|new\s+Function/, 'eval'],
  [/\brequire\s*\(|from\s+['"]node:/, 'Node-only import'],
];

for (const dir of ['events', 'metrics']) {
  const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.js'));
  test(`${dir}: sources are pure and browser-safe`, () => {
    assert.ok(files.length >= 5, files.join(','));
    for (const f of files) {
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      for (const [re, what] of FORBIDDEN) assert.ok(!re.test(src), `${dir}/${f}: contains ${what}`);
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        assert.ok(/^\.\.?\//.test(m[1]) && m[1].endsWith('.js'), `${dir}/${f}: import '${m[1]}' must be relative with .js`);
      }
      // reason codes only through RC.<NAME>
      assert.ok(!/reason_codes\s*:\s*\[\s*['"]/.test(src) && !/codes\.push\(\s*['"]/.test(src), `${dir}/${f}: bare reason code`);
    }
  });
  test(`${dir}/index.js re-exports every module and starts with an API summary`, async () => {
    const src = readFileSync(join(ROOT, dir, 'index.js'), 'utf8');
    assert.ok(src.startsWith('//') && src.includes('API summary'));
    const idx = await import(`../../app/src/${dir}/index.js`);
    for (const f of files.filter((x) => x !== 'index.js')) {
      const mod = await import(`../../app/src/${dir}/${f}`);
      for (const name of Object.keys(mod)) assert.ok(name in idx, `${name} from ${f} missing in ${dir}/index.js`);
    }
  });
}
