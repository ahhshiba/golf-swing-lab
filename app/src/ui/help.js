// ui/help.js — Settings › Help (PRODUCT-SPEC §2.3): FAQ, glossary of every metric, re-run onboarding, report a
// problem (a plain GitHub issues link: the user taps it, the app sends nothing). Catalog namespace `help`.
//
//   FAQ_IDS, supportUrl(t) (catalog about.support.url: a plain GitHub issues link, PRODUCT-SPEC §10)
//   glossaryIds(registry) -> metric ids that have a label in the catalog
//   renderHelp(ctx) -> { title, nodes }      ctx = { C, app, t, has, open(page, opener), registry? }
//   rerunOnboarding(app, saveSettings)       onboarding.done_v = 0, then home with { onboarding: true }

/** The support link lives in the catalog (about.support.url), not in code: the app shell holds no external URL. */
export const supportUrl = (t) => t('about.support.url');
export const FAQ_IDS = Object.freeze(['offline', 'placement', 'modes', 'null', 'ci', 'carry', 'phases', 'data', 'eviction']);

export function glossaryIds(registry, has) {
  return Object.keys(registry ?? {}).filter((id) => has(`metric.${id}.label`));
}

export function rerunOnboarding(app, saveSettings) {
  const s = saveSettings({ onboarding: { done_v: 0 } });
  app.updateSettings?.(s);
  app.nav.go('home', { onboarding: true }); // home.js: show({ onboarding: true }) re-runs onboarding
}

export function supportLink(C, t, label) {
  return C.h('a', { class: 'btn btn-tinted btn-lg btn-block trust-link', href: supportUrl(t), target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'support-link' },
    C.h('span', { class: 'btn-main' }, C.icon('external-link'), C.h('span', { class: 'btn-label', text: label ?? t('help.report.link') })));
}

export function renderHelp(ctx) {
  const { C, app, t, has } = ctx;
  const { h } = C;
  const faq = FAQ_IDS.map((id) => h('details', { class: 'faq-item', 'data-testid': `faq-${id}` },
    h('summary', {}, h('span', { class: 'faq-q', text: t(`help.faq.${id}.q`) }), h('span', { class: 'faq-chev' }, C.icon('chevron-down'))),
    h('p', { class: 'faq-a', text: t(`help.faq.${id}.a`) })));
  const ids = glossaryIds(ctx.registry, has);
  const glossary = h('dl', { class: 'glossary' }, ids.map((id) => [
    h('dt', {}, h('span', { text: t(`metric.${id}.label`) }),
      app.locale?.() === 'zh-Hant' && has(`metric.${id}.term`) ? h('span', { class: 'gl-term', lang: 'en', text: t(`metric.${id}.term`) }) : null),
    h('dd', {}, has(`metric.${id}.meaning`) ? h('span', { text: t(`metric.${id}.meaning`) }) : null,
      has(`metric.${id}.range`) ? h('span', { class: 'gl-range', text: t(`metric.${id}.range`) }) : null),
  ]));
  return {
    title: t('help.title'),
    nodes: [
      h('section', { class: 'card' }, h('h2', { text: t('help.faq.title') }), h('div', { class: 'faq' }, faq)),
      h('div', { class: 'list-group' },
        C.listRow({ icon: 'play', title: t('help.onboarding.rerun'), testid: 'help-rerun-onboarding', onClick: () => rerunOnboarding(app, ctx.saveSettings) })),
      h('section', { class: 'card' },
        h('h2', { text: t('help.glossary.title') }), h('p', { class: 'hint', text: t('help.glossary.hint') }), glossary),
      h('section', { class: 'card' },
        h('h2', { text: t('help.report.title') }), h('p', { class: 'hint', text: t('help.report.body') }), supportLink(C, t),
        h('div', { class: 'list-group trust-inset' }, C.listRow({ icon: 'info', title: t('settings.diag.row'), subtitle: t('settings.diag.hint'), testid: 'help-diag', onClick: (e) => app.nav.go('diag', {}, { opener: e.currentTarget }) }))),
    ],
  };
}
