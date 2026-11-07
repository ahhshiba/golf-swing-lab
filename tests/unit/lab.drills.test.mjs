// lab/drills.js (V04-SPEC §E.5): 1–2 in-app cards per fault (about 14), every text in both locales, steps 3–5 lines,
// a contract metric to check, a success goal; no external link anywhere in the lab / fault / patterns text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LAB_DRILLS, drillsFor, drillsForView, drillById } from '../../app/src/lab/drills.js';
import { FAULT_IDS, LAB_PARAMS } from '../../app/src/lab/params.js';
import { METRIC_IDS } from '../../app/src/contract/enums.js';

const cat = (loc, ns) => JSON.parse(fs.readFileSync(new URL(`../../app/i18n/${loc}/${ns}.json`, import.meta.url), 'utf8'));

test('1–2 drills per fault, ~14 in all, unique ids, valid metric / view / goal', () => {
  assert.ok(LAB_DRILLS.length >= 12 && LAB_DRILLS.length <= 16, String(LAB_DRILLS.length));
  assert.equal(new Set(LAB_DRILLS.map((d) => d.id)).size, LAB_DRILLS.length);
  for (const id of FAULT_IDS) {
    const all = LAB_DRILLS.filter((d) => d.fault === id);
    assert.ok(all.length >= 1 && all.length <= 2, id);
    // a disabled rule (overswing: NOT_IMPLEMENTED) offers no card
    assert.equal(drillsFor(id).length, LAB_PARAMS.faults[id].disabled ? 0 : all.length, id);
  }
  assert.ok(!drillsForView('dtl').some((d) => d.fault === 'overswing'));
  for (const d of LAB_DRILLS) {
    assert.ok(METRIC_IDS.includes(d.metric), d.id);
    assert.ok(['face_on', 'dtl', 'high_behind'].includes(d.view), d.id);
    assert.ok(d.success.n > 0 && d.success.n <= d.success.of, d.id);
    assert.ok(Number.isFinite(d.success.below) || Number.isFinite(d.success.above) || FAULT_IDS.includes(d.success.clear), d.id);
    assert.equal(drillById(d.id), d);
  }
  assert.ok(drillsForView('high_behind').some((d) => d.fault === 'tempo_off'));
});

test('drill texts in both locales; steps 3–5 lines; no external links in the lab namespaces', () => {
  for (const loc of ['zh-Hant', 'en']) {
    const lab = cat(loc, 'lab');
    for (const d of LAB_DRILLS) {
      for (const k of ['title', 'goal', 'steps']) assert.ok(lab[`drill.${d.id}.${k}`], `${loc} lab.drill.${d.id}.${k}`);
      const n = lab[`drill.${d.id}.steps`].split('\n').filter(Boolean).length;
      assert.ok(n >= 3 && n <= 5, `${loc} ${d.id}: ${n} steps`);
    }
    for (const id of FAULT_IDS) assert.ok(cat(loc, 'fault')[id] && lab[`what.${id}`], `${loc} ${id}`);
    for (const ns of ['lab', 'fault', 'patterns']) assert.ok(!/https?:|www\./i.test(JSON.stringify(cat(loc, ns))), `${loc} ${ns} has a link`);
  }
});

test('drill goals agree with the rules they practise (lab-1.2.0)', () => {
  // weight_back is pelvis travel < 0 %; slide starts past the lead ankle (≈ 50 %): the step drill aims in between
  const w = drillById('weight_step').success;
  assert.ok(w.above > 0 && w.below <= 50, JSON.stringify(w));
  // over the top is judged from the hand path (no contract metric): its drill succeeds when the rule stops flagging
  assert.equal(drillById('ott_pump').success.clear, 'over_the_top');
});
