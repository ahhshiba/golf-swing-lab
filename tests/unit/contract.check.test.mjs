import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runChecks, stringLiterals, rcReferences, lineOf } from '../../scripts/check_contract.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const values = (src) => stringLiterals(src).map((l) => l.value);

// ---------------------------------------------------------------------------------------- lexer

test('stringLiterals: quotes, escapes, templates', () => {
  assert.deepEqual(values(`const a = 'x'; const b = "y"; const c = \`z\`;`), ['x', 'y', 'z']);
  assert.deepEqual(values(`'it\\'s' + "say \\"hi\\""`), ["it\\'s", 'say \\"hi\\"']);
  assert.deepEqual(values('`a${b}c`'), []); // a template with substitutions is not a plain literal
  assert.deepEqual(values('`${"inner"}`'), ['inner']); // but code inside the substitution is scanned
  assert.deepEqual(values('`${`deep`}`'), ['deep']);
  assert.deepEqual(values('`a${ {k: "v"} .k }b`'), ['v']);
});

test('stringLiterals skips comments and regular expression literals', () => {
  assert.deepEqual(values(`// 'FPS_TOO_LOW'\nconst a = 1; /* "FPS_TOO_LOW" */ const b = 'ok';`), ['ok']);
  assert.deepEqual(values(`const re = /['"]FPS_TOO_LOW['"]/g; const s = 'after';`), ['after']);
  assert.deepEqual(values(`const re = /[/'"]/; const s = 'after';`), ['after']);
  assert.deepEqual(values(`x = a / b; y = 'q'; z = c / d;`), ['q']);
  assert.deepEqual(values(`return /'x'/.test(s) ? 'a' : 'b';`), ['a', 'b']);
  assert.deepEqual(values(`const u = 'http://x//y'; // 'no'`), ['http://x//y']);
  assert.deepEqual(values(`if (a) { x = (1) / 2; } y = '1';`), ['1']);
});

test('stringLiterals reports raw text and index; lineOf counts lines', () => {
  const src = `a\nb = 'FPS_TOO_LOW'\n`;
  const [lit] = stringLiterals(src);
  assert.equal(lit.value, 'FPS_TOO_LOW');
  assert.equal(lineOf(src, lit.index), 2);
  assert.equal(lineOf(src, 0), 1);
});

test('rcReferences finds RC.NAME uses only', () => {
  const src = `RC.FPS_TOO_LOW; x.RC.OK2; SRC.NOT; ARC.NOT; RC.<NAME>; const {RC} = y; RC.hasOwn; $RC.NO;`;
  assert.deepEqual(rcReferences(src).map((r) => r.name), ['FPS_TOO_LOW', 'OK2', 'hasOwn']);
});

// ---------------------------------------------------------------------------------------- the real tree

test('check_contract passes on the real tree', async () => {
  const { problems, info } = await runChecks();
  assert.deepEqual(problems, []);
  assert.ok(info.some((i) => /valid \+ \d+ bad golf-shot\/1 fixtures/.test(i)));
  assert.ok(info.some((i) => /valid \+ [7-9]\d* bad golf-shot\/2 fixtures/.test(i)), info.join('; '));
  assert.ok(info.includes('47 reason codes'));
});

test('node scripts/check_contract.mjs exits 0', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check_contract.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /check_contract: OK/);
});

// ---------------------------------------------------------------------------------------- failure paths

/** Copy the parts of the project the checks look at into a temp dir, apply `mutate(root)`, run the checks there. */
async function withRoot(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'gsl-contract-'));
  try {
    for (const p of ['package.json', 'app/src/contract', 'app/src/geom', 'app/i18n/zh-Hant/reason.json', 'app/i18n/en/reason.json', 'schema', 'tests/fixtures/shots', 'scripts/check_contract.mjs']) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    }
    mutate(dir);
    return await runChecksIn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runChecksIn(dir) {
  const { problems } = await runChecks({ root: dir });
  const r = spawnSync(process.execPath, [join(dir, 'scripts/check_contract.mjs')], { encoding: 'utf8' });
  return { problems, status: r.status, stdout: r.stdout };
}

const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const edit = (dir, rel, fn) => writeFileSync(join(dir, rel), fn(readFileSync(join(dir, rel), 'utf8')));

test('a copy of the tree is clean (control for the failure tests)', async () => {
  const r = await withRoot(() => {});
  assert.deepEqual(r.problems, []);
  assert.equal(r.status, 0);
});

test('unknown RC.NAME and a quoted code name both fail, with file and line; exit code = problem count', async () => {
  const r = await withRoot((d) => put(d, 'app/src/x/mod.js', `import { RC } from '../contract/reason-codes.js';\nexport const a = RC.FPS_TOO_SLOW;\nexport const b = 'FPS_TOO_LOW';\nexport const c = RC.FPS_TOO_LOW; // fine\n`));
  assert.equal(r.problems.length, 2, r.problems.join('\n'));
  assert.ok(r.problems.some((p) => p.includes('app/src/x/mod.js:2') && p.includes('RC.FPS_TOO_SLOW is not defined')));
  assert.ok(r.problems.some((p) => p.includes('app/src/x/mod.js:3') && p.includes("string literal 'FPS_TOO_LOW'")));
  assert.equal(r.status, 2);
  assert.match(r.stdout, /FAIL rc-ref/);
});

test('comments and regexes mentioning a code name are not literals', async () => {
  const r = await withRoot((d) => put(d, 'app/src/x/ok.js', `// 'FPS_TOO_LOW' in a comment\nexport const re = /"FPS_TOO_LOW"/;\nexport const d = "other";\n`));
  assert.deepEqual(r.problems, []);
});

test('reason-codes.js itself may name the codes', async () => {
  const r = await withRoot((d) => edit(d, 'app/src/contract/reason-codes.js', (t) => `${t}\nexport const demo = 'FPS_TOO_LOW';\n`));
  assert.deepEqual(r.problems, []);
  const other = await withRoot((d) => edit(d, 'app/src/contract/enums.js', (t) => `${t}\nexport const demo = 'FPS_TOO_LOW';\n`));
  assert.equal(other.problems.length, 1);
});

test('a code without a Traditional Chinese description fails (zh-Hant reason.json <CODE>.long)', async () => {
  const R = 'app/i18n/zh-Hant/reason.json';
  const setLong = (v) => (t) => JSON.stringify({ ...JSON.parse(t), 'NOT_IMPLEMENTED.long': v }, null, 2);
  const r = await withRoot((d) => edit(d, R, setLong('')));
  assert.ok(r.problems.some((p) => p.includes('NOT_IMPLEMENTED has no description')), r.problems.join('\n'));
  assert.ok(r.status >= 1);
  const m = await withRoot((d) => edit(d, R, (t) => { const o = JSON.parse(t); delete o['NOT_IMPLEMENTED.long']; return JSON.stringify(o); }));
  assert.ok(m.problems.some((p) => p.includes('NOT_IMPLEMENTED has no description')), m.problems.join('\n'));
  const e = await withRoot((d) => edit(d, R, setLong('not available yet')));
  assert.ok(e.problems.some((p) => p.includes('NOT_IMPLEMENTED description is not Chinese')), e.problems.join('\n'));
  const s = await withRoot((d) => edit(d, R, (t) => t.replace('這個版本還沒有提供這個指標', '这个版本还没有提供这个指标')));
  assert.ok(s.problems.some((p) => p.includes('Simplified-only characters')), s.problems.join('\n'));
  const j = await withRoot((d) => put(d, R, '{ not json'));
  assert.ok(j.problems.some((p) => p.includes('reason.json is missing or not valid JSON')), j.problems.join('\n'));
});

test('reason-codes.js holds codes only: prose values or a describe() export fail', async () => {
  const p = await withRoot((d) => edit(d, 'app/src/contract/reason-codes.js', (t) => t.replace(
    'export const REASON_CODES = Object.freeze(Object.fromEntries(REASON_CODE_LIST.map((k) => [k, k])));',
    "export const REASON_CODES = Object.freeze({ ...Object.fromEntries(REASON_CODE_LIST.map((k) => [k, k])), NOT_IMPLEMENTED: 'prose' });")));
  assert.ok(p.problems.some((x) => x.includes('REASON_CODES.NOT_IMPLEMENTED must equal')), p.problems.join('\n'));
  const d2 = await withRoot((d) => edit(d, 'app/src/contract/reason-codes.js', (t) => `${t}\nexport function describe() { return null; }\n`));
  assert.ok(d2.problems.some((x) => x.includes('describe() must not exist')), d2.problems.join('\n'));
});

test('schema problems: invalid JSON, a metric id twice, a missing id, a drifting enum', async () => {
  const a = await withRoot((d) => put(d, 'schema/shot-v1.schema.json', '{ not json'));
  assert.ok(a.problems.some((p) => p.startsWith('schema: ') && p.includes('not valid JSON')));
  const b = await withRoot((d) => edit(d, 'schema/shot-v1.schema.json', (t) => t.replace('"description": "Per-shot result', '"description": "carry_m Per-shot result')));
  assert.ok(b.problems.some((p) => p.includes('carry_m appears 2 times')), b.problems.join('\n'));
  const c = await withRoot((d) => edit(d, 'schema/shot-v1.schema.json', (t) => t.replace('"smash_factor"', '"smash_factr"')));
  assert.ok(c.problems.some((p) => p.includes('smash_factor appears 0 times')), c.problems.join('\n'));
  const e = await withRoot((d) => edit(d, 'schema/shot-v1.schema.json', (t) => t.replace('"SPIN_ASSUMED",', '')));
  assert.ok(e.problems.some((p) => p.includes('reasonCode differs')), e.problems.join('\n'));
});

test('fixture problems: valid one broken, bad one passing, wrong expectation, too few, odd name', async () => {
  const a = await withRoot((d) => edit(d, 'tests/fixtures/shots/valid_dtl_30.json', (t) => t.replace('"schema": "golf-shot/1"', '"schema": "golf-shot/9"')));
  assert.ok(a.problems.some((p) => p.includes('valid_dtl_30.json should be valid')), a.problems.join('\n'));
  const b = await withRoot((d) => edit(d, 'tests/fixtures/shots/bad_measured_true.json', (t) => t.replace('"measured": true', '"measured": false')));
  assert.ok(b.problems.some((p) => p.includes('bad_measured_true.json should be invalid')), b.problems.join('\n'));
  const c = await withRoot((d) => edit(d, 'tests/fixtures/shots/bad_measured_true.json', (t) => t.replace('"_expect": "measured must be false"', '"_expect": "something else"')));
  assert.ok(c.problems.some((p) => p.includes('no error contains "something else"')), c.problems.join('\n'));
  const e = await withRoot((d) => edit(d, 'tests/fixtures/shots/bad_measured_true.json', (t) => t.replace('"_expect": "measured must be false",', '')));
  assert.ok(e.problems.some((p) => p.includes('needs an "_expect"')), e.problems.join('\n'));
  const f = await withRoot((d) => edit(d, 'tests/fixtures/shots/bad_measured_true.json', (t) => t.replace('"_expect": "measured must be false"', '"_expect": "must be false", "x_unused": 1').replace('"measured": true', '"measured": true, "sneaky": 1')));
  assert.ok(f.problems.some((p) => p.includes('should violate exactly 1')), f.problems.join('\n'));
  const g = await withRoot((d) => put(d, 'tests/fixtures/shots/oops.json', '{}'));
  assert.ok(g.problems.some((p) => p.includes('must start with valid_ or bad_')), g.problems.join('\n'));
  const h = await withRoot((d) => rmSync(join(d, 'tests/fixtures/shots/valid_high_behind_240.json')));
  assert.ok(h.problems.some((p) => p.includes('no valid v1 fixture for view high_behind')), h.problems.join('\n'));
});

// ---------------------------------------------------------------------------------------- golf-shot/2 (LM-A drop 1)

test('golf-shot/2: schema v2 drift, a v2 bad fixture that does not name its rule, a broken v2 fixture, a missing .fix', async () => {
  const a = await withRoot((d) => edit(d, 'schema/shot-v2.schema.json', (t) => t.replace('"spin_rate_rpm"', '"spin_rpm"')));
  assert.ok(a.problems.some((p) => p.includes('shot-v2.schema.json: metric id spin_rate_rpm appears 0 times')), a.problems.join('\n'));
  const b = await withRoot((d) => edit(d, 'schema/shot-v2.schema.json', (t) => t.replace('"MIGRATED_V1"', '"MIGRATED"')));
  assert.ok(b.problems.some((p) => p.includes('shot-v2.schema.json: reasonCode differs')), b.problems.join('\n'));
  // the v1 schema stays golf-shot/1: the new codes must not be added to it
  const c = await withRoot((d) => edit(d, 'schema/shot-v1.schema.json', (t) => t.replace('"SLOWMO_CORRECTED"', '"SLOWMO_CORRECTED", "MIGRATED_V1"')));
  assert.ok(c.problems.some((p) => p.includes('shot-v1.schema.json: reasonCode differs')), c.problems.join('\n'));
  const e = await withRoot((d) => edit(d, 'tests/fixtures/shots/v2/bad_flight_t_increasing.json', (t) => t.replace('"_expect": "flight_t_increasing"', '"_expect": "must be greater"').replace('bad_flight_t_increasing', 'x')));
  assert.deepEqual(e.problems, [], 'the _expect substring may differ from the rule, the rule name must still be in the error');
  const f = await withRoot((d) => {
    const from = join(d, 'tests/fixtures/shots/v2/bad_flight_t_increasing.json');
    writeFileSync(join(d, 'tests/fixtures/shots/v2/bad_some_other_rule.json'), readFileSync(from, 'utf8'));
  });
  assert.ok(f.problems.some((p) => p.includes('bad_some_other_rule.json failed, but no error names its rule "some_other_rule"')), f.problems.join('\n'));
  const g = await withRoot((d) => edit(d, 'tests/fixtures/shots/v2/valid_face_on_240.json', (t) => t.replace('"model": "lm-1"', '"model": ""')));
  assert.ok(g.problems.some((p) => p.includes('v2/valid_face_on_240.json should be valid')), g.problems.join('\n'));
  const h = await withRoot((d) => edit(d, 'app/i18n/en/reason.json', (t) => { const o = JSON.parse(t); delete o['MIGRATED_V1.fix']; return JSON.stringify(o); }));
  assert.ok(h.problems.some((p) => p.includes('MIGRATED_V1 has no en reason.json key MIGRATED_V1.fix')), h.problems.join('\n'));
});
