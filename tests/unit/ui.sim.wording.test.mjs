// Integration (V4-D verify): the simulation catalogs (sim, course, score) never call a simulated number measured,
// exact or accurate (V04-SPEC §B.1 / §H: every simulated stroke is an estimate; validity is never 'valid'), and never
// borrow the 'valid' validity word.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cat = (loc, ns) => JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n', loc, `${ns}.json`), 'utf8'));
const BAN = {
  'zh-Hant': /量到|量測|實測|測得|精確|精準|準確|準度/,
  en: /\b(measured|measures|exact(ly)?|accurate(ly)?|accuracy|precise(ly)?|precision)\b/i,
};

for (const loc of ['zh-Hant', 'en']) {
  test(`${loc}: sim / course / score catalogs have no "measured" / "accurate" wording`, () => {
    const valid = cat(loc, 'validity').valid;
    const bad = [];
    for (const ns of ['sim', 'course', 'score']) {
      for (const [k, v0] of Object.entries(cat(loc, ns))) {
        const v = typeof v0 === 'string' ? v0 : Object.values(v0).join(' | ');
        if (BAN[loc].test(v) || v.includes(valid)) bad.push(`${ns}.${k}: ${v}`);
      }
    }
    assert.deepEqual(bad, []);
  });
}
