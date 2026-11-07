// V04-SPEC §G.0 interface freeze (V4-A drop 1): screens and state, lazy file lists, the frozen stub exports, the
// feature settings (owner decisions §J), i18n namespaces. docs/V04-INTERFACES.md is the index of what is checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SUB_SCREENS, DATA_SCREENS, ALL_SCREENS, tabOf } from '../../app/src/state.js';
import { isLazyPath, LAZY_FILES, LAZY_I18N_NAMESPACES } from '../../scripts/build.mjs';
import { loadSettings, saveSettings } from '../../app/src/session/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(ROOT, 'app');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The frozen cross-package interface (V04-SPEC §G.0-4): module → export names; functions throw PACKAGE_PENDING. */
export const FROZEN = Object.freeze({
  'quick/estimate.js': ['quickEstimate'],
  'ui/quickcard.js': ['mountQuickCard'],
  'course/generate.js': ['generateCourse', 'COURSE_GENERATOR'],
  'course/validate.js': ['validateCourse'],
  'course/model.js': ['lieAt'],
  'sim/engine.js': ['shotOutcome'],
  'sim/round.js': ['playStroke', 'scorecard', 'replayRound'],
  'sim/putting.js': ['autoPutt'],
  'sim/recommend.js': ['recommendClub'],
  'course/draw2d.js': ['drawHole2d'],
  'course/draw3d.js': ['createFlyover'],
  'ui/sim-banner.js': ['mountSimBanner'],
  'share/compose.js': ['composeShotVideo'],
  'share/card.js': ['drawShotCard', 'drawSessionCard', 'drawRoundCard'],
  'ui/share.js': ['openShareSheet'],
  'share/trails.js': ['TRAIL_TOKENS'],
  'lab/lines.js': ['computeLines'],
  'lab/overlay.js': ['drawLines'],
  'lab/faults.js': ['evaluateFaults'],
  'lab/trends.js': ['faultTrends'],
  'lab/drills.js': ['LAB_DRILLS'],
  'quick/settings.js': ['normalizeQuick', 'QUICK_DEFAULTS'],
  'sim/settings.js': ['normalizeSim', 'SIM_DEFAULTS', 'SIM_OPTIONS', 'MANUAL_FEEDS_GAPPING'],
  'share/settings.js': ['normalizeShare', 'SHARE_DEFAULTS', 'TRAIL_IDS'],
  'lab/settings.js': ['normalizeLab', 'LAB_DEFAULTS', 'LAB_LINE_IDS'],
  'contract/round.js': ['validateRound', 'validateLabRecord', 'ROUND_SCHEMA', 'LAB_SCHEMA'],
  'ui/course.js': ['mountCourse'],
  'ui/round.js': ['mountRound'],
  'ui/scorecard.js': ['mountScorecard'],
  'ui/lab.js': ['mountLab'],
  'ui/patterns.js': ['mountPatterns'],
});
const NEW_SCREENS = { course: 'mountCourse', round: 'mountRound', scorecard: 'mountScorecard', lab: 'mountLab', patterns: 'mountPatterns' };

test('state: 5 new sub-screens, 4 of them data screens; tabs (lab keeps the tab it was opened from)', () => {
  for (const id of Object.keys(NEW_SCREENS)) assert.ok(SUB_SCREENS.includes(id) && ALL_SCREENS.includes(id), id);
  for (const id of ['round', 'scorecard', 'lab', 'patterns']) assert.ok(DATA_SCREENS.includes(id), id);
  assert.ok(!DATA_SCREENS.includes('course'));
  assert.equal(tabOf('course'), 'practice');
  assert.equal(tabOf('round', 'history'), 'practice');
  assert.equal(tabOf('scorecard'), 'practice');
  assert.equal(tabOf('patterns'), 'history');
  assert.equal(tabOf('lab', 'history'), 'history');
  assert.equal(tabOf('lab', 'practice'), 'practice');
});

test('main.js: SCREEN_MODULES maps the 5 screens to their lazy modules; SCREEN_STYLES; app.sim + app.loadStyles wired', () => {
  const src = read('app/src/main.js');
  for (const [id, fn] of Object.entries(NEW_SCREENS)) assert.match(src, new RegExp(`${id}: \\['\\./ui/${id}\\.js', '${fn}'\\]`), id);
  assert.match(src, /SCREEN_STYLES = Object\.freeze\(\{ course: 'sim', round: 'sim', scorecard: 'sim', lab: 'lab', patterns: 'lab' \}\)/);
  assert.match(src, /sim: createSimState\(\)/);
  assert.match(src, /loadStyles: createStyleLoader\(document\)/);
  assert.match(src, /await app\.loadStyles\(SCREEN_STYLES\[id\]\)/);
  const html = read('app/index.html');
  for (const id of Object.keys(NEW_SCREENS)) assert.match(html, new RegExp(`<section data-screen="${id}" [^>]*data-i18n-aria-label="screen\\.${id}\\.title" hidden></section>`), id);
  assert.ok(!/screens\/(sim|lab|share)\.css/.test(html), 'index.html must not link the lazy screen CSS');
});

test('every 0.4.0 module and the 3 screen stylesheets are lazy; the frozen files exist with their exports', async () => {
  for (const rel of Object.keys(FROZEN)) {
    assert.ok(isLazyPath(`src/${rel}`), `src/${rel} must be lazy`);
    assert.ok(LAZY_FILES.includes(`src/${rel}`), `src/${rel} in LAZY_FILES`);
  }
  for (const css of ['sim', 'lab', 'share']) {
    assert.ok(isLazyPath(`styles/screens/${css}.css`) && fs.existsSync(path.join(APP, `styles/screens/${css}.css`)), css);
  }
  // future files of the owning packages are lazy by pattern already (B–F only add files)
  for (const rel of ['src/quick/carry-table.js', 'src/course/detmath.js', 'src/course/styles.js', 'src/course/palette.js', 'src/sim/lies.js',
    'src/sim/rules.js', 'src/sim/source.js', 'src/sim/params.js', 'src/share/timeline.js', 'src/lab/phases.js', 'src/lab/params.js']) assert.ok(isLazyPath(rel), rel);
  assert.ok(!isLazyPath('src/contract/index.js') && !isLazyPath('src/ui/home.js') && !isLazyPath('src/main.js'));
  for (const [rel, names] of Object.entries(FROZEN)) {
    const mod = await import(pathToFileURL(path.join(APP, 'src', rel)).href);
    for (const n of names) assert.ok(n in mod, `${rel} exports ${n}`);
  }
});

test('stubs: every frozen function of B–F throws { code: PACKAGE_PENDING }; constants have their frozen values', async () => {
  const stubs = {
    'quick/estimate.js': ['quickEstimate'], 'ui/quickcard.js': ['mountQuickCard'], 'course/generate.js': ['generateCourse'],
    'course/validate.js': ['validateCourse'], 'course/model.js': ['lieAt'], 'sim/engine.js': ['shotOutcome'],
    'sim/round.js': ['playStroke', 'scorecard', 'replayRound'], 'sim/putting.js': ['autoPutt'], 'sim/recommend.js': ['recommendClub'],
    'course/draw2d.js': ['drawHole2d'], 'course/draw3d.js': ['createFlyover'], 'ui/sim-banner.js': ['mountSimBanner'],
    'share/card.js': ['drawShotCard', 'drawSessionCard', 'drawRoundCard'], 'lab/lines.js': ['computeLines'], 'lab/overlay.js': ['drawLines'],
    'lab/faults.js': ['evaluateFaults'], 'lab/trends.js': ['faultTrends'],
  };
  for (const [rel, names] of Object.entries(stubs)) {
    const mod = await import(pathToFileURL(path.join(APP, 'src', rel)).href);
    for (const n of names) {
      // a package that has landed replaces its stub: then the function no longer throws PACKAGE_PENDING (skip it)
      let code = null;
      try { mod[n]({}, {}, {}); } catch (e) { code = e?.code ?? null; }
      if (code !== null) assert.equal(code, 'PACKAGE_PENDING', `${rel} ${n}`);
    }
  }
  for (const [rel, n] of [['share/compose.js', 'composeShotVideo'], ['ui/share.js', 'openShareSheet']]) {
    const mod = await import(pathToFileURL(path.join(APP, 'src', rel)).href);
    await mod[n]({}, {}).then(() => {}, (e) => assert.equal(e?.code, 'PACKAGE_PENDING', `${rel} ${n}`));
  }
  const { TRAIL_TOKENS } = await import('../../app/src/share/trails.js');
  assert.deepEqual(TRAIL_TOKENS.map((x) => x.token), Array.from({ length: 8 }, (_, i) => `--trail-${i + 1}`));
  const { COURSE_GENERATOR } = await import('../../app/src/course/generate.js');
  assert.equal(COURSE_GENERATOR, 'course-1');
});

test('feature settings: session/settings.js keeps quick / sim / share / lab as given (merging one level); normalisers apply the owner defaults (§J)', async () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
  const st = mem();
  const s0 = loadSettings(st, { languages: ['zh-TW'] });
  for (const k of ['quick', 'sim', 'share', 'lab']) assert.equal(s0[k], undefined, k);
  saveSettings({ quick: { enabled: false }, sim: { puttSkill: 10 }, lab: 'junk' }, st);
  saveSettings({ sim: { ob: 'stroke_distance' } }, st);
  const s1 = loadSettings(st);
  assert.deepEqual(s1.quick, { enabled: false });
  assert.deepEqual(s1.sim, { puttSkill: 10, ob: 'stroke_distance' });
  assert.equal(s1.lab, undefined);

  const { normalizeQuick } = await import('../../app/src/quick/settings.js');
  const { normalizeSim, MANUAL_FEEDS_GAPPING } = await import('../../app/src/sim/settings.js');
  const { normalizeShare } = await import('../../app/src/share/settings.js');
  const { normalizeLab, LAB_LINE_IDS } = await import('../../app/src/lab/settings.js');
  assert.deepEqual(normalizeQuick(undefined), { enabled: true });
  assert.deepEqual(normalizeSim(undefined), { unobservedSide: 'sample', putting: 'auto', puttSkill: 20, ob: 'drop_2', maxScore: 'double_par', tees: 'middle', autoChipM: 0, flyover: true });
  assert.equal(MANUAL_FEEDS_GAPPING, false);
  assert.equal(normalizeSim({ autoChipM: 5 }).autoChipM, 10);
  assert.equal(normalizeSim({ autoChipM: 99 }).autoChipM, 40);
  assert.equal(normalizeSim({ puttSkill: 15 }).puttSkill, 20);
  assert.deepEqual(normalizeShare(undefined), { ballColour: 'trail-1', clubColour: 'trail-4', layout: 'portrait', card: true, lines: false, faceMask: false, appMark: false });
  assert.notEqual(normalizeShare({ ballColour: 'trail-4', clubColour: 'trail-4' }).clubColour, 'trail-4');
  assert.notEqual(normalizeShare({ ballColour: 'trail-2', clubColour: 'trail-2' }).clubColour, 'trail-2');
  assert.deepEqual(normalizeLab(undefined), { lines: [...LAB_LINE_IDS], dynamic: false, sensitivity: 'standard' });
  assert.equal(LAB_LINE_IDS.length, 9);
  assert.deepEqual(normalizeLab({ lines: ['target_line', 'spine', 'nope'] }).lines, ['spine', 'target_line']);
});

test('i18n: 8 lazy namespaces with owners, both locales, same keys; core keys for the screens, home entries, settings', () => {
  const NS = ['quick', 'sim', 'course', 'score', 'share', 'lab', 'fault', 'patterns'];
  const index = JSON.parse(read('app/i18n/namespaces.json'));
  for (const ns of NS) {
    assert.ok(LAZY_I18N_NAMESPACES.includes(ns), `${ns} lazy`);
    assert.ok(index.namespaces.includes(ns), `${ns} listed`);
    const en = JSON.parse(read(`app/i18n/en/${ns}.json`));
    const zh = JSON.parse(read(`app/i18n/zh-Hant/${ns}.json`));
    assert.ok(Object.keys(en).length > 0, ns);
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), ns);
  }
  assert.deepEqual(index.owners['v4-b'], ['quick']);
  assert.deepEqual(index.owners['v4-d'], ['sim', 'course', 'score']);
  assert.deepEqual(index.owners['v4-e'], ['share']);
  assert.deepEqual(index.owners['v4-f'], ['lab', 'fault', 'patterns']);
  for (const loc of ['zh-Hant', 'en']) {
    const screen = JSON.parse(read(`app/i18n/${loc}/screen.json`));
    for (const id of Object.keys(NEW_SCREENS)) assert.ok(screen[`${id}.title`], `${loc} screen.${id}.title`);
    const home = JSON.parse(read(`app/i18n/${loc}/home.json`));
    for (const k of ['course', 'course_hint', 'lab', 'lab_hint']) assert.ok(home[k], `${loc} home.${k}`);
    const settings = JSON.parse(read(`app/i18n/${loc}/settings.json`));
    assert.ok(settings.quick && settings['quick.hint'], `${loc} settings.quick`);
    assert.ok(JSON.parse(read(`app/i18n/${loc}/score.json`)).disclaimer, `${loc} score.disclaimer`);
    assert.equal(Object.keys(JSON.parse(read(`app/i18n/${loc}/fault.json`))).length, 11, `${loc} fault names`);
  }
  // product names (§F.5)
  assert.equal(JSON.parse(read('app/i18n/zh-Hant/screen.json'))['course.title'], '模擬球場');
  assert.equal(JSON.parse(read('app/i18n/en/screen.json'))['lab.title'], 'Swing Lab');
  assert.equal(JSON.parse(read('app/i18n/en/share.json')).title, 'Tracer Clip');
  assert.equal(JSON.parse(read('app/i18n/zh-Hant/quick.json')).name, '速報');
});

test('package.json is 0.4.0; scripts/budget_delta.mjs measures against the recorded 0.3.0 baseline', async () => {
  assert.equal(JSON.parse(read('package.json')).version, '0.4.0');
  const base = JSON.parse(read('tests/fixtures/v4/budget-baseline.json'));
  assert.deepEqual([base.commit, base.shell_bytes, base.precache_bytes], ['9f429da', 976739, 31880602]);
  const { budgetDelta } = await import('../../scripts/budget_delta.mjs');
  const r = budgetDelta({ totals: { shell_bytes: 987739, precache_bytes: 31900602 } }, base, { max: 11000 });
  assert.deepEqual([r.shellDelta, r.precacheDelta, r.shellOk, r.precacheOk], [11000, 20000, true, null]);
  assert.equal(budgetDelta({ totals: { shell_bytes: 987740, precache_bytes: 1 } }, base, { max: 11000 }).shellOk, false);
});
