// ui/course.js — Virtual Course home (V04-SPEC §C.4): the round list (in progress / finished) and the new-round sheet.
// Lazy screen 'course' (Practice tab; styles/screens/sim.css via app.loadStyles before mount). Owner V4-D.
//
// New round (course-new → sheet course-new-sheet): style (parkland / links / desert / mixed), 9 / 18 holes, the course
// number (a 6-digit seed shown and typed: the same number replays the same course), tees, 1–4 players (name,
// handedness, you / guest, driver carry for the reference distances, putting level) and the rules (left/right when it
// cannot be seen: sampled / straight mode; putting simulated / typed in; OB; max score; auto chip; fly-over). Start
// (course-start) generates the course (course/generate.js), creates the golf-round/1 record (sim/round.js newRound),
// saves it (repo.rounds.put) and opens the round. The sheet's choices are remembered in settings.sim.
// e2e state: course:new opens the sheet.

import { h, clear } from './dom.js';
import * as C from './components.js';
import { t, fmtDate } from '../i18n/index.js';
import { parseInput, unitLabel, convert } from '../i18n/units.js';
import { saveSettings } from '../session/settings.js';
import { newId, nowIso } from '../session/ids.js';
import { normalizeSim, SIM_OPTIONS, AUTO_CHIP_RANGE_M } from '../sim/settings.js';

const STYLES = Object.freeze(['parkland', 'links', 'desert', 'mixed']);
const MAX_PLAYERS = 4;
const SEED_MAX = 999999;

/** A fresh 6-digit course number (crypto when available). */
export function randomCourseNumber() {
  try { return 1 + (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % SEED_MAX); } catch (_) { return 1 + Math.floor(Math.random() * SEED_MAX); }
}

/** '000042' style display of a course number. */
export const courseNumber = (seed) => String(Math.max(0, Math.floor(Number(seed) || 0)) % 1000000).padStart(6, '0');

/** Parse a typed course number: 1–6 digits → integer, else null. */
export function parseCourseNumber(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  return Number(s);
}

export function mountCourse(root, app, opts = {}) {
  let sheet = null;

  async function rounds() {
    if (!app.repo?.rounds) return [];
    try {
      return (await app.repo.rounds.list()).sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)));
    } catch (e) {
      app.errors?.report?.(e, { where: 'course.list', silent: true });
      return [];
    }
  }

  function row(r) {
    const done = r.strokes?.length ? Math.max(...r.strokes.map((s) => s.hole)) : 0;
    const names = (r.players ?? []).map((p) => p.name || t(p.kind === 'guest' ? 'course.player.guest' : 'course.player.owner')).join(', ');
    const sub = [t(`course.style.${r.course?.style ?? 'mixed'}`), t('course.holes', { n: r.course?.holes_n ?? 0 }), `${t('course.seed')} ${courseNumber(r.course?.seed)}`, fmtDate(r.created_at)].join(' · ');
    const active = r.status === 'active';
    return C.listRow({
      icon: 'flag', title: names, subtitle: sub, value: active ? t('course.progress', { n: Math.max(1, r.current?.hole ?? done) }) : t(`course.status.${r.status}`),
      testid: active ? 'course-resume' : 'course-finished-row', chevron: true,
      onClick: () => app.nav.go(active ? 'round' : 'scorecard', { round_id: r.round_id }),
    });
  }

  async function render() {
    const list = await rounds();
    const active = list.filter((r) => r.status === 'active');
    const old = list.filter((r) => r.status !== 'active');
    const newBtn = C.button({ label: t('course.new'), icon: 'plus', variant: 'primary', size: 'lg', block: true, testid: 'course-new', onClick: () => openNew() });
    const parts = [C.screenHeader({ title: app.screenTitle('course'), back: true, onBack: () => app.nav.back() }),
      h('p.course-intro', t('course.intro')), newBtn];
    if (!app.repo?.rounds) parts.push(C.notice({ variant: 'caution', title: t('course.unsaved'), testid: 'course-unsaved' }));
    if (!list.length) parts.push(C.emptyState({ icon: 'flag', title: t('course.empty.title'), body: t('course.empty.body'), testid: 'course-empty' }));
    if (active.length) parts.push(h('section.course-group', {}, h('h2.section-title', t('course.active')), h('div.list', {}, active.map(row))));
    if (old.length) parts.push(h('section.course-group', {}, h('h2.section-title', t('course.finished')), h('div.list', {}, old.slice(0, 30).map(row))));
    parts.push(h('p.hint.course-note', t('course.note')));
    clear(root, ...parts);
  }

  function playerEditor(p, i, onRemove) {
    const u = app.units().distance;
    const name = h('input', { type: 'text', value: p.name, maxlength: 24, autocomplete: 'off', 'data-testid': `course-player-name-${i}`, oninput: (e) => { p.name = e.target.value; } });
    const carry = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-testid': `course-player-carry-${i}`,
      value: p.driver_carry_m ? String(Math.round(convert(p.driver_carry_m, 'm', u))) : '', oninput: (e) => { p.carryText = e.target.value; } });
    return h('fieldset.course-player', { 'data-testid': 'course-player' },
      h('legend', t('course.player_n', { n: i + 1 })),
      h('label.field', {}, h('span.field-label', t('course.player.name')), name),
      C.segmented({ options: [['owner', t('course.player.owner')], ['guest', t('course.player.guest')]], value: p.kind, label: t('course.player.kind'), testid: `course-player-kind-${i}`, onChange: (v) => { p.kind = v; } }),
      C.segmented({ options: [['right', t('course.hand.right')], ['left', t('course.hand.left')]], value: p.handedness, label: t('course.player.hand'), testid: `course-player-hand-${i}`, onChange: (v) => { p.handedness = v; } }),
      h('label.field', {}, h('span.field-label', t('course.player.carry', { unit: unitLabel(u) })), carry, h('span.hint', t('course.player.carry_hint'))),
      C.segmented({ options: SIM_OPTIONS.puttSkill.map((k) => [String(k), t(`course.putt.${k}`)]), value: String(p.putt_skill), label: t('course.putt_skill'), testid: `course-player-putt-${i}`, onChange: (v) => { p.putt_skill = Number(v); } }),
      onRemove ? C.button({ label: t('course.player.remove'), variant: 'plain', icon: 'x', testid: `course-player-remove-${i}`, onClick: onRemove }) : null);
  }

  function openNew() {
    const sim = normalizeSim(app.settings()?.sim);
    const f = {
      style: STYLES.includes(app.settings()?.sim?.style) ? app.settings().sim.style : 'parkland', holes: 9, seed: randomCourseNumber(), tees: sim.tees,
      unobservedSide: sim.unobservedSide, putting: sim.putting, ob: sim.ob, maxScore: sim.maxScore, autoChipM: sim.autoChipM, flyover: sim.flyover,
    };
    const players = [{ name: '', kind: 'owner', handedness: app.settings()?.handedness === 'left' ? 'left' : 'right', driver_carry_m: null, putt_skill: sim.puttSkill }];
    const box = h('div.course-new');
    const seedIn = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', 'data-testid': 'course-seed', value: courseNumber(f.seed), 'aria-describedby': 'course-seed-hint' });
    const err = h('p.field-error', { role: 'alert', 'data-testid': 'course-new-error' });
    const plist = h('div.course-players');
    const paint = () => {
      clear(plist, ...players.map((p, i) => playerEditor(p, i, players.length > 1 ? () => { players.splice(i, 1); paint(); } : null)),
        players.length < MAX_PLAYERS ? C.button({ label: t('course.player.add'), icon: 'plus', testid: 'course-player-add', onClick: () => {
          players.push({ name: '', kind: 'guest', handedness: 'right', driver_carry_m: null, putt_skill: sim.puttSkill });
          paint();
        } }) : null);
    };
    paint();
    const chipOpts = [0, 20, 30, AUTO_CHIP_RANGE_M[1]].map((m) => [String(m), m ? t('course.rules.chip_m', { d: Math.round(convert(m, 'm', app.units().distance)), unit: unitLabel(app.units().distance) }) : t('course.rules.off')]);
    clear(box,
      h('p.hint', t('course.hint.face_on')),
      C.segmented({ options: STYLES.map((s) => [s, t(`course.style.${s}`)]), value: f.style, label: t('course.style'), testid: 'course-style', onChange: (v) => { f.style = v; } }),
      h('p.hint.course-style-hint', t('course.style.hint')),
      C.segmented({ options: [['9', t('course.holes', { n: 9 })], ['18', t('course.holes', { n: 18 })]], value: String(f.holes), label: t('course.holes_label'), testid: 'course-holes', onChange: (v) => { f.holes = Number(v); } }),
      h('label.field', {}, h('span.field-label', t('course.seed')), seedIn, h('span#course-seed-hint.hint', t('course.seed_hint'))),
      C.button({ label: t('course.seed_new'), variant: 'plain', testid: 'course-seed-new', onClick: () => { seedIn.value = courseNumber(randomCourseNumber()); } }),
      C.segmented({ options: SIM_OPTIONS.tees.map((x) => [x, t(`course.tees.${x}`)]), value: f.tees, label: t('course.tees'), testid: 'course-tees', onChange: (v) => { f.tees = v; } }),
      h('h3.course-sub', t('course.players')), plist,
      h('h3.course-sub', t('course.rules')),
      C.segmented({ options: [['sample', t('course.rules.sample')], ['center', t('course.rules.center')]], value: f.unobservedSide, label: t('course.rules.side'), testid: 'course-rule-side', onChange: (v) => { f.unobservedSide = v; } }),
      C.segmented({ options: [['auto', t('course.rules.putt_auto')], ['manual', t('course.rules.putt_manual')]], value: f.putting, label: t('course.rules.putting'), testid: 'course-rule-putting', onChange: (v) => { f.putting = v; } }),
      C.segmented({ options: [['drop_2', t('course.rules.ob_drop')], ['stroke_distance', t('course.rules.ob_stroke')]], value: f.ob, label: t('course.rules.ob'), testid: 'course-rule-ob', onChange: (v) => { f.ob = v; } }),
      C.segmented({ options: [['double_par', t('course.rules.max_double')], ['none', t('course.rules.max_none')]], value: f.maxScore, label: t('course.rules.max'), testid: 'course-rule-max', onChange: (v) => { f.maxScore = v; } }),
      C.segmented({ options: chipOpts, value: String(chipOpts.some(([v]) => Number(v) === f.autoChipM) ? f.autoChipM : 0), label: t('course.rules.chip'), testid: 'course-rule-chip', onChange: (v) => { f.autoChipM = Number(v); } }),
      C.switchRow({ label: t('course.rules.flyover'), checked: f.flyover, testid: 'course-rule-flyover', onChange: (v) => { f.flyover = v; } }),
      err,
      C.button({ label: t('course.start'), variant: 'primary', size: 'lg', block: true, testid: 'course-start', onClick: () => start(f, players, seedIn, err) }));
    sheet = C.sheet({ title: t('course.new'), content: box, testid: 'course-new-sheet' });
    sheet.open();
    return sheet;
  }

  async function start(f, players, seedIn, err) {
    const seed = parseCourseNumber(seedIn.value);
    if (seed === null) { err.textContent = t('course.bad_seed'); seedIn.focus(); return; }
    const u = app.units().distance;
    const ps = [];
    for (const [i, p] of players.entries()) {
      let carry = null;
      const txt = p.carryText ?? (p.driver_carry_m ? String(convert(p.driver_carry_m, 'm', u)) : '');
      if (String(txt).trim()) {
        carry = parseInput(txt, u);
        if (!(typeof carry === 'number' && carry >= 60 && carry <= 380)) { err.textContent = t('course.bad_carry', { n: i + 1 }); return; }
      }
      ps.push({ player_id: `p${i + 1}`, name: p.name.trim().slice(0, 24), kind: p.kind, handedness: p.handedness, driver_carry_m: carry, putt_skill: p.putt_skill });
    }
    const simPatch = { tees: f.tees, unobservedSide: f.unobservedSide, putting: f.putting, ob: f.ob, maxScore: f.maxScore, autoChipM: f.autoChipM, flyover: f.flyover };
    const sim = normalizeSim({ ...app.settings()?.sim, ...simPatch });
    try {
      const [{ generateCourse }, { newRound }] = await Promise.all([import('../course/generate.js'), import('../sim/round.js')]);
      const course = generateCourse({ seed, style: f.style, holes: f.holes, tees: f.tees });
      const round = newRound({ round_id: newId('round'), created_at: nowIso(), app_version: app.version?.() ?? 'unknown', course, settings: sim, players: ps });
      if (app.repo?.rounds) await app.repo.rounds.put(round);
      try { app.updateSettings(saveSettings({ sim: { ...simPatch, style: f.style } })); } catch (_) { /* settings are a convenience */ }
      sheet?.close();
      app.nav.go('round', app.repo?.rounds ? { round_id: round.round_id } : { round });
    } catch (e) {
      app.errors?.report?.(e, { where: 'course.start' });
    }
  }

  app.e2e?.registerState?.('course', 'new', async () => { openNew(); });

  return { show: () => render() };
}
