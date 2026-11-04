// main.js — boot: state store + screen switcher (no URL routing), media/devtools modules (optional, feature-
// detected), IndexedDB repository, navigator.storage.persist(), service worker + update banner, #app-ready.

import { createStore, createNavigator, initialState, SCREENS } from './state.js';
import { openRepository } from './store/core.js';
import { idbBackend } from './store/idb.js';
import { requestPersist } from './store/quota.js';
import { createSessionController } from './session/controller.js';
import { loadSettings } from './session/settings.js';
import { createUpdater } from './ui/update.js';
import { mountHome } from './ui/home.js';
import { mountVenue } from './ui/venue.js';
import { mountSetup } from './ui/setup.js';
import { mountLive } from './ui/live.js';
import { mountImport } from './ui/import.js';
import { mountShot } from './ui/shot.js';
import { mountHistory } from './ui/history.js';
import { mountDiag } from './ui/diag.js';
import { mountSettings } from './ui/settings.js';
import { mountAbout } from './ui/about.js';
import { activeEventModel } from './session/models.js';

// Modules owned by media / devtools (docs/app-architecture.md §4, §6). Missing ones leave a disabled state.
const OPTIONAL = Object.freeze({
  camera: './capture/camera.js',
  recorder: './capture/recorder.js',
  frametap: './capture/frametap.js',
  gravity: './sensors/gravity.js',
  onset: './audio/onset.js',
  probe: './import/probe.js',
  decode: './import/decode.js',
  landmarker: './pose/landmarker.js',
  clipPipeline: './pipeline/clip.js',
  livePipeline: './pipeline/live.js',
  diagReport: './diag/report.js',
  diagRecord: './diag/record.js',
  visionClient: './workers/client.js',
});

const MOUNTS = { home: mountHome, venue: mountVenue, setup: mountSetup, live: mountLive, import: mountImport, shot: mountShot, history: mountHistory, diag: mountDiag, settings: mountSettings, about: mountAbout };

async function loadOptional() {
  const deps = {};
  await Promise.all(Object.entries(OPTIONAL).map(async ([k, p]) => {
    try { deps[k] = await import(p); } catch (_) { deps[k] = null; }
  }));
  return deps;
}

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = (o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {});
  o[parts.at(-1)] = value;
}

async function boot() {
  const store = createStore(initialState());
  const nav = createNavigator(store);
  const deps = await loadOptional();
  const localDiag = {};
  const record = (path, value) => {
    setPath(localDiag, path, value);
    try { deps.diagRecord?.record?.(path, value); } catch (_) { /* best effort */ }
  };
  let version = 'dev';
  let settings = loadSettings();

  const app = {
    store, nav, deps, record, localDiag, repo: null, current: null, updater: null,
    version: () => version,
    settings: () => settings,
    updateSettings: (s) => { settings = s; },
    vision: null,
  };
  // vision worker client (media, docs/app-architecture.md §5): created on first use, GPU → CPU inside the worker
  if (deps.visionClient?.createVisionClient) {
    let vcP = null;
    app.vision = () => {
      if (!vcP) {
        vcP = (async () => {
          const vc = deps.visionClient.createVisionClient({ delegate: 'GPU', models: ['lite'] });
          await vc.init();
          await pushEventModel(vc);
          return vc;
        })();
        vcP.catch(() => { vcP = null; });
      }
      return vcP;
    };
  }

  // P9: the worker uses the owner's imported event model when there is one ({ type: 'set_model' }); otherwise it
  // keeps its own default (the bundled model, or the rules in a --no-bundled-model build).
  let vcReady = null;
  async function pushEventModel(vc) {
    vcReady = vc;
    if (typeof vc?.setModel !== 'function') return;
    try {
      const m = await activeEventModel(app.repo);
      const r = await vc.setModel(m ? m.json : null, m ? m.bin : null);
      record('events.model', { source: m ? 'imported' : 'default', version: m?.version ?? null, ok: r?.ok ?? null });
    } catch (e) {
      record('events.model', { source: 'error', error: String(e?.message ?? e) });
    }
  }
  app.applyEventModel = async () => { if (vcReady) await pushEventModel(vcReady); };

  // repository (IndexedDB) — the app still runs without it, results are then not saved
  try {
    app.repo = await openRepository(idbBackend());
    store.set({ repoReady: true });
  } catch (e) {
    record('store.error', String(e?.message ?? e));
  }
  app.controller = createSessionController({ store, repo: app.repo, deps, record, appVersion: () => version });

  // screens
  const screens = {};
  for (const id of SCREENS) {
    const root = document.querySelector(`[data-screen="${id}"]`);
    screens[id] = root ? MOUNTS[id](root, app) : null;
  }
  let shown = null;
  const showScreen = (s) => {
    if (shown === s.screen) return;
    screens[shown]?.hide?.();
    for (const el of document.querySelectorAll('[data-screen]')) el.hidden = el.dataset.screen !== s.screen;
    shown = s.screen;
    window.scrollTo(0, 0);
    Promise.resolve(screens[s.screen]?.show?.(s.params ?? {})).catch((e) => console.warn('screen', s.screen, e));
  };

  // P19 calibration-health prompts
  const hp = document.getElementById('health-prompts');
  const renderHealth = (s) => {
    if (!hp) return;
    const list = Array.isArray(s.healthPrompts) ? s.healthPrompts : [];
    hp.hidden = list.length === 0;
    const ul = hp.querySelector('.hp-list');
    if (ul) ul.replaceChildren(...list.map((p) => { const li = document.createElement('li'); li.className = p.level === 'warn' ? 'warn' : ''; li.dataset.prompt = p.id; li.textContent = p.text; return li; }));
  };
  hp?.querySelector('.hp-dismiss')?.addEventListener('click', () => store.set({ healthPrompts: [] }));

  // global session bar (P17) and update banner (P8)
  const bar = document.getElementById('session-bar');
  const banner = document.getElementById('update-banner');
  const renderBars = (s) => {
    if (bar) {
      bar.hidden = !s.sessionActive;
      const txt = bar.querySelector('.bar-text');
      if (txt) txt.textContent = s.status || '練習進行中';
      const re = bar.querySelector('.bar-reopen');
      if (re) re.hidden = !s.cameraInterrupted;
    }
    if (banner) {
      banner.hidden = !s.updateAvailable;
      banner.textContent = s.updatePending && s.sessionActive ? '有新版本：練習結束後會更新' : '有新版本，點此更新';
    }
  };
  bar?.querySelector('.bar-reopen')?.addEventListener('click', () => {
    app.controller.reopenCamera().then(() => screens[shown]?.attachStream?.()); // sync call from the click
  });
  store.subscribe((s, prev) => {
    if (s.screen !== prev.screen || s.params !== prev.params) { if (s.screen !== prev.screen) showScreen(s); else Promise.resolve(screens[s.screen]?.show?.(s.params ?? {})).catch(() => {}); }
    renderBars(s);
    if (s.healthPrompts !== prev.healthPrompts) renderHealth(s);
    if (prev.sessionActive && !s.sessionActive) app.updater?.sessionEnded();
  });
  for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => nav.go(b.dataset.go));

  // storage persistence (never throws)
  requestPersist(navigator).then((r) => {
    record('storage.persisted', r.persisted);
    record('storage.usage', r.usage);
    record('storage.quota', r.quota);
  });

  // service worker + update flow (never reloads while state.sessionActive)
  const sw = navigator.serviceWorker;
  if (sw && location.protocol !== 'file:') {
    app.updater = createUpdater({ store, reload: () => location.reload() });
    banner?.addEventListener('click', () => {
      const r = app.updater.request();
      if (r === 'deferred') banner.textContent = '有新版本：練習結束後會更新';
    });
    sw.addEventListener('message', (ev) => {
      if (ev.data?.type === 'VERSION') { version = ev.data.version; record('app_version', version); record('precache_complete', ev.data.precache_complete ?? null); }
    });
    sw.register('./sw.js', { scope: './' }).then((reg) => {
      app.updater.attach(reg, sw);
      record('sw_registered', true);
      const ask = () => sw.controller?.postMessage({ type: 'GET_VERSION' });
      ask();
      sw.addEventListener('controllerchange', ask);
    }).catch((e) => record('sw_error', String(e?.message ?? e)));
  }
  record('standalone', Boolean(matchMedia?.('(display-mode: standalone)').matches || navigator.standalone));

  store.set({ booted: true });
  showScreen(store.get());
  renderBars(store.get());
  const ready = document.createElement('div');
  ready.id = 'app-ready';
  ready.hidden = true;
  document.body.append(ready);
}

boot().catch((e) => {
  const el = document.getElementById('boot-error');
  if (el) { el.hidden = false; el.textContent = `啟動失敗：${e?.message ?? e}`; }
  const ready = document.createElement('div');
  ready.id = 'app-ready';
  ready.hidden = true;
  ready.dataset.error = '1';
  document.body.append(ready);
});
