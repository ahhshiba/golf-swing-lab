// ui/privacy.js — Settings › Privacy (PRODUCT-SPEC §6.4): the local-only statement and 「刪除所有資料」.
// Rendered inside the settings screen (ui/settings.js page router). Catalog namespace `privacy`.
//
//   renderPrivacy(ctx) -> { title, nodes }       ctx = { C, app, t, open(page, opener) } (see ui/settings.js)
//   deleteAllData(env) -> Promise<{ ok, problems: string[] }>   pure apart from the injected environment:
//     env = { repo, indexedDB, caches, storages: [localStorage, sessionStorage], diagReset, dbNames, timeoutMs }
//     1. repo.deleteAll() when the repository offers it (WP-D), else every store cleared in one transaction;
//        then repo.close()
//     2. indexedDB.deleteDatabase(name) for 'golf-swing-lab' (and any other database whose name starts with it or
//        'gsl', from indexedDB.databases() when available); a blocked/hanging delete gives up after timeoutMs
//     3. Cache Storage: every 'gsl-' cache except the app files ('gsl-shell-*', 'gsl-assets' — code and models,
//        no user data), so the app still starts offline afterwards
//     4. localStorage / sessionStorage: every key starting with 'gsl' (settings, onboarding flag, calibration
//        health, diag mirror). Only our keys: on GitHub Pages the origin is shared with other projects.
//   Never throws; every step runs even when an earlier one failed. The caller reloads the page afterwards, so the
//   app boots as on first launch (onboarding shows again).

export const DB_NAME = 'golf-swing-lab';
const KEEP_CACHE = (name) => name.startsWith('gsl-shell-') || name === 'gsl-assets';
const OUR_CACHE = (name) => name.startsWith('gsl-');
const OUR_KEY = (k) => typeof k === 'string' && k.startsWith('gsl');

function withTimeout(p, ms) {
  let tm;
  return Promise.race([p, new Promise((resolve) => { tm = setTimeout(() => resolve('timeout'), ms); })]).finally(() => clearTimeout(tm));
}

function deleteDb(idb, name, ms) {
  return withTimeout(new Promise((resolve) => {
    let req;
    try { req = idb.deleteDatabase(name); } catch (_) { resolve('error'); return; }
    req.onsuccess = () => resolve('ok');
    req.onerror = () => resolve('error');
    req.onblocked = () => { /* other connections close on versionchange (store/idb.js); keep waiting */ };
  }), ms);
}

export async function deleteAllData(env = {}) {
  const problems = [];
  const ms = env.timeoutMs ?? 4000;
  const repo = env.repo ?? null;
  // 1. repository contents
  if (repo) {
    try {
      if (typeof repo.deleteAll === 'function') await repo.deleteAll();
      else if (repo.stores && typeof repo.transaction === 'function') {
        const names = Object.keys(repo.stores);
        await repo.transaction(names, 'readwrite', async (tx) => { for (const n of names) await tx.clear(n); });
      }
    } catch (e) { problems.push(`repo: ${e?.code ?? e?.name ?? 'error'}`); }
    try { await repo.close?.(); } catch (_) { /* already closed */ }
  }
  // 2. IndexedDB databases
  const idb = env.indexedDB ?? null;
  if (idb && typeof idb.deleteDatabase === 'function') {
    const names = new Set(env.dbNames ?? [DB_NAME]);
    try {
      if (typeof idb.databases === 'function') {
        for (const d of await idb.databases()) if (d?.name && (d.name.startsWith(DB_NAME) || d.name.startsWith('gsl'))) names.add(d.name);
      }
    } catch (_) { /* databases() unsupported: delete the known name only */ }
    for (const n of names) {
      const r = await deleteDb(idb, n, ms);
      if (r !== 'ok') problems.push(`idb ${n}: ${r}`);
    }
  }
  // 3. Cache Storage (user data never lives in the shell/asset caches)
  const cs = env.caches ?? null;
  if (cs && typeof cs.keys === 'function') {
    try {
      for (const name of await cs.keys()) if (OUR_CACHE(name) && !KEEP_CACHE(name)) await cs.delete(name);
    } catch (e) { problems.push(`caches: ${e?.name ?? 'error'}`); }
  }
  // 4. diag mirror (memory + localStorage), then every gsl* key
  try { env.diagReset?.(); } catch (_) { /* diag is best effort */ }
  for (const s of env.storages ?? []) {
    if (!s) continue;
    try {
      const keys = [];
      for (let i = 0; i < s.length; i++) keys.push(s.key(i));
      for (const k of keys) if (OUR_KEY(k)) s.removeItem(k);
    } catch (e) { problems.push(`storage: ${e?.name ?? 'error'}`); }
  }
  return { ok: problems.length === 0, problems };
}

const POINTS = ['account', 'network', 'local', 'third', 'sensors', 'backup', 'eviction'];
const POINT_ICON = { account: 'lock', network: 'shield', local: 'phone-portrait', third: 'shield', sensors: 'camera', backup: 'download', eviction: 'alert' };

export function renderPrivacy(ctx) {
  const { C, app, t } = ctx;
  const { h } = C;
  const points = h('ul', { class: 'trust-points' }, POINTS.map((p) => h('li', { class: 'trust-point' },
    h('span', { class: 'tp-icon' }, C.icon(POINT_ICON[p])),
    h('span', { class: 'tp-text' }, h('strong', { class: 'tp-title', text: t(`privacy.${p}.title`) }), h('span', { class: 'tp-body', text: t(`privacy.${p}.body`) })))));
  const storageRow = h('div', { class: 'list-group' }, C.listRow({ icon: 'download', title: t('privacy.storage.row'), onClick: (e) => ctx.open('storage', e.currentTarget) }));

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const practising = Boolean(app.store?.get?.().sessionActive);
  const del = C.button({
    label: t('privacy.delete.button'), variant: 'destructive', size: 'lg', block: true, icon: 'trash', testid: 'privacy-delete-all',
    reason: practising ? t('privacy.delete.practising') : null,
    onClick: async () => {
      const yes = await C.confirmSheet({ title: t('privacy.delete.confirm.title'), consequence: t('privacy.delete.confirm.body'), confirmLabel: t('privacy.delete.confirm.ok'), destructive: true, testid: 'delete-all' });
      if (!yes) return;
      del.setDisabled(true);
      status.textContent = t('privacy.delete.working');
      const g = globalThis;
      const r = await deleteAllData({
        repo: app.repo, indexedDB: g.indexedDB ?? null, caches: g.caches ?? null,
        storages: [safeStorage('localStorage'), safeStorage('sessionStorage')],
        diagReset: () => app.deps?.diagRecord?.reset?.(),
      });
      app.repo = null;
      if (!r.ok) { try { app.record?.('privacy.delete_all', { ok: false, problems: r.problems }); } catch (_) { /* gone */ } }
      if (r.ok) (ctx.reload ?? (() => g.location.reload()))();
      else { status.textContent = t('privacy.delete.failed'); del.setDisabled(false); }
    },
  });
  return {
    title: t('privacy.title'),
    nodes: [
      h('p', { class: 'trust-lead', text: t('privacy.lead') }),
      h('section', { class: 'card' }, points),
      storageRow,
      h('section', { class: 'card trust-danger' },
        h('h2', { text: t('privacy.delete.title') }),
        h('p', { class: 'hint', text: t('privacy.delete.body') }),
        del, status),
    ],
  };
}

function safeStorage(name) {
  try { return globalThis[name] ?? null; } catch (_) { return null; }
}
