// State store, screen switcher (no URL routing) and the P8 update flow (never reload during practice).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createNavigator, initialState, canApplyUpdate, SCREENS } from '../../app/src/state.js';
import { createUpdater } from '../../app/src/ui/update.js';

test('store: set merges, notifies subscribers with (state, prev), state is frozen', () => {
  const s = createStore(initialState());
  const seen = [];
  const off = s.subscribe((st, prev) => seen.push([prev.screen, st.screen]));
  s.set({ screen: 'history' });
  s.set((st) => ({ touches: st.touches + 1 }));
  off();
  s.set({ screen: 'home' });
  assert.deepEqual(seen, [['home', 'history'], ['history', 'history']]);
  assert.equal(s.get().touches, 1);
  assert.ok(Object.isFrozen(s.get()));
  assert.throws(() => { 'use strict'; s.get().screen = 'x'; });
});

test('navigator: go/back keep an in-memory stack; unknown screens are rejected', () => {
  const s = createStore(initialState());
  const nav = createNavigator(s);
  assert.equal(nav.current(), 'home');
  nav.go('venue');
  nav.go('setup', { a: 1 });
  assert.deepEqual(nav.stack(), ['home', 'venue']);
  assert.deepEqual(s.get().params, { a: 1 });
  nav.back();
  assert.equal(nav.current(), 'venue');
  nav.back();
  nav.back();
  assert.equal(nav.current(), 'home');
  assert.throws(() => nav.go('nope'), /unknown screen/);
  for (const id of SCREENS) nav.go(id);
  assert.equal(nav.current(), 'about');
  assert.ok(s.get().stack.length <= 20);
});

function fakeSW() {
  const posted = [];
  const reg = { waiting: { postMessage: (m) => posted.push(m) }, addEventListener() {} };
  const container = { controller: {}, listeners: {}, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); } };
  return { reg, container, posted, fire: () => container.listeners.controllerchange.forEach((f) => f()) };
}

test('update banner outside a session: SKIP_WAITING then reload on controllerchange', () => {
  const store = createStore(initialState());
  let reloads = 0;
  const u = createUpdater({ store, reload: () => { reloads++; } });
  const sw = fakeSW();
  u.attach(sw.reg, sw.container);
  assert.equal(store.get().updateAvailable, true);
  assert.equal(u.request(), 'applying');
  assert.deepEqual(sw.posted, [{ type: 'SKIP_WAITING' }]);
  sw.fire();
  assert.equal(reloads, 1);
});

test('update during practice is deferred and never reloads until the session ends (P8)', () => {
  const store = createStore({ ...initialState(), sessionActive: true });
  let reloads = 0;
  const u = createUpdater({ store, reload: () => { reloads++; } });
  const sw = fakeSW();
  u.attach(sw.reg, sw.container);
  assert.equal(canApplyUpdate(store.get()), false);
  assert.equal(u.request(), 'deferred');
  assert.deepEqual(sw.posted, []);
  sw.fire(); // another tab activated the new worker: still no reload while practising
  assert.equal(reloads, 0);
  store.set({ sessionActive: false });
  u.sessionEnded();
  assert.deepEqual(sw.posted, [{ type: 'SKIP_WAITING' }]);
  sw.fire();
  assert.equal(reloads, 1);
});

test('a controllerchange the user did not ask for never reloads', () => {
  const store = createStore(initialState());
  let reloads = 0;
  const u = createUpdater({ store, reload: () => { reloads++; } });
  const sw = fakeSW();
  u.attach(sw.reg, sw.container);
  sw.fire();
  assert.equal(reloads, 0);
});

// ---- navigator opener (A11Y-1) and settings v2 (PRODUCT-SPEC §8.0.5) ----
import { loadSettings, saveSettings, migrateV1, DEFAULT_SETTINGS, CLUBS, clubLength, SETTINGS_KEY } from '../../app/src/session/settings.js';

test('navigator: go(screen, params, { opener }) hands the opener back as restoreFocus on back()', () => {
  const s = createStore(initialState());
  const nav = createNavigator(s);
  const btn = { id: 'opener' };
  nav.go('settings', {}, { opener: btn });
  assert.equal(s.get().restoreFocus, null);
  nav.go('about');
  nav.back();
  assert.equal(s.get().screen, 'settings');
  assert.equal(s.get().restoreFocus, null);
  nav.back();
  assert.equal(s.get().screen, 'home');
  assert.equal(s.get().restoreFocus, btn);
});

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('settings v2: defaults (§10 units), v1 migration keeps v1, nested fields merge and normalise', () => {
  const fresh = loadSettings(mem(), { languages: ['zh-TW'] });
  assert.equal(fresh.locale, 'auto');
  assert.equal(fresh.theme, 'dark', 'LAUNCH-MONITOR-SPEC D1: a new install starts dark');
  assert.deepEqual(fresh.units, { distance: 'yd', speed: 'mph', body: 'cm', clubLength: 'in', height: 'cm' });
  assert.deepEqual(fresh.onboarding, { done_v: 0 });
  assert.deepEqual(fresh.live, { metrics: ['tempo_ratio', 'club_speed_mps', 'carry_m'], voice: true });
  assert.equal(fresh.dev, false);
  assert.equal(fresh.sunSuggested, false);
  assert.deepEqual(loadSettings(mem(), { languages: ['en-US'] }).units, { distance: 'yd', speed: 'mph', body: 'in', clubLength: 'in', height: 'ftin' });
  const v1 = { handedness: 'left', height_m: 1.62, club_type: 'driver', club_length_m: 1.15, model: 'lite', lastView: 'dtl', mode: 'highspeed' };
  const st = mem({ 'gsl-settings-v1': JSON.stringify(v1) });
  const s = loadSettings(st, { languages: ['zh-TW'] });
  for (const [k, v] of Object.entries(v1)) assert.equal(s[k], v, k);
  assert.equal(s.theme, 'auto', 'an existing (v1) user keeps the automatic theme (D1 is for new installs only)');
  assert.ok(st.map.has(SETTINGS_KEY), 'migrated record written');
  assert.equal(st.map.get('gsl-settings-v1'), JSON.stringify(v1), 'v1 kept for a downgrade');
  assert.deepEqual(migrateV1({ ...v1, junk: 1 }), { theme: 'auto', ...v1 });
  // an existing v2 record keeps its theme
  assert.equal(loadSettings(mem({ [SETTINGS_KEY]: JSON.stringify({ theme: 'auto' }) })).theme, 'auto');
  const st2 = mem();
  saveSettings({ units: { distance: 'm' }, live: { voice: false }, theme: 'sun', locale: 'en' }, st2);
  const s2 = loadSettings(st2, { languages: ['zh-TW'] });
  assert.equal(s2.units.distance, 'm');
  assert.equal(s2.units.speed, 'mph', 'one-level merge keeps the other units');
  assert.equal(s2.live.voice, false);
  assert.deepEqual(s2.live.metrics, [...DEFAULT_SETTINGS.live.metrics]);
  assert.equal(s2.theme, 'sun');
  saveSettings({ theme: 'neon', locale: 'fr', units: { speed: 'knots' } }, st2);
  const s3 = loadSettings(st2);
  assert.equal(s3.theme, 'auto');
  assert.equal(s3.locale, 'auto');
  assert.equal(s3.units.speed, 'mph');
  const broken = mem({ [SETTINGS_KEY]: '{not json' });
  assert.equal(loadSettings(broken).club_type, '7i');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(saveSettings({ dev: true }, throwing).dev, true, 'private mode keeps the value in memory');
});

test('settings.lm (LAUNCH-MONITOR-SPEC §3.4, §3.9): defaults, normalisation, one-level merge, tile defaults per view', async () => {
  const { LM_TILE_DEFAULTS, tileDefaults, LM_GROUNDS, LM_TILE_MAX } = await import('../../app/src/session/settings.js');
  const { METRIC_IDS } = await import('../../app/src/contract/enums.js');
  const { GROUNDS } = await import('../../app/src/contract/enums.js');
  const d = loadSettings(mem(), { languages: ['zh-TW'] }).lm;
  assert.deepEqual(Object.keys(d), ['ground', 'crossView', 'tiles', 'tilePreset', 'gapMin', 'gapMax', 'excludeMishits']);
  assert.equal(d.ground, 'normal'); // D5
  assert.equal(d.crossView, false); // D2
  assert.equal(d.tilePreset, 'auto');
  assert.deepEqual(d.tiles, [...LM_TILE_DEFAULTS.face_on]);
  assert.ok(Math.abs(d.gapMin - 8 * 0.9144) < 1e-9 && Math.abs(d.gapMax - 20 * 0.9144) < 1e-9);
  assert.equal(d.excludeMishits, true);
  assert.deepEqual([...LM_GROUNDS], [...GROUNDS]);
  for (const v of ['face_on', 'high_behind', 'dtl']) {
    const t = tileDefaults(v);
    assert.ok(t.length >= 1 && t.length <= LM_TILE_MAX && t.every((id) => METRIC_IDS.includes(id)), v);
  }
  assert.deepEqual(LM_TILE_DEFAULTS.face_on.slice(0, 3), ['carry_m', 'total_m', 'ball_speed_mps']);
  assert.deepEqual(LM_TILE_DEFAULTS.high_behind.slice(0, 2), ['carry_side_m', 'curve_m']);
  const st = mem();
  saveSettings({ lm: { tiles: ['spin_rate_rpm', 'bogus', 'spin_rate_rpm', 'apex_m'], tilePreset: 'custom' } }, st);
  saveSettings({ lm: { ground: 'firm', crossView: true } }, st);
  const s = loadSettings(st).lm;
  assert.deepEqual(s.tiles, ['spin_rate_rpm', 'apex_m'], 'unknown ids and duplicates dropped');
  assert.equal(s.tilePreset, 'custom', 'one-level merge keeps the other lm fields');
  assert.equal(s.ground, 'firm');
  assert.equal(s.crossView, false, 'D2: cross-view priors are not implemented');
  saveSettings({ lm: { tiles: [], ground: 'ice', gapMin: 30, gapMax: 10, tilePreset: 'x', excludeMishits: 'yes' } }, st);
  const n = loadSettings(st).lm;
  assert.deepEqual(n.tiles, [...LM_TILE_DEFAULTS.face_on]);
  assert.equal(n.ground, 'normal');
  assert.ok(n.gapMin < n.gapMax && Math.abs(n.gapMin - 8 * 0.9144) < 1e-9);
  assert.equal(n.tilePreset, 'auto');
  assert.equal(n.excludeMishits, true);
  assert.equal(saveSettings({ lm: { tiles: METRIC_IDS } }, mem()).lm.tiles.length, LM_TILE_MAX);
});

test('CLUBS are [type, length_m] (name from t("club." + type)); clubLength()', () => {
  assert.deepEqual(CLUBS.map((c) => c[0]), ['driver', '3w', 'hybrid', '5i', '7i', '9i', 'pw', 'sw']);
  for (const c of CLUBS) {
    assert.equal(typeof c[1], 'number');
    assert.ok(c[1] > 0.8 && c[1] < 1.2);
    assert.equal(c[2], c[1], 'deprecated index 2 = length for v1-shape callers');
    assert.ok(Object.isFrozen(c));
  }
  assert.equal(clubLength('7i'), 0.94);
  assert.equal(clubLength('putter'), null);
});
