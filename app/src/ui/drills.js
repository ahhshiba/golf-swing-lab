// ui/drills.js — practice drills list (LAUNCH-MONITOR-SPEC §3.1, §3.5; screen 'drills', lazy). Owner: LM-E.
// Cards per template (drills-card[data-template]) → a setup sheet → 開始 (drills-start) makes a seeded drill
// (practice/drills.js makeDrill), stores it in repo.drills, sets app.drill and opens the 'drill' screen.
// Above the cards: drills in progress (drills-resume); below: recent finished ones (open the result view).
// e2e state (screenshot matrix): drills:setup opens the target drill's setup sheet (the screen the matrix never showed).
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t, fmtNum, fmtDate } from '../i18n/index.js';
import { parseInput, unitLabel, convert } from '../i18n/units.js';
import { CLUBS } from '../session/settings.js';
import { newId, nowIso } from '../session/ids.js';
import { clubName } from './glossary.js';
import { DRILL_TEMPLATES, makeDrill, progressOf, summaryOf, templateOf } from '../practice/drills.js';

const CLUB_IDS = CLUBS.map((c) => c[0]);
const MIN_TARGET_M = 10;
const MAX_TARGET_M = 300;

/** All drills of the repo, newest first ([] without a repo). */
export async function listDrills(app) {
  if (!app.repo?.drills) return [];
  try {
    return (await app.repo.drills.list()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  } catch (e) {
    app.errors?.report?.(e, { where: 'drills.list', silent: true });
    return [];
  }
}

function randomSeed() {
  try { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; } catch (_) { return Math.floor(Math.random() * 2 ** 32); }
}

/** Median carry (m) per club from the player's saved shots (≥ 3 shots), for the full-bag test targets. */
async function ownCarries(app) {
  const out = {};
  try {
    const by = new Map();
    for (const s of await app.repo.shots.list()) {
      const v = s?.metrics?.carry_m?.value;
      if (s.deleted || !Number.isFinite(v) || !s.club?.type) continue;
      if (!by.has(s.club.type)) by.set(s.club.type, []);
      by.get(s.club.type).push(v);
    }
    for (const [c, xs] of by) {
      if (xs.length < 3) continue;
      xs.sort((a, b) => a - b);
      const m = xs.length >> 1;
      out[c] = xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
    }
  } catch (_) { /* no shots: reference targets */ }
  return out;
}

export function templateTitle(id) { return t(`drill.template.${id}.title`); }

export function mountDrills(root, app) {
  let drills = [];

  async function start(templateId, opts) {
    const now = nowIso();
    let targets = opts.targets;
    if (templateId === 'clubs3' && app.repo) targets = await ownCarries(app);
    const drill = makeDrill(templateId, { ...opts, targets, seed: randomSeed(), drill_id: newId('drill'), created_at: now });
    if (app.repo?.drills) {
      try { await app.repo.drills.put(drill); } catch (e) { app.errors?.report?.(e, { where: 'drills.put' }); return; }
    }
    app.drill.set(drill);
    app.nav.go('drill', { drill_id: drill.drill_id });
  }

  function setupSheet(tpl) {
    const units = app.units();
    const du = units.distance;
    const opts = { clubs: [], count: tpl.count, perClub: tpl.perClub };
    const box = h('div.drill-setup', {});
    const go = C.button({ label: t('drill.setup.start'), variant: 'primary', size: 'lg', block: true, icon: 'play', testid: 'drills-start', onClick: () => { s.close(); start(tpl.id, opts); } });
    const fields = [h('p.hint', t(`drill.template.${tpl.id}.how`))];
    if (tpl.kind === 'target') {
      const dflt = du === 'yd' ? 100 : 90;
      opts.targets = [convert(dflt, du, 'm')];
      opts.clubs = ['7i'];
      const input = h('input', { type: 'text', inputmode: 'decimal', value: String(dflt), id: 'drill-target-input', 'data-testid': 'drills-target-input', 'aria-describedby': 'drill-target-hint' });
      const hint = h('p.hint#drill-target-hint', t('drill.setup.target_hint', { min: fmtNum(convert(MIN_TARGET_M, 'm', du)), max: fmtNum(convert(MAX_TARGET_M, 'm', du)), unit: unitLabel(du) }));
      input.addEventListener('input', () => {
        const v = parseInput(input.value, du);
        const ok = Number.isFinite(v) && v >= MIN_TARGET_M && v <= MAX_TARGET_M;
        if (ok) opts.targets = [v];
        hint.classList.toggle('bad', !ok);
        go.setReason(ok ? null : t('drill.setup.target_bad'));
      });
      fields.push(h('label.field', { for: 'drill-target-input' }, h('span.field-label', t('drill.setup.target'))),
        h('div.input-suffix', {}, input, h('span.suffix', unitLabel(du))), hint,
        h('p.field-label', t('drill.setup.club')),
        C.chipRow({ items: CLUB_IDS.map((c) => [c, clubName(c)]), value: '7i', label: t('drill.setup.club'), onChange: (v) => { opts.clubs = [v]; } }),
        h('p.field-label', t('drill.setup.count')),
        C.chipRow({ items: [5, 10, 15, 20].map((n) => [n, fmtNum(n)]), value: tpl.count, label: t('drill.setup.count'), onChange: (v) => { opts.count = v; } }));
    } else if (tpl.kind === 'gapping') {
      opts.clubs = CLUB_IDS.slice();
      const toggles = CLUB_IDS.map((c) => {
        const b = h('button.chip.drill-club', { type: 'button', 'aria-pressed': 'true', 'data-club': c }, clubName(c));
        b.addEventListener('click', () => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          opts.clubs = CLUB_IDS.filter((x) => (x === c ? on : opts.clubs.includes(x)));
          go.setReason(opts.clubs.length ? null : t('drill.setup.clubs_none'));
        });
        return b;
      });
      fields.push(h('p.field-label', t('drill.setup.clubs')), h('div.drill-club-grid', { role: 'group', 'aria-label': t('drill.setup.clubs') }, toggles),
        h('p.field-label', t('drill.setup.per_club')),
        C.chipRow({ items: [3, 5, 7, 10].map((n) => [n, fmtNum(n)]), value: tpl.perClub, label: t('drill.setup.per_club'), onChange: (v) => { opts.perClub = v; } }));
    } else if (tpl.id === 'distance18') {
      fields.push(h('p.field-label', t('drill.setup.club')),
        C.chipRow({ items: [['', t('drill.setup.any_club')], ...CLUB_IDS.map((c) => [c, clubName(c)])], value: '', label: t('drill.setup.club'), onChange: (v) => { opts.clubs = v ? [v] : []; } }));
    }
    fields.push(h('p.hint', t('drill.compare_note')));
    box.append(...fields, h('div.sheet-actions', {}, go));
    const s = C.sheet({ title: templateTitle(tpl.id), content: box, testid: 'drills-setup' });
    s.open();
  }

  function card(tpl) {
    return h('button.card.drill-card', { type: 'button', 'data-testid': 'drills-card', 'data-template': tpl.id, onclick: () => setupSheet(tpl) },
      h('span.dc-head', {}, C.icon(tpl.kind === 'gapping' ? 'ruler' : 'target'), h('span.dc-title', templateTitle(tpl.id))),
      h('span.dc-body', t(`drill.template.${tpl.id}.body`)),
      h('span.dc-meta', t(`drill.template.${tpl.id}.meta`)));
  }

  function render() {
    const active = drills.filter((d) => d.status === 'active');
    const done = drills.filter((d) => d.status === 'done').slice(0, 5);
    const row = (d, result) => {
      const p = progressOf(d);
      const sc = summaryOf(d).score;
      return C.listRow({
        icon: templateOf(d.template)?.kind === 'gapping' ? 'ruler' : 'target', title: templateTitle(d.template),
        subtitle: [fmtDate(d.created_at), t('drill.progress', { done: p.done, total: p.total })].join(' · '),
        value: result && sc ? fmtNum(sc.mean) : null, testid: result ? 'drills-past' : 'drills-resume',
        onClick: () => { if (!result) app.drill.set(d); app.nav.go('drill', { drill_id: d.drill_id, view: result ? 'result' : null }); },
      });
    };
    clear(root,
      C.screenHeader({ title: app.screenTitle('drills'), back: true, onBack: () => app.nav.back() }),
      h('p.hint.drills-lead', t('drill.list.lead')),
      active.length ? [h('h2.section-title', t('drill.list.active')), h('div.list-group', {}, active.map((d) => row(d, false)))] : null,
      h('h2.section-title', t('drill.list.choose')),
      h('div.drill-cards', {}, DRILL_TEMPLATES.map(card)),
      done.length ? [h('h2.section-title', t('drill.list.done')), h('div.list-group', {}, done.map((d) => row(d, true)))] : null);
  }

  app.e2e?.registerState?.('drills', 'setup', async () => { const tpl = templateOf('target'); if (tpl) setupSheet(tpl); });

  return {
    async show() {
      render();
      drills = await listDrills(app);
      render();
    },
  };
}
