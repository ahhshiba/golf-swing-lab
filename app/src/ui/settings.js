// ui/settings.js — Settings (PRODUCT-SPEC §2.3): grouped list — Golfer (hand, height, club & length, ball position),
// Venues, Display (theme incl. Sun, text size note), Live (which numbers, voice), Units, Language, Data & privacy
// (Storage & backup, Privacy), Help & support (Help, Diagnostics, About) and Developer (only with settings.dev).
// Every control saves on change (session/settings.js; storage stays SI, inputs use the user's units).
//
// Pages: the Privacy / Help / Licences / Developer pages are separate modules (ui/privacy.js, help.js, licences.js,
// developer.js). They open as their own screens when index.html has their section (main.js SCREEN_MODULES mounts
// them lazily through mount<Name>(root, app)), otherwise inside this screen (nav.go('settings', { page })), with an internal back stack.
// Storage & backup is a page of this module.
//
//   mountSettings(root, app) -> { show(params), hide() }           params.page: 'storage'|'privacy'|'help'|'licences'|'developer'
//   mountTrustPage(root, app, render, { id }) -> { show, hide }    one page as a full screen (header + back)
//   openTrustPage(app, id, opener)                                 the right way to open a page from anywhere
//   mountPrivacy / mountHelp / mountLicences / mountDeveloper      for main.js (SUB_SCREENS)
//   fmtBytes(n) -> '12.3 MB'                                       trustCtx(app, C) -> ctx for the page renderers

import { createComponents } from './components.js';
import { t, has, msg, getLocale, setLocale, fmtNum, fmtDate, fmtRelativeDays } from '../i18n/index.js';
import { convert, fmtQuantity, parseInput, unitLabel, UNIT_CHOICES } from '../i18n/units.js';

/** Back-button label naming the screen Back returns to (the previous nav stack entry), else the generic "Back". */
function prevTitle(app) {
  const last = app.nav?.stack?.()?.at?.(-1);
  const prev = typeof last === 'string' ? last : last?.screen; // nav.stack() lists screen ids
  return prev && has(`screen.${prev}.title`) ? t(`screen.${prev}.title`) : undefined;
}
import { CLUBS, LIVE_METRIC_CHOICES, THEMES, loadSettings, saveSettings } from '../session/settings.js';
import * as quota from '../store/quota.js';
import * as models from '../session/models.js';
import * as health from '../session/health.js';
import * as checks from '../calib/checks.js';
import { REGISTRY } from '../metrics/registry.js';
import { renderPrivacy } from './privacy.js';
import { renderHelp } from './help.js';
import { renderLicences } from './licences.js';
import { renderDeveloper, applySpecOverlay } from './developer.js';

export const PAGES = Object.freeze(['storage', 'privacy', 'help', 'licences', 'developer']);
const SCREEN_PAGES = Object.freeze(['privacy', 'help', 'licences', 'developer']);
const HEIGHT_RANGE = [1.2, 2.2];
const CLUB_RANGE = [0.7, 1.3];

export function fmtBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n >= 1e9) return `${fmtNum(n / 1e9, { digits: 2 })} GB`;
  if (n >= 1e6) return `${fmtNum(n / 1e6, { digits: 1 })} MB`;
  return `${fmtNum(n > 0 ? Math.max(1, Math.round(n / 1e3)) : 0)} KB`;
}

/** replaceChildren without null/false children (native replaceChildren would print them). */
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

let comps = null;
const components = () => (comps ??= createComponents(globalThis.document));

/** Context handed to the page renderers (privacy.js, help.js, licences.js, developer.js, about.js). */
export function trustCtx(app, C = components(), extra = {}) {
  return {
    C, app, t, has, msg, fmtDate, fmtRelativeDays, fmtBytes, saveSettings, loadSettings,
    registry: REGISTRY, models, health, checks,
    open: (id, opener) => openTrustPage(app, id, opener),
    back: () => app.nav.back(),
    ...extra,
  };
}

function setTitle(title) {
  try { globalThis.document.title = `${title} – ${t('app.name')}`; } catch (_) { /* no DOM */ }
}
function focusH1(root) {
  const h1 = root.querySelector('h1');
  try { h1?.focus({ preventScroll: true }); } catch (_) { /* detached */ }
}

let settingsInstance = null;
/** Open a trust page: as its own screen when the app has that screen, else inside the settings screen. */
export function openTrustPage(app, id, opener = null) {
  const doc = globalThis.document;
  if (SCREEN_PAGES.includes(id) && doc?.querySelector?.(`[data-screen="${id}"]`) && app.nav.has?.(id) !== false) { app.nav.go(id, {}, { opener }); return; }
  if (app.store?.get?.().screen === 'settings' && settingsInstance) { settingsInstance.push(id, opener); return; }
  app.nav.go('settings', { page: id }, { opener });
}

export function mountTrustPage(root, app, render, { id } = {}) {
  root.setAttribute('data-trust-mounted', '');
  return {
    show() {
      const C = components();
      const page = render(trustCtx(app, C));
      root.replaceChildren(
        C.screenHeader({ title: page.title, back: true, onBack: () => app.nav.back(), backLabel: prevTitle(app) }),
        ...page.nodes.filter(Boolean));
      if (id && id !== 'about') setTitle(page.title);
    },
    hide() {},
  };
}

export const mountPrivacy = (root, app) => mountTrustPage(root, app, renderPrivacy, { id: 'privacy' });
export const mountHelp = (root, app) => mountTrustPage(root, app, renderHelp, { id: 'help' });
export const mountLicences = (root, app) => mountTrustPage(root, app, renderLicences, { id: 'licences' });
export const mountDeveloper = (root, app) => mountTrustPage(root, app, renderDeveloper, { id: 'developer' });

// ------------------------------------------------------------------ form helpers
let fid = 0;
function field(C, { label, input, unit, hint, error }) {
  const { h } = C;
  const id = input.id || `set-f-${++fid}`;
  input.id = id;
  return h('div', { class: 'field set-field' },
    h('label', { class: 'field-label', for: id, text: label }),
    h('div', { class: 'set-input' }, input, unit ? h('span', { class: 'set-suffix', 'aria-hidden': 'true', text: unit }) : null),
    hint ? h('p', { class: 'hint', text: hint }) : null,
    error);
}
const errorLine = (C) => C.h('p', { class: 'set-error', role: 'alert', hidden: true });
function showError(el, text) { el.textContent = text ?? ''; el.hidden = !text; }

function group(C, title, ...kids) {
  const { h } = C;
  return h('section', { class: 'set-group' }, h('h2', { class: 'set-group-title', text: title }), ...kids);
}

// ------------------------------------------------------------------ root page
function renderRoot(ctx) {
  const { C, app } = ctx;
  const { h } = C;
  const st = loadSettings();
  const units = st.units;
  const rerender = ctx.rerender ?? (() => {});
  const save = (patch, quiet = false) => {
    const s = saveSettings(patch);
    app.updateSettings?.(s);
    if (!quiet) C.toast.info(t('settings.saved'));
    return s;
  };

  // ---- golfer ----
  const hand = C.segmented({ options: [['right', t('settings.profile.hand.right')], ['left', t('settings.profile.hand.left')]], value: st.handedness, label: t('settings.profile.hand'), testid: 'settings-hand', onChange: (v) => save({ handedness: v }) });
  const heightErr = errorLine(C);
  const heightIn = h('input', { type: 'text', inputmode: units.height === 'ftin' ? 'text' : 'decimal', autocomplete: 'off', 'data-testid': 'settings-height', id: 'set-height',
    placeholder: units.height === 'ftin' ? t('settings.profile.height.placeholder_ftin') : null });
  heightIn.value = units.height === 'ftin' ? fmtQuantity(st.height_m, 'height', units).value : String(Math.round(st.height_m * 100));
  heightIn.addEventListener('change', () => {
    const v = parseInput(heightIn.value, units.height === 'ftin' ? 'ftin' : 'cm');
    if (!(v >= HEIGHT_RANGE[0] && v <= HEIGHT_RANGE[1])) {
      showError(heightErr, t('settings.profile.height.invalid', { min: fmtQuantity(HEIGHT_RANGE[0], 'height', units).text, max: fmtQuantity(HEIGHT_RANGE[1], 'height', units).text }));
      return;
    }
    showError(heightErr, null);
    save({ height_m: Math.round(v * 1000) / 1000 });
  });
  const lenUnit = units.clubLength;
  const lenDigits = lenUnit === 'in' ? 1 : 2;
  const lenErr = errorLine(C);
  const lenIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-testid': 'settings-club-length', id: 'set-len' });
  const showLen = (m) => { lenIn.value = convert(m, 'm', lenUnit).toFixed(lenDigits); };
  showLen(st.club_length_m);
  lenIn.addEventListener('change', () => {
    const v = parseInput(lenIn.value, lenUnit);
    if (!(v >= CLUB_RANGE[0] && v <= CLUB_RANGE[1])) {
      showError(lenErr, t('settings.profile.club_length.invalid', { min: fmtQuantity(CLUB_RANGE[0], 'clubLength', units).text, max: fmtQuantity(CLUB_RANGE[1], 'clubLength', units).text }));
      return;
    }
    showError(lenErr, null);
    save({ club_length_m: Math.round(v * 1000) / 1000 });
  });
  const club = C.chipRow({
    items: CLUBS.map(([type]) => [type, t(`club.${type}`)]), value: st.club_type, label: t('settings.profile.club'), testid: 'settings-club',
    onChange: (v) => { const len = CLUBS.find((c) => c[0] === v)?.[1] ?? st.club_length_m; showLen(len); showError(lenErr, null); save({ club_type: v, club_length_m: len }); },
  });
  const lie = C.segmented({ options: [['mat', t('settings.profile.lie.mat')], ['tee', t('settings.profile.lie.tee')]], value: st.lie, label: t('settings.profile.lie'), testid: 'settings-lie', onChange: (v) => save({ lie: v }) });
  const labelled = (label, control, hint) => h('div', { class: 'field set-field' }, h('span', { class: 'field-label', text: label }), control, hint ? h('p', { class: 'hint', text: hint }) : null);

  const profile = group(C, t('settings.group.profile'), h('div', { class: 'card' },
    labelled(t('settings.profile.hand'), hand, t('settings.profile.hand.hint')),
    field(C, { label: t('settings.profile.height'), input: heightIn, unit: units.height === 'ftin' ? null : unitLabel('cm'), hint: t('settings.profile.height.hint'), error: heightErr }),
    labelled(t('settings.profile.club'), club),
    field(C, { label: t('settings.profile.club_length'), input: lenIn, unit: unitLabel(lenUnit), hint: t('settings.profile.club_length.hint'), error: lenErr }),
    labelled(t('settings.profile.lie'), lie)));

  // ---- venues ----
  const venues = group(C, t('settings.group.venues'), h('div', { class: 'list-group' },
    C.listRow({ icon: 'ruler', title: t('settings.venues.row'), subtitle: t('settings.venues.hint'), testid: 'settings-venues',
      onClick: (e) => { const r = globalThis.document?.querySelector?.('[data-screen="venues"]'); app.nav.go(r && (r.childElementCount || r.hasAttribute('data-mounted')) ? 'venues' : 'venue', {}, { opener: e.currentTarget }); } })));

  // ---- display ----
  const theme = C.segmented({ options: THEMES.map((v) => [v, t(`settings.theme.${v}`)]), value: st.theme, label: t('settings.theme'), testid: 'settings-theme',
    onChange: (v) => { const s = save({ theme: v }, true); app.applyTheme?.(s.theme); } });
  const display = group(C, t('settings.group.display'), h('div', { class: 'card' },
    labelled(t('settings.theme'), theme, t('settings.theme.hint')),
    h('p', { class: 'hint set-note', text: t('settings.text_size.hint') })));

  // ---- live ----
  const metricsErr = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  let chosen = [...st.live.metrics];
  const toggles = LIVE_METRIC_CHOICES.map((id) => {
    const b = h('button', { type: 'button', class: 'set-toggle', 'data-value': id, 'aria-pressed': chosen.includes(id) ? 'true' : 'false' },
      h('span', { class: 'set-toggle-mark', 'aria-hidden': 'true' }, C.icon('check')), h('span', { text: has(`metric.${id}.short`) ? t(`metric.${id}.short`) : t(`metric.${id}.label`) }));
    b.addEventListener('click', () => {
      const on = chosen.includes(id);
      if (on && chosen.length === 1) { metricsErr.textContent = t('settings.live.metrics.min'); return; }
      if (!on && chosen.length >= 3) { metricsErr.textContent = t('settings.live.metrics.max'); return; }
      chosen = on ? chosen.filter((x) => x !== id) : [...chosen, id];
      metricsErr.textContent = '';
      for (const x of toggles) x.setAttribute('aria-pressed', chosen.includes(x.dataset.value) ? 'true' : 'false');
      save({ live: { metrics: chosen } });
    });
    return b;
  });
  const voice = C.switchRow({ label: t('settings.live.voice'), hint: t('settings.live.voice.hint'), checked: st.live.voice, testid: 'settings-voice', onChange: (on) => save({ live: { voice: on } }) });
  const live = group(C, t('settings.group.live'), h('div', { class: 'card' },
    h('div', { class: 'field set-field' }, h('span', { class: 'field-label', id: 'set-live-metrics', text: t('settings.live.metrics') }),
      h('div', { class: 'set-toggles', role: 'group', 'aria-labelledby': 'set-live-metrics', 'data-testid': 'settings-live-metrics' }, toggles),
      h('p', { class: 'hint', text: t('settings.live.metrics.hint') }), metricsErr),
    voice));

  // ---- units ----
  const unitSeg = (dim, testid) => C.segmented({
    options: UNIT_CHOICES[dim].map((u) => [u, unitLabel(u)]), value: units[dim], label: t(`settings.units.${dim}`), testid,
    onChange: (v) => { save({ units: { [dim]: v } }); if (dim === 'height' || dim === 'clubLength') rerender(); },
  });
  const unitRows = [['distance', 'settings-units'], ['speed', 'settings-units-speed'], ['body', 'settings-units-body'], ['clubLength', 'settings-units-club'], ['height', 'settings-units-height']]
    .map(([dim, tid]) => labelled(t(`settings.units.${dim}`), unitSeg(dim, tid)));
  const unitsGroup = group(C, t('settings.group.units'), h('div', { class: 'card' }, unitRows));

  // ---- language ----
  const lang = C.segmented({
    options: [['auto', t('settings.language.auto')], ['zh-Hant', t('settings.language.zh')], ['en', t('settings.language.en')]], value: st.locale, label: t('settings.language'), testid: 'settings-locale',
    onChange: async (v) => { save({ locale: v }, true); C.toast.hide(); await setLocale(v); },
  });
  lang.querySelector?.('[data-value="zh-Hant"]')?.setAttribute('lang', 'zh-Hant');
  lang.querySelector?.('[data-value="en"]')?.setAttribute('lang', 'en');
  const language = group(C, t('settings.group.language'), h('div', { class: 'card' }, labelled(t('settings.language'), lang)));

  // ---- data & privacy, help, developer ----
  const data = group(C, t('settings.group.data'), h('div', { class: 'list-group' },
    C.listRow({ icon: 'download', title: t('settings.storage.row'), testid: 'settings-storage', onClick: (e) => ctx.open('storage', e.currentTarget) }),
    C.listRow({ icon: 'shield', title: t('settings.privacy.row'), testid: 'settings-privacy', onClick: (e) => ctx.open('privacy', e.currentTarget) })));
  const helpG = group(C, t('settings.group.help'), h('div', { class: 'list-group' },
    C.listRow({ icon: 'help', title: t('settings.help.row'), testid: 'settings-help', onClick: (e) => ctx.open('help', e.currentTarget) }),
    C.listRow({ icon: 'info', title: t('settings.diag.row'), subtitle: t('settings.diag.hint'), testid: 'settings-diag', onClick: (e) => app.nav.go('diag', {}, { opener: e.currentTarget }) }),
    C.listRow({ icon: 'info', title: t('settings.about.row'), testid: 'settings-about', onClick: (e) => app.nav.go('about', {}, { opener: e.currentTarget }) })));
  const dev = st.dev ? group(C, t('settings.group.developer'), h('div', { class: 'list-group' },
    C.listRow({ icon: 'settings', title: t('settings.developer.row'), testid: 'settings-developer', onClick: (e) => ctx.open('developer', e.currentTarget) }))) : null;

  return { title: t('screen.settings.title'), nodes: [profile, venues, display, live, unitsGroup, language, data, helpG, dev] };
}

// ------------------------------------------------------------------ storage & backup page
function renderStorage(ctx) {
  const { C, app } = ctx;
  const { h } = C;
  const summary = h('div', { 'data-testid': 'storage-summary' }, h('p', { text: t('settings.storage.calculating') }));
  const evict = h('div', {});
  const cleanup = h('div', {});
  const draw = async () => {
    const est = await quota.estimateStorage?.(globalThis.navigator) ?? { usage: null, quota: null };
    let clips = [];
    let starred = [];
    if (app.repo) {
      try {
        clips = await app.repo.clips.list();
        starred = (await app.repo.shots.list()).filter((s) => s.starred).map((s) => s.shot_id);
      } catch (_) { /* repo closed */ }
    }
    const clipBytes = clips.reduce((a, c) => a + (Number.isFinite(c.bytes) ? c.bytes : 0), 0);
    const practising = Boolean(app.store?.get?.().sessionActive);
    const plan = quota.planCleanup?.({ usage: est.usage, quota: est.quota, clips: quota.policyClips?.(clips) ?? clips, practiceActive: practising, protectShotIds: starred })
      ?? { status: 'unknown', deleteIds: [], freedBytes: 0 };
    put(summary, 
      h('p', { class: 'storage-used', text: Number.isFinite(est.usage) ? (Number.isFinite(est.quota) ? t('settings.storage.used', { used: fmtBytes(est.usage), quota: fmtBytes(est.quota) }) : t('settings.storage.used_only', { used: fmtBytes(est.usage) })) : t('settings.storage.unknown') }),
      Number.isFinite(est.usage) && Number.isFinite(est.quota) && est.quota > 0 ? h('div', { class: 'storage-meter', role: 'img', 'aria-label': t('settings.storage.used', { used: fmtBytes(est.usage), quota: fmtBytes(est.quota) }) }, h('span', { class: 'storage-meter-fill' })) : null,
      h('p', { class: 'hint', text: t('settings.storage.clips', { n: clips.length, size: fmtBytes(clipBytes) }) }),
      app.repo ? null : h('p', { class: 'warn', text: t('settings.storage.no_repo') }),
      plan.lowSpace ? h('p', { class: 'warn', text: t('settings.storage.low') }) : null,
      plan.status === 'over' ? h('p', { class: 'warn', text: t('settings.storage.over') }) : null);
    const fill = summary.querySelector('.storage-meter-fill');
    if (fill) fill.style.transform = `scaleX(${Math.min(1, Math.max(0.01, est.usage / est.quota))})`;

    // eviction risk (R11) + persist
    let persisted = null;
    try { persisted = await globalThis.navigator?.storage?.persisted?.() ?? null; } catch (_) { persisted = null; }
    const standalone = Boolean(globalThis.matchMedia?.('(display-mode: standalone)')?.matches || globalThis.navigator?.standalone);
    const persistBtn = C.button({ label: t('settings.storage.persist'), variant: 'tinted', icon: 'lock', testid: 'storage-persist',
      onClick: async () => { const r = await quota.requestPersist?.(globalThis.navigator); C.toast.info(r?.persisted ? t('settings.storage.persist.ok') : t('settings.storage.persist.denied')); draw(); } });
    if (persisted === true) put(evict, h('p', { class: 'ok storage-persisted', 'data-testid': 'storage-persisted' }, C.icon('check'), ' ', t('settings.storage.persisted')));
    else if (!standalone) put(evict, C.notice({ variant: 'caution', title: t('settings.storage.evict.title'), body: t('settings.storage.evict.body'), testid: 'storage-evict' }), persistBtn);
    else put(evict, h('p', { class: 'hint', text: t('settings.storage.evict.body') }), persistBtn);

    // clip clean-up (UX-16)
    const n = plan.deleteIds?.length ?? 0;
    const reason = practising ? t('settings.storage.cleanup.practising') : n === 0 ? t('settings.storage.cleanup.none') : null;
    const btn = C.button({
      label: n ? t('settings.storage.cleanup.button', { n, size: fmtBytes(plan.freedBytes) }) : t('settings.storage.cleanup.title'),
      variant: 'destructive', block: true, icon: 'trash', reason, testid: 'storage-cleanup',
      onClick: async () => {
        const ok = await C.confirmSheet({ title: t('settings.storage.cleanup.confirm.title', { n }), consequence: t('settings.storage.cleanup.confirm.body', { n, size: fmtBytes(plan.freedBytes) }), confirmLabel: t('settings.storage.cleanup.confirm.ok'), destructive: true, testid: 'cleanup' });
        if (!ok) return;
        try {
          await app.repo.batch(plan.deleteIds.map((id) => ({ op: 'delete', store: 'clips', id })));
          C.toast.info(t('settings.storage.cleanup.done', { n }));
        } catch (e) {
          C.toast.error(t('settings.storage.cleanup.failed'));
          app.errors?.report?.(e, { where: 'settings.cleanup', silent: true });
        }
        draw();
      },
    });
    put(cleanup, h('p', { class: 'hint', text: t('settings.storage.cleanup.body') }), btn,
      plan.status === 'over' && plan.satisfied === false && !practising ? h('p', { class: 'warn', text: t('settings.storage.cleanup.not_enough') }) : null);
  };
  draw().catch((e) => app.errors?.report?.(e, { where: 'settings.storage', silent: true }));
  return {
    title: t('settings.storage.title'),
    nodes: [
      h('section', { class: 'card', 'data-spec': 'P10' }, summary),
      h('section', { class: 'card' }, evict),
      h('section', { class: 'card' }, h('h2', { text: t('settings.storage.cleanup.title') }), cleanup),
      h('div', { class: 'list-group' }, C.listRow({ icon: 'download', title: t('settings.storage.backup.row'), subtitle: t('settings.storage.backup.hint'), testid: 'storage-backup', onClick: (e) => app.nav.go('history', {}, { opener: e.currentTarget }) })),
    ],
  };
}

const RENDER = { storage: renderStorage, privacy: renderPrivacy, help: renderHelp, licences: renderLicences, developer: renderDeveloper };

// ------------------------------------------------------------------ the screen
export function mountSettings(root, app) {
  try { const s = loadSettings(); applySpecOverlay(globalThis.document, s.dev && s.devSpecCodes); } catch (_) { /* no DOM */ }
  let stack = []; // internal pages above the root
  let direct = false; // opened straight at a page (nav.go('settings', { page }))
  const openers = [];

  function render(focus = true) {
    const C = components();
    const page = stack.at(-1) ?? null;
    const ctx = trustCtx(app, C, {
      open: (id, opener) => openTrustPage(app, id, opener),
      back: () => pop(),
      rerender: () => render(false),
    });
    if (page === 'developer' && !loadSettings().dev) { stack = stack.slice(0, -1); render(focus); return; }
    const out = page ? RENDER[page](ctx) : renderRoot(ctx);
    // Settings is a tab root: no Back there (the tab bar is the way out); its pages go back to it by name
    const canBack = Boolean(page);
    root.replaceChildren(
      C.screenHeader({ title: out.title, back: canBack, onBack: () => pop(), backLabel: t('screen.settings.title') }),
      ...out.nodes.filter(Boolean));
    root.dataset.page = page ?? 'root';
    setTitle(out.title);
    if (focus) focusH1(root);
  }
  function push(id, opener) {
    if (!PAGES.includes(id)) return;
    openers.push(opener ?? null);
    stack.push(id);
    globalThis.scrollTo?.(0, 0);
    render();
  }
  function pop() {
    if (stack.length <= (direct ? 1 : 0)) { app.nav.back(); return; }
    stack.pop();
    const o = openers.pop();
    render(!o);
    if (o) {
      const same = o.getAttribute?.('data-testid') && root.querySelector(`[data-testid="${o.getAttribute('data-testid')}"]`);
      try { (same || o).focus?.({ preventScroll: true }); } catch (_) { /* gone */ }
    }
  }
  const inst = {
    show(params = {}) {
      const p = params?.page;
      if (p && PAGES.includes(p)) { stack = [p]; direct = true; openers.length = 0; openers.push(null); }
      else if (!params?.keep) { stack = []; direct = false; openers.length = 0; }
      render(false);
    },
    hide() {},
    push,
  };
  settingsInstance = inst;
  // a locale change re-runs show(params): keep the page the user is on
  return {
    show(params) {
      const cur = stack.at(-1);
      if (cur && !params?.page && app.store?.get?.().screen === 'settings' && inst._shown) { render(false); return; }
      inst._shown = true;
      inst.show(params);
    },
    hide() { inst._shown = false; },
    push,
  };
}
