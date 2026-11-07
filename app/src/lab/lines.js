// lab/lines.js — alignment lines from the address frame (V04-SPEC §E.1, F2 view discipline: a line is only drawn
// where the view can see it). Lazy, pure. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-F.

/**
 * @typedef {{ pts: Array<[number, number]>, kind: 'ref'|'live', validity: string, reason_codes: string[] }} Line
 * @param {{ view: 'face_on'|'dtl'|'high_behind', poseSeq: object, events: object, calibration: object|null, handedness: 'right'|'left' }} args
 * @returns {Object<string, Line|null>}  keys = lab/settings.js LAB_LINE_IDS; null (+ reason) where the view cannot see it
 */
export function computeLines(args) {
  throw Object.assign(new Error('computeLines: V4-F pending'), { code: 'PACKAGE_PENDING' });
}
