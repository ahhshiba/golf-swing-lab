// state.js — tiny app state store + screen switcher (no URL routing: never location / history APIs).
// Pure: no DOM, no timers. main.js binds it to the screen roots (data-screen="<id>").
//
//   SCREENS                              ordered screen ids (docs/app-architecture.md §2)
//   createStore(initial?) -> store       { get(), set(patch | fn), subscribe(fn) -> unsubscribe }
//   createNavigator(store) -> nav        { go(screen, params?), back(), current(), stack() }
//   canApplyUpdate(state) -> boolean     P8: never reload while a practice session is active
//   initialState()                       the default app state

export const SCREENS = Object.freeze(['home', 'venue', 'setup', 'live', 'import', 'shot', 'history', 'diag', 'settings', 'about']);

/** Screens that belong to a running practice session (leaving them does not end the session). */
export const SESSION_SCREENS = Object.freeze(['setup', 'live', 'import', 'shot']);

export function initialState() {
  return {
    screen: 'home',
    params: {},
    stack: [],
    booted: false,
    repoReady: false,
    sessionActive: false,
    session: null, // { session_id, venue_id, preset_id, view, mode, started_at }
    updateAvailable: false,
    updatePending: false, // user asked to update while practising: applied when the session ends
    venueId: null,
    presetId: null,
    view: 'face_on',
    status: '', // status line text (Traditional Chinese)
    permissions: { motion: 'unknown', camera: 'unknown', microphone: 'unknown', wakeLock: 'unknown' },
    lastShotId: null,
    touches: 0,
    thermal: { degraded: false, model: 'full', sampling: 1 },
    healthPrompts: [], // P19: [{ id, level, text }] from calib/checks.js calibHealth (shown by main.js)
    backgroundRebuild: false, // P19: scene brightness changed > 30 % → the ball tracker should rebuild its background
    eventModel: null, // P9: { source: 'imported'|'bundled'|'rules', version } once known
  };
}

export function createStore(initial = initialState()) {
  let state = Object.freeze({ ...initial });
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      if (!p || typeof p !== 'object') return state;
      const prev = state;
      state = Object.freeze({ ...state, ...p });
      for (const fn of [...subs]) fn(state, prev);
      return state;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Screen navigation as state transitions with an in-memory back stack (max 20 entries). */
export function createNavigator(store) {
  return {
    go(screen, params = {}) {
      if (!SCREENS.includes(screen)) throw new RangeError(`unknown screen '${screen}'`);
      const s = store.get();
      if (s.screen === screen) { store.set({ params }); return; }
      const stack = [...s.stack, { screen: s.screen, params: s.params }].slice(-20);
      store.set({ screen, params, stack });
    },
    back(fallback = 'home') {
      const s = store.get();
      const stack = [...s.stack];
      const prev = stack.pop();
      store.set(prev ? { screen: prev.screen, params: prev.params, stack } : { screen: fallback, params: {}, stack: [] });
    },
    current: () => store.get().screen,
    stack: () => store.get().stack.map((e) => e.screen),
  };
}

/** P8: an update (page reload) may only be applied when no practice session is running. */
export function canApplyUpdate(state) {
  return !state.sessionActive;
}
