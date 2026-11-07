// lab/faults.js — the 11 fault rules (V04-SPEC §E.3): fault / possible (+ FAULT_INCONCLUSIVE) / ok / unknown (+ VIEW_*,
// FPS_TOO_LOW or the value's own code); unknown is never shown as a fault. Lazy, pure. STUB created by V4-A drop 1 with
// the FROZEN signature; owner V4-F. Output = golf-lab/1 (contract/round.js validateLabRecord), stored in repo.lab.

/**
 * @param {{ shot: object, poseSeq: object|null, view: 'face_on'|'dtl'|'high_behind', fps: number, settings: object }} args
 *   settings = lab/settings.js normalizeLab(app.settings().lab)
 * @returns {{ shot_id: string, view: string, algo: { version: string, sha256: string },
 *   faults: Array<{ id: string, status: 'fault'|'possible'|'ok'|'unknown', value: number|null, sigma: number|null,
 *   threshold: number|null, event: string|null, reason_codes: string[] }>, computed_at: string }}
 */
export function evaluateFaults(args) {
  throw Object.assign(new Error('evaluateFaults: V4-F pending'), { code: 'PACKAGE_PENDING' });
}
