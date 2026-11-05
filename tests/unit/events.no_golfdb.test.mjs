// PRODUCT-SPEC §7.1 / §7.3 (EV-6): nothing GolfDB-derived ships. No file under app/ (vendor/ excluded; git-ignored
// local research artefacts excluded, they are never in the repository) mentions GolfDB, its split 1 or the research
// model event-tcn-v1, except the model-card field `golfdb` that the import check reads (`golfdb: false`); the clip
// pipeline uses the rules when no owner model is imported; an imported card with golfdb: true is rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { validateEventModel, sha256Hex } from '../../app/src/session/models.js';
import { detectWithTcn } from '../../app/src/pipeline/clip.js';
import { detect } from '../../app/src/events/detect.js';
import { synthSwing } from '../synth/swing.js';
import { ownerModel } from './_owner_model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(ROOT, 'app');
const BAD = /golfdb|split ?1\b|split1|event-tcn-v1/i;
// the model-card field itself (session/models.js, events/card.js check it; calib-conf records golfdb: false)
const CARD_FIELD = /(\.golfdb\b|["']?golfdb["']?\s*(:|!==|===)\s*(false|true)?|card field golfdb)/gi;
// owners of the files that still have hits when this test runs during the parallel phase (PRODUCT-SPEC §8)
const OWNER = [[/^app\/src\/ui\/(about|settings|developer|privacy|help|licences)\.js$/, 'F'], [/^app\/src\/ui\/(replay|shot|import|history|teach)\.js$|^app\/src\/store\/labels\.js$/, 'C'],
  [/^app\/src\/workers\/|^app\/src\/store\//, 'D'], [/^app\/src\/(main|state)\.js$|^app\/index\.html$|^app\/src\/ui\/(dom|components)\.js$/, 'A'], [/^app\/(src\/(events|pipeline\/clip|session\/models)|i18n\/[^/]+\/(model|events)\.json)/, 'E']];

function ignored() {
  try {
    const out = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', 'app'], { cwd: ROOT, encoding: 'utf8' });
    return new Set(out.split('\0').filter(Boolean));
  } catch { return new Set(); }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (path.relative(APP, p) !== 'vendor') walk(p, out); } else out.push(p);
  }
  return out;
}

test('no GolfDB / split-1 / event-tcn-v1 reference anywhere under app/ (the model-card field excepted)', () => {
  const skip = ignored();
  const hits = [];
  for (const f of walk(APP)) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (skip.has(rel)) continue;
    const buf = fs.readFileSync(f);
    if (buf.includes(0)) continue; // binary (images, wasm)
    buf.toString('utf8').split('\n').forEach((line, i) => {
      if (BAD.test(line.replace(CARD_FIELD, ''))) {
        const owner = OWNER.find(([re]) => re.test(rel))?.[1] ?? '?';
        hits.push(`${rel}:${i + 1} [${owner}] ${line.trim().slice(0, 140)}`);
      }
    });
  }
  assert.deepEqual(hits, [], `GolfDB references in shipped paths:\n${hits.join('\n')}`);
});

test('the clip pipeline detects events with the rules when no owner model is imported', () => {
  const s = synthSwing({ seed: 2, view: 'dtl', fps: 60 });
  for (const tcn of [null, undefined]) {
    const r = detectWithTcn(detect, s.poseSeq, { view: 'dtl' }, tcn);
    assert.equal(r.source, 'rules');
    assert.equal(r.events.impact.source, 'rules');
  }
});

test('an imported model whose card says golfdb: true is rejected (non-research build)', async () => {
  const { json, bin } = ownerModel({ card: { golfdb: true } });
  const r = await validateEventModel(json, bin, { sha256: (b) => sha256Hex(b, webcrypto.subtle) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'model.error.card_third_party'));
  const r2 = await validateEventModel({ ...json, model_card: { ...json.model_card, golfdb: undefined } }, bin, { sha256: (b) => sha256Hex(b, webcrypto.subtle) });
  assert.equal(r2.ok, false, 'a missing golfdb field is not false');
});
