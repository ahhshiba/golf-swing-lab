// V04-SPEC §G.3 V4-C acceptance 8: the course model / generator and sim/** are pure modules: no ui/ imports, no
// document / window, no clock, no global randomness; and they are lazy (never in the shell).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = [
  ...['model', 'detmath', 'generate', 'styles', 'validate'].map((f) => `app/src/course/${f}.js`),
  ...readdirSync(join(ROOT, 'app/src/sim')).filter((f) => f.endsWith('.js')).map((f) => `app/src/sim/${f}`),
];
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('no ui/ imports, no DOM, no clock, no Math.random in course model/generator and sim/**', () => {
  for (const f of FILES) {
    const src = code(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(!/from\s+['"][^'"]*\/ui\//.test(src) && !/import\(\s*['"][^'"]*\/ui\//.test(src), `${f} imports ui/`);
    assert.ok(!/\b(document|window|navigator|localStorage|indexedDB)\b/.test(src), `${f} touches the DOM`);
    assert.ok(!/Date\.now|new Date\(|performance\.now|Math\.random/.test(src), `${f} uses the clock or Math.random`);
  }
});

test('sim/** and course/{model,…} are lazy: nothing in the shell imports them statically', async () => {
  const { isLazyPath } = await import('../../scripts/build.mjs');
  for (const f of FILES) assert.ok(isLazyPath(f.replace(/^app\//, '')), f);
});
