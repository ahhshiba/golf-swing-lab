// lab/drills.js — in-app practice cards per fault (V04-SPEC §E.5; text in the i18n `lab` namespace, no external links).
// Lazy. Owner V4-F.
//
// LAB_DRILLS: 1–2 cards per fault (15). view = the camera position the card's metric is measured from; metric = the shot
// metric that checks it (the live screen's hero number when the practice starts: nav.go('live', { focus: metric, view }));
// success = "≥ n of the last `of` swings with the metric below / above / between", or with the fault no longer seen
// (`clear`) (a practice goal, not a diagnosis). drillsFor / drillsForView leave out the cards of a disabled rule.
// Text keys: lab.drill.<id>.title / .goal / .steps (lines separated by "\n"); the check line is built from `success`
// (lab.drill.check.below / .above / .between / .clear). Cards of a disabled rule (overswing) are left out by
// drillsFor / drillsForView.
//   drillsFor(faultId) -> [drill]   drillsForView(view) -> [drill]   drillById(id) -> drill | null

import { LAB_PARAMS } from './params.js';

/**
 * @typedef {{ id: string, fault: string, view: 'face_on'|'dtl'|'high_behind', metric: string,
 *   success: { n: number, of: number, below?: number, above?: number, clear?: string } }} LabDrill
 *   clear = success is the lab rule (fault id) not flagging the swing, for a quantity no contract metric carries
 * @type {ReadonlyArray<LabDrill>}
 */
const d = (id, fault, view, metric, success) => Object.freeze({ id, fault, view, metric, success: Object.freeze({ n: 8, of: 10, ...success }) });

export const LAB_DRILLS = Object.freeze([
  d('ee_wall', 'early_extension', 'dtl', 'early_extension_m', { below: 0.05 }),
  d('ee_chair', 'early_extension', 'dtl', 'early_extension_m', { below: 0.05 }),
  d('posture_hold', 'loss_of_posture', 'dtl', 'head_lift_z_m', { below: 0.06 }),
  // the over-the-top measure is a lab quantity (no contract metric): success = the rule no longer flags the swing;
  // the live focus shows the hand-plane distance at the top, the nearest per-swing number
  d('ott_pump', 'over_the_top', 'dtl', 'hand_plane_dev_m', { clear: 'over_the_top' }),
  d('ott_gate', 'over_the_top', 'high_behind', 'club_path_deg', { above: -4 }),
  d('sway_wall', 'sway', 'face_on', 'head_sway_x_m', { above: -0.06 }),
  d('sway_feet', 'sway', 'face_on', 'head_sway_x_m', { above: -0.06 }),
  d('slide_post', 'slide', 'face_on', 'weight_shift_pct', { below: 60 }),
  d('spine_stack', 'reverse_spine', 'face_on', 'head_sway_x_m', { below: 0.04 }),
  d('dip_level', 'head_dip', 'face_on', 'head_lift_z_m', { above: -0.05 }),
  d('rise_hold', 'early_rise', 'dtl', 'head_lift_z_m', { below: 0.06 }),
  // pelvis travel toward the target at impact (weight_shift_pct): clearly forward, short of the slide zone (≈ 50 %)
  d('weight_step', 'weight_back', 'face_on', 'weight_shift_pct', { above: 10, below: 45 }),
  d('three_quarter', 'overswing', 'dtl', 'top_shaft_angle_deg', { below: 10 }),
  d('tempo_count', 'tempo_off', 'face_on', 'tempo_ratio', { above: 2.4, below: 3.6 }),
  d('tempo_pause', 'tempo_off', 'dtl', 'tempo_ratio', { above: 2.4, below: 3.6 }),
]);

/** A drill is offered only while its fault rule is judged (a disabled rule — overswing — hides its cards). */
const live = (x) => !LAB_PARAMS.faults[x.fault]?.disabled;
export const drillsFor = (faultId) => LAB_DRILLS.filter((x) => x.fault === faultId && live(x));
export const drillsForView = (view) => LAB_DRILLS.filter((x) => (x.view === view || x.fault === 'tempo_off') && live(x));
export const drillById = (id) => LAB_DRILLS.find((x) => x.id === id) ?? null;
