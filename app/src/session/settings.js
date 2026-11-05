// session/settings.js — per-device user preferences (localStorage; never required for correctness).
// Schema gsl-settings-v2 (PRODUCT-SPEC §8.0.5, FROZEN in drop 1). A v1 record ('gsl-settings-v1') is migrated on
// the first load and kept as it was (a downgrade still finds it).
//
//   DEFAULT_SETTINGS                       defaults (units from §10; en-US gets body 'in', height 'ftin' at first run)
//   loadSettings(storage?, { languages })  -> settings (defaults filled, nested objects normalised)
//   saveSettings(patch, storage?)          -> settings; plain-object fields (units, onboarding, live) merge one level
//   CLUBS                                  [[type, length_m]]; display name t('club.' + type)
//   clubLength(type) -> length_m | null    LIVE_METRIC_CHOICES   THEMES   SETTINGS_KEY
import { DEFAULT_UNITS, defaultUnits, normalizeUnits } from '../i18n/units.js';

export const SETTINGS_KEY = 'gsl-settings-v2';
const V1_KEY = 'gsl-settings-v1';

export const THEMES = Object.freeze(['auto', 'light', 'dark', 'sun']);
export const LOCALE_PREFS = Object.freeze(['auto', 'zh-Hant', 'en']);
/** Metric ids the live scoreboard can show (live screen filters to what the mode can measure). */
export const LIVE_METRIC_CHOICES = Object.freeze(['tempo_ratio', 'backswing_s', 'downswing_s', 'club_speed_mps', 'carry_m', 'ball_speed_mps', 'head_sway_x_m']);

export const DEFAULT_SETTINGS = Object.freeze({
  handedness: 'right',
  height_m: 1.75,
  club_type: '7i',
  club_length_m: 0.94,
  lie: 'mat',
  model: 'full', // pose model for import analysis: lite | full | heavy
  lastVenueId: null,
  lastView: 'face_on',
  mode: 'live', // live | highspeed
  // v2 (PRODUCT-SPEC §8.0.5)
  locale: 'auto', // 'auto' | 'zh-Hant' | 'en'
  units: DEFAULT_UNITS,
  theme: 'auto', // 'auto' | 'light' | 'dark' | 'sun'
  onboarding: Object.freeze({ done_v: 0 }),
  live: Object.freeze({ metrics: Object.freeze(['tempo_ratio', 'club_speed_mps', 'carry_m']), voice: true }),
  dev: false,
  sunSuggested: false,
});

const NESTED = ['units', 'onboarding', 'live'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function read(storage, key) {
  try {
    const raw = storage?.getItem(key);
    const obj = raw ? JSON.parse(raw) : null;
    return isObj(obj) ? obj : null;
  } catch (_) {
    return null;
  }
}

function normalize(obj, languages) {
  const s = { ...DEFAULT_SETTINGS, ...obj };
  s.units = normalizeUnits(isObj(obj.units) ? obj.units : {}, defaultUnits(languages));
  s.onboarding = { ...DEFAULT_SETTINGS.onboarding, ...(isObj(obj.onboarding) ? obj.onboarding : {}) };
  if (!Number.isInteger(s.onboarding.done_v) || s.onboarding.done_v < 0) s.onboarding.done_v = 0;
  const live = isObj(obj.live) ? obj.live : {};
  const metrics = Array.isArray(live.metrics) ? live.metrics.filter((m) => LIVE_METRIC_CHOICES.includes(m)).slice(0, 3) : null;
  s.live = { metrics: metrics && metrics.length ? metrics : [...DEFAULT_SETTINGS.live.metrics], voice: typeof live.voice === 'boolean' ? live.voice : true };
  if (!LOCALE_PREFS.includes(s.locale)) s.locale = 'auto';
  if (!THEMES.includes(s.theme)) s.theme = 'auto';
  s.dev = s.dev === true;
  s.sunSuggested = s.sunSuggested === true;
  return s;
}

/** v1 → v2: v1 fields carry over unchanged; new fields take their defaults. */
export function migrateV1(v1) {
  const out = {};
  for (const k of ['handedness', 'height_m', 'club_type', 'club_length_m', 'lie', 'model', 'lastVenueId', 'lastView', 'mode']) {
    if (v1 && k in v1) out[k] = v1[k];
  }
  return out;
}

export function loadSettings(storage = globalThis.localStorage, { languages } = {}) {
  const langs = languages ?? globalThis.navigator?.languages ?? [];
  const v2 = read(storage, SETTINGS_KEY);
  if (v2) return normalize(v2, langs);
  const v1 = read(storage, V1_KEY);
  const s = normalize(v1 ? migrateV1(v1) : {}, langs);
  if (v1) { try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) { /* private mode */ } }
  return s;
}

export function saveSettings(patch, storage = globalThis.localStorage) {
  const cur = loadSettings(storage);
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch ?? {})) {
    next[k] = NESTED.includes(k) && isObj(v) ? { ...cur[k], ...v } : v;
  }
  const s = normalize(next, globalThis.navigator?.languages ?? []);
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) { /* private mode: keep in memory only */ }
  return s;
}

/**
 * Club presets: [type, length_m]; name t('club.' + type). Index 2 repeats length_m for callers written against
 * the v1 shape [type, label, length_m] (DEPRECATED, removed at integration — read index 1).
 */
export const CLUBS = Object.freeze([
  ['driver', 1.15], ['3w', 1.09], ['hybrid', 1.0], ['5i', 0.965], ['7i', 0.94], ['9i', 0.915], ['pw', 0.9], ['sw', 0.89],
].map(([type, len]) => Object.freeze([type, len, len])));

export function clubLength(type) {
  const c = CLUBS.find((x) => x[0] === type);
  return c ? c[1] : null;
}
