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
