// ui/developer.js — Settings › Developer options (PRODUCT-SPEC §2.3). Hidden until the version row in About is tapped
// 7 times (settings.dev). Hosts: event-model import / rollback, calibration-health counters and ball-drop test,
// pose model choice with the on-demand download of the detailed model (R10), setup details note, diagnostics
// report, spec-code overlay. Catalog keys `settings.dev.*`.
//
//   DEV_TAPS                                  taps needed on the version row (7)
//   createDevTapCounter({ taps, windowMs, now }) -> tap() -> { remaining, unlocked }   pure
//   applySpecOverlay(doc, on)                 <html data-spec-codes> → settings.css shows [data-spec] codes
//   heavyModelState({ cacheMatch, online }) -> Promise<'ready'|'missing'|'offline'>
//   renderDeveloper(ctx) -> { title, nodes }  ctx = { C, app, t, fmtBytes, fmtDate, fmtRelativeDays, saveSettings,
//                                             loadSettings, models, health, checks, back() }
// Module namespaces (models, health, checks) are passed in, so a renamed export in another package's module shows
// as a missing row here instead of breaking the app at import time.

export const DEV_TAPS = 7;
export const HEAVY_MODEL_URL = 'models/pose_landmarker_heavy.task';
export const HEAVY_MODEL_BYTES = 30_664_242;
const POSE_MODELS = ['lite', 'full', 'heavy'];

export function createDevTapCounter({ taps = DEV_TAPS, windowMs = 4000, now = () => Date.now() } = {}) {
  let times = [];
  return function tap() {
    const tm = now();
    times = [...times.filter((x) => tm - x <= windowMs), tm];
    if (times.length >= taps) { times = []; return { remaining: 0, unlocked: true }; }
    return { remaining: taps - times.length, unlocked: false };
  };
}

export function applySpecOverlay(doc, on) {
  const el = doc?.documentElement;
  if (!el) return;
  if (on) el.setAttribute('data-spec-codes', '');
  else el.removeAttribute('data-spec-codes');
}

/** Whether the runtime-only detailed pose model is already in the asset cache (sw.template.js 'gsl-assets'). */
export async function heavyModelState({ cacheMatch, online = true } = {}) {
  try {
    if (cacheMatch && await cacheMatch(HEAVY_MODEL_URL)) return 'ready';
  } catch (_) { /* no Cache Storage: treat as missing */ }
  return online ? 'missing' : 'offline';
}

function defaultCacheMatch() {
  const cs = globalThis.caches;
  if (!cs?.open) return null;
  return async (url) => {
    const c = await cs.open('gsl-assets');
    return Boolean(await c.match(new URL(url, globalThis.document?.baseURI ?? globalThis.location?.href).href));
  };
}

function defaultCachePut() {
  const cs = globalThis.caches;
  if (!cs?.open) return null;
  return async (url, response) => {
    const c = await cs.open('gsl-assets');
    await c.put(new URL(url, globalThis.document?.baseURI ?? globalThis.location?.href).href, response);
  };
}

function problemText(p, msg) {
  return typeof p === 'string' ? p : msg ? msg(p) : String(p?.code ?? p);
}

export function renderDeveloper(ctx) {
  const { C, app, t } = ctx;
  const { h } = C;
  const models = ctx.models ?? {};
  const health = ctx.health ?? {};
  const checks = ctx.checks ?? {};
  const nodes = [];

  // ---- event model (swing phase detection) ----
  const status = h('p', { 'data-testid': 'model-status' }, t('settings.storage.calculating'));
  const out = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', 'data-testid': 'model-import-status' });
  const detail = h('details', { class: 'dev-detail', hidden: true }, h('summary', { text: t('settings.dev.model.problems') }), h('ul', { class: 'dev-problems' }));
  let jsonFile = null;
  let binFile = null;
  const jsonIn = C.filePicker({ accept: '.json,application/json', label: t('settings.dev.model.json'), testid: 'model-json-input', id: 'model-json', onFiles: (f) => { jsonFile = f[0] ?? null; } });
  const binIn = C.filePicker({ accept: '.bin,application/octet-stream', label: t('settings.dev.model.bin'), testid: 'model-bin-input', id: 'model-bin', onFiles: (f) => { binFile = f[0] ?? null; } });
  const pick = (picker) => picker.input?.files?.[0] ?? null;
  const rollbackBtn = C.button({ label: t('settings.dev.model.rollback'), testid: 'model-rollback', disabled: true, icon: 'undo' });
  const refresh = async () => {
    let active = null;
    let previous = null;
    try { active = await models.activeEventModel?.(app.repo); previous = await models.previousEventModel?.(app.repo); } catch (_) { /* no repo */ }
    let bundled = false;
    try { bundled = Boolean(await models.bundledModelAvailable?.()); } catch (_) { bundled = false; }
    app.store?.set?.({ eventModel: { source: active ? 'imported' : bundled ? 'bundled' : 'rules', version: active?.version ?? null } });
    const now = active
      ? t('settings.dev.model.imported', { version: active.version || '—', date: ctx.fmtDate(active.imported_at) })
      : bundled ? t('settings.dev.model.bundled') : t('settings.dev.model.rules');
    const back = previous
      ? t('settings.dev.model.can_rollback', { name: previous.source === 'builtin' ? t('settings.dev.model.rollback_default') : t('settings.dev.model.rollback_previous', { version: previous.version || '' }) })
      : t('settings.dev.model.no_rollback');
    status.textContent = `${now} ${back}`;
    rollbackBtn.setDisabled(!previous);
  };
  const importBtn = C.button({
    label: t('settings.dev.model.import'), variant: 'primary', testid: 'model-import',
    onClick: async () => {
      const jf = jsonFile ?? pick(jsonIn);
      const bf = binFile ?? pick(binIn);
      detail.hidden = true;
      out.className = 'status';
      if (!jf || !bf) { out.textContent = t('settings.dev.model.need_both'); return; }
      if (!app.repo) { out.className = 'status bad'; out.textContent = t('settings.dev.model.no_repo'); return; }
      out.textContent = t('settings.dev.model.checking');
      let json;
      try { json = JSON.parse(await jf.text()); } catch (_) { out.className = 'status bad'; out.textContent = t('settings.dev.model.bad_json'); return; }
      try {
        const bin = await bf.arrayBuffer();
        const check = await models.validateEventModel(json, bin);
        if (!check.ok) {
          out.className = 'status bad';
          out.textContent = t('settings.dev.model.rejected', { n: check.problems.length });
          detail.querySelector('ul').replaceChildren(...check.problems.map((p) => h('li', { text: problemText(p, ctx.msg) })));
          detail.hidden = false;
          return;
        }
        const nowIso = new Date().toISOString();
        const rec = await models.importEventModel(app.repo, { json, bin, check, imported_at: nowIso, file_names: [jf.name, bf.name] });
        await app.applyEventModel?.();
        out.className = 'status ok';
        out.textContent = t('settings.dev.model.imported_ok', { version: rec.version || '—' });
      } catch (e) {
        out.className = 'status bad';
        out.textContent = t('settings.dev.model.import_failed');
        app.errors?.report?.(e, { where: 'developer.model_import', silent: true });
      }
      refresh();
    },
  });
  rollbackBtn.addEventListener('click', async () => {
    try {
      const r = await models.rollbackEventModel(app.repo);
      if (r?.ok) await app.applyEventModel?.();
      C.toast.info(r?.ok ? t('settings.dev.model.rolled_back') : t('settings.dev.model.no_rollback'));
    } catch (e) {
      C.toast.error(t('settings.dev.model.rollback_failed'));
      app.errors?.report?.(e, { where: 'developer.model_rollback', silent: true });
    }
    refresh();
  });
  refresh();
  nodes.push(h('section', { class: 'card', 'data-spec': 'P9' },
    h('h2', { text: t('settings.dev.model.title') }), status,
    h('div', { class: 'dev-files' }, jsonIn, binIn),
    h('div', { class: 'row' }, importBtn, rollbackBtn), out, detail,
    h('p', { class: 'hint', text: t('settings.dev.model.hint') })));

  // ---- pose model + detailed model download (R10) ----
  const st = ctx.loadSettings();
  const poseNote = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const download = C.button({ label: t('settings.dev.pose.download', { size: ctx.fmtBytes(HEAVY_MODEL_BYTES) }), variant: 'tinted', icon: 'download', testid: 'dev-heavy-download' });
  let heavy = 'missing';
  const seg = C.segmented({
    options: POSE_MODELS.map((m) => [m, t(`settings.dev.pose.${m}`)]), value: st.model, label: t('settings.dev.pose.title'), testid: 'dev-pose-model',
    onChange: (v) => {
      if (v === 'heavy' && heavy !== 'ready') { seg.value = ctx.loadSettings().model; paintPose(); return; }
      app.updateSettings?.(ctx.saveSettings({ model: v }));
      C.toast.info(t('settings.saved'));
    },
  });
  const paintPose = () => {
    const opt = seg.querySelector?.('[data-value="heavy"]');
    if (opt) opt.setAttribute('aria-disabled', heavy === 'ready' ? 'false' : 'true');
    download.hidden = heavy === 'ready';
    download.setReason(heavy === 'offline' ? t('settings.dev.pose.heavy.offline') : null);
    poseNote.textContent = heavy === 'ready' ? t('settings.dev.pose.downloaded') : t('settings.dev.pose.heavy.missing', { size: ctx.fmtBytes(HEAVY_MODEL_BYTES) });
  };
  download.addEventListener('click', async () => {
    download.setDisabled(true);
    download.setLabel(t('settings.dev.pose.downloading'));
    try {
      const r = await (ctx.fetchImpl ?? globalThis.fetch)(HEAVY_MODEL_URL); // same origin: the service worker caches it
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Store it ourselves as well (the service worker's runtime caching is asynchronous), then mark it
      // usable only when the asset cache confirms it; without Cache Storage it stays 'missing'.
      await (ctx.cachePut ?? defaultCachePut())?.(HEAVY_MODEL_URL, r);
      heavy = await heavyModelState({ cacheMatch: ctx.cacheMatch ?? defaultCacheMatch(), online: true });
      if (heavy !== 'ready') throw new Error('heavy model not in asset cache after download');
    } catch (e) {
      C.toast.error(t('settings.dev.pose.download_failed'));
      app.errors?.report?.(e, { where: 'developer.heavy_download', silent: true });
    }
    download.setDisabled(false);
    download.setLabel(t('settings.dev.pose.download', { size: ctx.fmtBytes(HEAVY_MODEL_BYTES) }));
    paintPose();
  });
  heavyModelState({ cacheMatch: ctx.cacheMatch ?? defaultCacheMatch(), online: globalThis.navigator?.onLine !== false }).then((s) => { heavy = s; paintPose(); });
  paintPose();
  nodes.push(h('section', { class: 'card' }, h('h2', { text: t('settings.dev.pose.title') }), seg, poseNote, download, h('p', { class: 'hint', text: t('settings.dev.pose.hint') })));

  // ---- calibration health counters + drop test ----
  const hbox = h('div', {});
  const drawHealth = () => {
    const hs = health.loadHealth?.() ?? {};
    const nowIso = new Date().toISOString();
    const limit = checks.HEALTH_LIMITS?.shots_per_check ?? 20;
    const d = checks.dropTestDue?.(hs.last_drop_test_at, nowIso) ?? { days_since: null };
    hbox.replaceChildren(
      h('p', { text: t('settings.dev.health.shots', { n: hs.shots_since_check ?? 0, limit }) }),
      h('p', { text: hs.last_drop_test_at
        ? t('settings.dev.health.drop_last', { date: ctx.fmtDate(hs.last_drop_test_at), ago: ctx.fmtRelativeDays(-Math.floor(d.days_since ?? 0)) })
        : t('settings.dev.health.drop_never') }),
      h('div', { class: 'row' },
        C.button({ label: t('settings.dev.health.done'), testid: 'health-done', onClick: () => { health.noteHealthCheck?.(new Date().toISOString()); app.store?.set?.({ healthPrompts: [] }); drawHealth(); C.toast.info(t('settings.dev.health.recorded')); } }),
        C.button({ label: t('settings.dev.health.drop_done'), testid: 'droptest-done', onClick: () => { health.noteDropTest?.(new Date().toISOString()); app.store?.set?.({ healthPrompts: (app.store.get().healthPrompts ?? []).filter((p) => p.id !== 'drop_test') }); drawHealth(); C.toast.info(t('settings.dev.health.recorded')); } })));
  };
  drawHealth();
  nodes.push(h('section', { class: 'card', 'data-spec': 'P19 K11' }, h('h2', { text: t('settings.dev.health.title') }), hbox, h('p', { class: 'hint', text: t('settings.dev.health.hint') })));

  // ---- setup details, diagnostics, spec codes, turn off ----
  nodes.push(h('section', { class: 'card' }, h('h2', { text: t('settings.dev.setup.title') }), h('p', { class: 'hint', text: t('settings.dev.setup.body') })));
  const spec = C.switchRow({
    label: t('settings.dev.spec.label'), hint: t('settings.dev.spec.hint'), checked: Boolean(st.devSpecCodes), testid: 'dev-spec-codes',
    onChange: (on) => { app.updateSettings?.(ctx.saveSettings({ devSpecCodes: on })); applySpecOverlay(globalThis.document, on); },
  });
  nodes.push(h('div', { class: 'list-group' },
    C.listRow({ icon: 'info', title: t('settings.dev.diag.row'), testid: 'dev-diag', onClick: (e) => app.nav.go('diag', {}, { opener: e.currentTarget }) })));
  nodes.push(h('section', { class: 'card' }, spec));
  nodes.push(C.button({
    label: t('settings.dev.off'), variant: 'plain', block: true, testid: 'dev-off',
    onClick: () => {
      app.updateSettings?.(ctx.saveSettings({ dev: false, devSpecCodes: false }));
      applySpecOverlay(globalThis.document, false);
      C.toast.info(t('settings.dev.off.done'));
      ctx.back();
    },
  }));
  return { title: t('settings.dev.title'), nodes };
}
