// The integration-core pipeline files are pure (docs/interfaces.md §1): no DOM / browser globals, no timers,
// no randomness, no URL routing, no external URLs, reason codes only through RC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = ['app/src/pipeline/assemble.js', 'app/src/pipeline/frames.js'];
const FORBIDDEN = [
  /\bwindow\./, /\bdocument\./, /\bnavigator\./, /\bself\./, /location\.hash/, /history\.(pushState|replaceState)/,
  /https?:\/\//, /\beval\(/, /new Function/, /Math\.random/, /setTimeout|setInterval/, /\bDate\.now\b|new Date\(/,
];

test('pipeline/assemble.js and frames.js: no forbidden globals, URLs, clocks or randomness', () => {
  for (const f of FILES) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const re of FORBIDDEN) assert.ok(!re.test(src), `${f} matches ${re}`);
    // reason codes are referenced as RC.NAME, never as bare upper-snake string literals
    const bare = src.match(/'(?:[A-Z]+_){1,}[A-Z]+'/g) ?? [];
    assert.deepEqual(bare, [], `${f}: bare reason-code strings ${bare.join(', ')}`);
  }
});
