// V04-SPEC §G.3 V4-A acceptance 1–2: golf-round/1 validator, golf-shot/2 rev 2 (tracks.club_px), the 9 new reason codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  validateRound, validateLabRecord, ROUND_SCHEMA, ROUND_MAX_BYTES, REPLAY_TOLERANCE_M,
} from '../../app/src/contract/round.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { REASON_CODE_LIST, MODEL_CODES, RC } from '../../app/src/contract/reason-codes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const strip = ({ _expect, ...rest }) => rest;
const ROUNDS = 'tests/fixtures/rounds';
const roundFiles = readdirSync(join(ROOT, ROUNDS)).filter((f) => f.endsWith('.json')).sort();

test('the 9 V04-SPEC §F.3 codes exist (47 in all), in order after the 38, with zh-Hant + en short/long/fix; 4 are model codes', () => {
  const NEW = ['PROVISIONAL', 'GAPPING_PRIOR', 'REFERENCE_PRIOR', 'SIDE_SAMPLED', 'MANUAL_ENTRY', 'LIE_ADJUSTED', 'AUTO_PUTT', 'AUTO_CHIP', 'FAULT_INCONCLUSIVE'];
  assert.equal(REASON_CODE_LIST.length, 47);
  assert.deepEqual(REASON_CODE_LIST.slice(38), NEW);
  for (const c of ['GAPPING_PRIOR', 'REFERENCE_PRIOR', 'AUTO_PUTT', 'AUTO_CHIP']) assert.ok(MODEL_CODES.includes(c), c);
  for (const loc of ['zh-Hant', 'en']) {
    const cat = read(`app/i18n/${loc}/reason.json`);
    for (const c of NEW) for (const f of ['short', 'long', 'fix']) assert.ok(typeof cat[`${c}.${f}`] === 'string' && cat[`${c}.${f}`].length > 0, `${loc} ${c}.${f}`);
  }
  const out = spawnSync(process.execPath, [join(ROOT, 'scripts/check_contract.mjs')], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /\(47 reason codes;/);
});

test('every valid_* round fixture passes; every bad_* fails and names its rule', () => {
  const valid = roundFiles.filter((f) => f.startsWith('valid_'));
  const bad = roundFiles.filter((f) => f.startsWith('bad_'));
  assert.deepEqual(valid, ['valid_18_parkland_1p_finished.json', 'valid_9_links_2p.json', 'valid_manual_only.json']);
  assert.ok(bad.length >= 10, `${bad.length} bad fixtures`);
  for (const f of valid) {
    const r = validateRound(read(`${ROUNDS}/${f}`));
    assert.equal(r.ok, true, `${f}: ${JSON.stringify(r.errors.slice(0, 3))}`);
  }
  for (const f of bad) {
    const raw = read(`${ROUNDS}/${f}`);
    assert.equal(`bad_${raw._expect}.json`, f);
    const r = validateRound(strip(raw));
    assert.equal(r.ok, false, f);
    assert.ok(r.errors.some((e) => e.rule === raw._expect && e.msg.includes(raw._expect)), `${f}: ${JSON.stringify(r.errors.slice(0, 3))}`);
  }
});

test('valid fixtures cover the spec shapes: 9 / 18 holes, par 72, 1–2 players, manual-only, penalty, schema id', () => {
  const r18 = read(`${ROUNDS}/valid_18_parkland_1p_finished.json`);
  assert.equal(r18.schema, ROUND_SCHEMA);
  assert.equal(r18.course.holes.reduce((s, h) => s + h.par, 0), 72);
  assert.deepEqual([3, 4, 5].map((p) => r18.course.holes.filter((h) => h.par === p).length), [4, 10, 4]);
  assert.ok(r18.strokes.some((s) => s.penalty === 1 && s.event === 'water'));
  const r9 = read(`${ROUNDS}/valid_9_links_2p.json`);
  assert.deepEqual([3, 4, 5].map((p) => r9.course.holes.filter((h) => h.par === p).length), [2, 5, 2]);
  assert.equal(r9.players.length, 2);
  const man = read(`${ROUNDS}/valid_manual_only.json`);
  assert.ok(man.strokes.every((s) => s.source === 'manual' && s.shot_id === null && s.carry.reason_codes.includes(RC.MANUAL_ENTRY)));
  for (const r of [r9, r18, man]) for (const s of r.strokes) assert.notEqual(s.carry.validity, 'valid');
});

test('size_limit (256 KB) and replay_matches (injected replayRound, tolerance 0.05 m)', () => {
  const r = read(`${ROUNDS}/valid_9_links_2p.json`);
  const big = structuredClone(r);
  big.players[0].name = 'x'.repeat(ROUND_MAX_BYTES);
  assert.ok(validateRound(big).errors.some((e) => e.rule === 'size_limit'));
  const exact = (x) => ({ strokes: x.strokes.map((s) => ({ rest: { ...s.rest } })) });
  assert.equal(validateRound(r, { replayRound: exact }).ok, true);
  const off = (x) => ({ strokes: x.strokes.map((s, i) => ({ rest: { x: s.rest.x + (i === 3 ? REPLAY_TOLERANCE_M * 2 : 0), y: s.rest.y } })) });
  const res = validateRound(r, { replayRound: off });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.rule === 'replay_matches' && e.path === 'strokes.3.rest'));
  const pending = () => { throw Object.assign(new Error('pending'), { code: 'PACKAGE_PENDING' }); };
  assert.ok(validateRound(r, { replayRound: pending }).errors.some((e) => e.rule === 'replay_matches' && e.msg.includes('PACKAGE_PENDING')));
});

test('golf-lab/1 record shape', () => {
  const rec = { shot_id: 's', view: 'dtl', algo: { version: 'lab-1', sha256: 'abc' }, computed_at: '2026-11-07T10:00:00.000Z',
    faults: [{ id: 'early_extension', status: 'possible', value: 0.06, sigma: 0.02, threshold: 0.05, event: 'impact', reason_codes: [RC.FAULT_INCONCLUSIVE] },
      { id: 'sway', status: 'unknown', value: null, sigma: null, threshold: 0.06, event: 'top', reason_codes: [RC.VIEW_DEPTH_AXIS] }] };
  assert.equal(validateLabRecord(rec).ok, true);
  assert.equal(validateLabRecord({ ...rec, faults: [{ ...rec.faults[0], reason_codes: [] }] }).ok, false);
  assert.equal(validateLabRecord({ ...rec, faults: [{ ...rec.faults[1], reason_codes: [] }] }).ok, false);
  assert.equal(validateLabRecord({ ...rec, view: 'top' }).ok, false);
});

test('golf-shot/2 rev 2: tracks.club_px is accepted; a frame going backwards fails with tracks_club_frame_increasing', () => {
  const good = read('tests/fixtures/v4/shot_v2_club_px.json');
  assert.ok(good.tracks.club_px.length > 0 && good.tracks.club_px.length <= 40);
  assert.equal(validateShot(good).ok, true, JSON.stringify(validateShot(good).errors.slice(0, 3)));
  const bad = read('tests/fixtures/v4/bad_shot_tracks_club_frame_increasing.json');
  const r = validateShot(strip(bad));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.msg.includes('tracks_club_frame_increasing')), JSON.stringify(r.errors));
  // shape: [frame, u, v] only
  const four = structuredClone(good);
  four.tracks.club_px[0] = [...four.tracks.club_px[0], 3];
  assert.equal(validateShot(four).ok, false);
});

test('every existing golf-shot/2 valid fixture still passes', () => {
  const dir = 'tests/fixtures/shots/v2';
  const files = readdirSync(join(ROOT, dir)).filter((f) => /^valid_.*\.json$/.test(f));
  assert.ok(files.length >= 4);
  for (const f of files) assert.equal(validateShot(read(`${dir}/${f}`)).ok, true, f);
});

test('scripts/make_v4_fixtures.mjs --check: the committed fixtures are what the script writes', () => {
  const out = spawnSync(process.execPath, [join(ROOT, 'scripts/make_v4_fixtures.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
});
