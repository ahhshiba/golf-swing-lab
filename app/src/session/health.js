// session/health.js — P19 calibration-health bookkeeping (per device, localStorage; never required for correctness).
// The checks themselves are pure functions in calib/checks.js (calibHealth); this file keeps the counters they need:
//   { shots_since_check, last_check_at, last_drop_test_at, locked_luma, dismissed_at }
//
//   loadHealth(storage?) -> state      saveHealth(patch, storage?) -> state
//   noteShot(storage?) -> state        (+1 shot since the last health check)
//   noteHealthCheck(at, storage?)      (a P3 lock or an explicit check resets the 20-shot counter)
//   noteDropTest(at, storage?)         (K11 reminder resets)
//   healthPrompts({ state, venue, solved_mat, current_luma, now, mode }) -> calibHealth(...) result

import { calibHealth } from '../calib/checks.js';

const KEY = 'gsl-calib-health-v1';
export const DEFAULT_HEALTH = Object.freeze({ shots_since_check: 0, last_check_at: null, last_drop_test_at: null, locked_luma: null });

export function loadHealth(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_HEALTH, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch (_) {
    return { ...DEFAULT_HEALTH };
  }
}

export function saveHealth(patch, storage = globalThis.localStorage) {
  const next = { ...loadHealth(storage), ...patch };
  try { storage?.setItem(KEY, JSON.stringify(next)); } catch (_) { /* private mode: in memory only */ }
  return next;
}

export function noteShot(storage = globalThis.localStorage) {
  const s = loadHealth(storage);
  return saveHealth({ shots_since_check: (Number.isFinite(s.shots_since_check) ? s.shots_since_check : 0) + 1 }, storage);
}

export function noteHealthCheck(at, { locked_luma } = {}, storage = globalThis.localStorage) {
  const patch = { shots_since_check: 0, last_check_at: at };
  if (locked_luma !== undefined) patch.locked_luma = Number.isFinite(locked_luma) ? locked_luma : null;
  return saveHealth(patch, storage);
}

export function noteDropTest(at, storage = globalThis.localStorage) {
  return saveHealth({ last_drop_test_at: at }, storage);
}

export function healthPrompts({ state, venue = null, solved_mat = null, current_luma = NaN, now, mode = 'live' }) {
  return calibHealth({
    shots_since_check: state?.shots_since_check ?? 0,
    venue, solved_mat,
    locked_luma: state?.locked_luma ?? null,
    current_luma,
    last_drop_test_at: state?.last_drop_test_at ?? null,
    now, mode,
  });
}
