// session/settings.js — per-device user preferences (localStorage; never required for correctness).

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
});

const KEY = 'gsl-settings-v1';

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch, storage = globalThis.localStorage) {
  const next = { ...loadSettings(storage), ...patch };
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch (_) { /* private mode: keep in memory only */ }
  return next;
}

/** Club presets for the defaults picker: [type, label, length_m]. */
export const CLUBS = Object.freeze([
  ['driver', '1 號木（Driver）', 1.15],
  ['3w', '3 號木', 1.09],
  ['hybrid', '混血木', 1.0],
  ['5i', '5 號鐵', 0.965],
  ['7i', '7 號鐵', 0.94],
  ['9i', '9 號鐵', 0.915],
  ['pw', '劈起桿 PW', 0.9],
  ['sw', '沙坑桿 SW', 0.89],
]);
