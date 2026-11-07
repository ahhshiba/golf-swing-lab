// lab/drills.js — in-app practice cards per fault (V04-SPEC §E.5; text in the i18n `lab` namespace, no external links).
// Lazy. STUB created by V4-A drop 1 (FROZEN shape, empty until V4-F fills it); owner V4-F.

/**
 * @typedef {{ id: string, fault: string, view: 'face_on'|'dtl'|'high_behind', metric: string,
 *   success: { n: number, of: number, below?: number, above?: number } }} LabDrill
 *   text keys: lab.drill.<id>.{title,goal,steps,check}; "start practice" → nav.go('live', { focus: metric, view })
 * @type {ReadonlyArray<LabDrill>}
 */
export const LAB_DRILLS = Object.freeze([]);
