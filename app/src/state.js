// state.js — tiny app state store + screen switcher (no URL routing: never location / history APIs).
// Pure: no DOM, no timers. main.js binds it to the screen roots (data-screen="<id>").
//
//   SCREENS                              ordered core screen ids (docs/app-architecture.md §2)
//   SUB_SCREENS                          screens added by PRODUCT-SPEC §2 (venues, teach, privacy, help, licences,
//                                        developer) and LAUNCH-MONITOR-SPEC §3.1 (drills, drill under Practice; stats,
//                                        gapping under History) and V04-SPEC §G.0 (course, round, scorecard, lab under
//                                        Practice; patterns under History); mounted lazily by main.js when their module exists.
//                                        Onboarding runs inside home (B), which hides the tab bar while it shows
//   DATA_SCREENS                         data screens shown dark while the theme is auto (LAUNCH-MONITOR-SPEC §4.1)
//   ALL_SCREENS                          SCREENS + SUB_SCREENS (what nav.go accepts)
//   TABS, tabOf(screen, prevTab?)        bottom tab bar: tab id → root screen; which tab a screen belongs to
//   TABBAR_HIDDEN                        screens without the tab bar (setup, live; and home while it shows onboarding)
//   createStore(initial?) -> store       { get(), set(patch | fn), subscribe(fn) -> unsubscribe }
//   createNavigator(store) -> nav        { go(screen, params?, { opener }?), back(), root(screen), current(), stack() }
//                                        opener (any value, usually the tapped element) comes back as
//                                        state.restoreFocus after back() returns to that screen (A11Y-1)
//   canApplyUpdate(state) -> boolean     P8: never reload while a practice session is active
//   initialState()                       the default app state

export const SCREENS = Object.freeze(['home', 'venue', 'setup', 'live', 'import', 'shot', 'history', 'diag', 'settings', 'about']);
export const SUB_SCREENS = Object.freeze(['venues', 'teach', 'privacy', 'help', 'licences', 'developer', 'drills', 'drill', 'stats', 'gapping',
  'course', 'round', 'scorecard', 'lab', 'patterns']);
export const DATA_SCREENS = Object.freeze(['shot', 'stats', 'gapping', 'drill', 'round', 'scorecard', 'lab', 'patterns']);
export const ALL_SCREENS = Object.freeze([...SCREENS, ...SUB_SCREENS]);

/** PRODUCT-SPEC §2.1: Practice · History · Settings (tab id → its root screen). */
export const TABS = Object.freeze({ practice: 'home', history: 'history', settings: 'settings' });
export const TABBAR_HIDDEN = Object.freeze(['setup', 'live']);
const TAB_OF = Object.freeze({
  home: 'practice', venue: 'practice', setup: 'practice', live: 'practice', import: 'practice', drills: 'practice', drill: 'practice',
  course: 'practice', round: 'practice', scorecard: 'practice', // lab keeps the tab it was opened from (home or a result)
  history: 'history', teach: 'history', stats: 'history', gapping: 'history', patterns: 'history',
  settings: 'settings', diag: 'settings', about: 'settings', venues: 'settings', privacy: 'settings', help: 'settings', licences: 'settings', developer: 'settings',
});
/** The tab a screen belongs to; a screen reachable from several tabs (shot) keeps the tab it was opened from. */
export function tabOf(screen, prevTab = 'practice') {
  return TAB_OF[screen] ?? (Object.hasOwn(TABS, prevTab) ? prevTab : 'practice');
}

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
    status: '', // status line: { code, params } (PRODUCT-SPEC §8.0.6) or a legacy string; '' / null = none
    restoreFocus: null, // set by nav.back(): the opener given to nav.go() for the screen being returned to
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
    go(screen, params = {}, { opener = null } = {}) {
      if (!ALL_SCREENS.includes(screen)) throw new RangeError(`unknown screen '${screen}'`);
      const s = store.get();
      if (s.screen === screen) { store.set({ params }); return; }
      const entry = opener ? { screen: s.screen, params: s.params, opener } : { screen: s.screen, params: s.params };
      const stack = [...s.stack, entry].slice(-20);
      store.set({ screen, params, stack, restoreFocus: null });
    },
    back(fallback = 'home') {
      const s = store.get();
      const stack = [...s.stack];
      const prev = stack.pop();
      store.set(prev ? { screen: prev.screen, params: prev.params, stack, restoreFocus: prev.opener ?? null } : { screen: fallback, params: {}, stack: [], restoreFocus: null });
    },
    /** Tab bar: show a tab's root screen with a fresh back stack (back from it falls back to home). */
    root(screen, params = {}) {
      if (!ALL_SCREENS.includes(screen)) throw new RangeError(`unknown screen '${screen}'`);
      const s = store.get();
      const stack = screen === 'home' ? [] : [{ screen: 'home', params: {} }];
      if (s.screen === screen) { store.set({ params, stack }); return; }
      store.set({ screen, params, stack, restoreFocus: null });
    },
    current: () => store.get().screen,
    stack: () => store.get().stack.map((e) => e.screen),
  };
}

/** P8: an update (page reload) may only be applied when no practice session is running. */
export function canApplyUpdate(state) {
  return !state.sessionActive;
}
