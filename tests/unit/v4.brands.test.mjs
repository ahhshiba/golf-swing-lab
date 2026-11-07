// V04-SPEC §I, §G.3 V4-A acceptance 5: scripts/check_brands.mjs. The banned words are assembled at run time so this
// file never contains them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBrands, jsStrings } from '../../scripts/check_brands.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/check_brands.mjs');
const COMPETITOR = ['Golf', 'r'].join('');
const LM = ['Track', 'man'].join('');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-brands-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('a tree with the competitor name and an accuracy claim fails (exit 1) and lists both', () => {
  const dir = tree({
    'README.md': `Better than ${COMPETITOR} in every way.\n`,
    'app/i18n/zh-Hant/x.json': '{ "x.claim": "九成監測器準確率 90%" }\n',
    'app/i18n/en/x.json': '{ "x.claim": "fine" }\n',
  });
  try {
    const out = run('--root', dir);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /FAIL competitor README\.md:1/);
    assert.match(out.stdout, /FAIL accuracy-claim app\/i18n\/zh-Hant\/x\.json:1/);
    const { findings } = checkBrands(dir);
    assert.deepEqual([...new Set(findings.map((f) => f.rule))].sort(), ['accuracy-claim', 'competitor']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the other rules: lm brand in app/, feature names in strings only, vendor ban with the camera-axis exception, English claims', () => {
  const dir = tree({
    'app/src/a.js': `// ${LM} comparison lives in docs only\nexport const x = 1;\n`,
    'app/src/b.js': `// highlight${'s'} reel (a comment: allowed)\nconst file = \`golf-swing-lab-highlight${'s'}-\${stamp}.mp4\`;\n`,
    'app/src/c.js': '// Camera frame (OpenCV): +x right\nimport cv from "./opencv.js";\n',
    'app/i18n/en/y.json': '{ "y.a": "95% accuracy versus radar" }\n',
    'app/styles/s.css': '* { -webkit-tap-highlight-color: transparent; }\n',
    'docs/notes.md': `${LM} is fine in docs.\n`,
  });
  try {
    const f = checkBrands(dir).findings.map((x) => `${x.rule} ${x.path}:${x.line}`).sort();
    assert.deepEqual(f, [
      'accuracy-claim app/i18n/en/y.json:1',
      'feature-names app/src/b.js:2',
      'lm-brand app/src/a.js:1',
      'vendor-ban app/src/c.js:2',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a build output root (precache-manifest.json) is scanned as dist/: vendor binaries skipped, i18n claims caught', () => {
  const dir = tree({
    'precache-manifest.json': '{}\n',
    'i18n/en.json': '{ "$tree": 1, "a": "accurate to 99 %" }\n',
    'vendor/x/lib.js': 'opencv inside a vendored library\n',
  });
  try {
    const f = checkBrands(dir).findings.map((x) => `${x.rule} ${x.path}`);
    assert.deepEqual(f, ['accuracy-claim dist/i18n/en.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('jsStrings keeps quoted and template-literal text, drops comments and code', () => {
  const s = jsStrings("// note\nconst a = 'one'; const b = `two-${x}-three`; /* gone */ foo(\"four\");\n");
  for (const w of ['one', 'two-', '-three', 'four']) assert.ok(s.includes(w), w);
  assert.ok(!s.includes('note') && !s.includes('gone') && !s.includes('const'));
});

test('the clean repo (tracked files + dist/) passes: exit 0', () => {
  const out = run('--quiet');
  assert.equal(out.status, 0, out.stdout + out.stderr);
});
