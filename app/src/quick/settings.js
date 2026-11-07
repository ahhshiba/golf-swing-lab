// quick/settings.js — settings.quick normaliser (V04-SPEC §A.2, §F.4). Lazy. Created by V4-A drop 1 (frozen shape);
// owner V4-B. session/settings.js keeps settings.quick as given; read it through normalizeQuick.
//
//   QUICK_DEFAULTS = { enabled: true }      normalizeQuick(raw?) -> { enabled }

export const QUICK_DEFAULTS = Object.freeze({ enabled: true });

/** settings.quick (anything) → { enabled: boolean } (default on; off = 0.3.0 behaviour). */
export function normalizeQuick(raw) {
  const q = raw !== null && typeof raw === 'object' ? raw : {};
  return { enabled: typeof q.enabled === 'boolean' ? q.enabled : QUICK_DEFAULTS.enabled };
}
