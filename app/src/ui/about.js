// ui/about.js — About (PRODUCT-SPEC §6.4): name, version "0.1.0 · build bc56e95" (never "dev"), what the app is,
// how swing phases are detected, support link, disclaimer (catalog `legal`), links to Privacy / Licences / Help.
// Tapping the version row 7 times turns on developer options (settings.dev). Catalog namespace `about`.
//
//   splitVersion(v) -> { semver, build } | null      '0.1.0+bc56e95160' → { semver: '0.1.0', build: 'bc56e95' }
//   formatVersion(v, t) -> string | null              t('about.version.format', …); null for '', 'dev', junk
//   readVersion(app, fetchImpl) -> Promise<string|null>   app.version() unless 'dev', else precache-manifest.json
//   renderAbout(ctx) -> { title, nodes }              mountAbout(root, app) -> { show, hide }

import { t as tr } from '../i18n/index.js';
import * as models from '../session/models.js';
import { createDevTapCounter, DEV_TAPS } from './developer.js';
import { supportLink } from './help.js';
import { openTrustPage, mountTrustPage } from './settings.js';

export function splitVersion(v) {
  const s = String(v ?? '').trim();
  const m = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+([0-9a-f]{4,}))?$/i.exec(s);
  if (!m) return null;
  return { semver: m[1], build: m[2] ? m[2].slice(0, 7) : null };
}

export function formatVersion(v, t = tr) {
  const p = splitVersion(v);
  if (!p) return null;
  return p.build ? t('about.version.format', { semver: p.semver, build: p.build }) : p.semver;
}

export async function readVersion(app, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const v = app?.version?.();
  if (splitVersion(v)) return v;
  if (typeof fetchImpl !== 'function') return null;
  try {
    const r = await fetchImpl('precache-manifest.json', { cache: 'no-store' });
    if (!r?.ok) return null;
    const m = await r.json();
    return splitVersion(m?.version) ? m.version : null;
  } catch (_) {
    return null;
  }
}

const LEGAL = ['estimates', 'carry', 'ranges', 'views'];

export function renderAbout(ctx) {
  const { C, app, t } = ctx;
  const { h } = C;
  const versionValue = h('span', { class: 'lr-value', 'data-testid': 'about-version', text: t('settings.storage.calculating') });
  const tapNote = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const tap = ctx.tapCounter ?? createDevTapCounter({ taps: DEV_TAPS });
  const versionRow = h('button', { type: 'button', class: 'list-row', 'data-testid': 'about-version-row' },
    h('span', { class: 'lr-icon' }, C.icon('info')),
    h('span', { class: 'lr-text' }, h('span', { class: 'lr-title', text: t('about.version') })),
    versionValue);
  versionRow.addEventListener('click', () => {
    if (ctx.loadSettings().dev) { tapNote.textContent = t('settings.dev.already'); C.toast.info(t('settings.dev.already')); return; }
    const r = tap();
    if (r.unlocked) {
      app.updateSettings?.(ctx.saveSettings({ dev: true }));
      tapNote.textContent = t('settings.dev.enabled');
      C.toast.info(t('settings.dev.enabled'), { testid: 'dev-enabled-toast' });
    } else if (r.remaining <= 3) {
      tapNote.textContent = t('settings.dev.taps', { n: r.remaining });
      C.toast.info(t('settings.dev.taps', { n: r.remaining }), { ms: 1500 });
    }
  });
  Promise.resolve(ctx.readVersion ? ctx.readVersion() : readVersion(app)).then((v) => {
    versionValue.textContent = formatVersion(v, t) ?? t('about.version.unknown');
  });

  const eventsLine = h('p', { 'data-testid': 'about-events', text: t('about.events.rules') });
  Promise.resolve(app.repo ? models.activeEventModel?.(app.repo) : null).then((m) => {
    if (m && m.source === 'imported') eventsLine.textContent = t('about.events.owner');
  }, () => {});

  return {
    title: t('screen.about.title'),
    nodes: [
      h('section', { class: 'card about-hero' },
        h('p', { class: 'about-name', text: t('app.name') }),
        h('p', { text: t('about.tagline') }),
        h('p', { class: 'hint', text: t('about.local') }),
        eventsLine),
      h('div', { class: 'list-group' }, versionRow,
        C.listRow({ icon: 'shield', title: t('about.privacy.row'), testid: 'about-privacy', onClick: (e) => openTrustPage(app, 'privacy', e.currentTarget) }),
        C.listRow({ icon: 'help', title: t('about.help.row'), testid: 'about-help', onClick: (e) => openTrustPage(app, 'help', e.currentTarget) }),
        C.listRow({ icon: 'info', title: t('about.licences.row'), testid: 'about-licences', onClick: (e) => openTrustPage(app, 'licences', e.currentTarget) })),
      tapNote,
      h('section', { class: 'card' },
        h('h2', { text: t('legal.title') }),
        h('ul', { class: 'trust-list' }, LEGAL.map((k) => h('li', { text: t(`legal.${k}`) }))),
        h('h2', { class: 'trust-sub', text: t('legal.safety.title') }),
        h('ul', { class: 'trust-list' }, h('li', { text: t('legal.safety.tripod') }), h('li', { text: t('legal.safety.people') }))),
      h('section', { class: 'card' },
        h('h2', { text: t('about.support') }), h('p', { class: 'hint', text: t('about.support.body') }), supportLink(C, t, t('about.support.link'))),
    ],
  };
}

export function mountAbout(root, app) {
  const tapCounter = createDevTapCounter({ taps: DEV_TAPS });
  return mountTrustPage(root, app, (ctx) => renderAbout({ ...ctx, tapCounter }), { id: 'about' });
}

