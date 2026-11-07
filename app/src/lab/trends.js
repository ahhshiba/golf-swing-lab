// lab/trends.js — fault trends across practice sessions (V04-SPEC §E.4): per fault, per session the share of
// fault + possible with a Wilson 95 % interval; views never merged. Lazy, pure. STUB created by V4-A drop 1 with the
// FROZEN signature; owner V4-F.

/**
 * @param {object[]} labRecords   golf-lab/1 records
 * @param {{ days: 7|30|null, view: 'face_on'|'dtl'|'high_behind'|null }} filter
 * @returns {{ top: string[], rows: Array<{ id: string, view: string, n: number,
 *   sessions: Array<{ session_id: string, p: number, lo: number, hi: number, n: number }>, change: 'fewer'|'more'|null }> }}
 */
export function faultTrends(labRecords, filter) {
  throw Object.assign(new Error('faultTrends: V4-F pending'), { code: 'PACKAGE_PENDING' });
}
