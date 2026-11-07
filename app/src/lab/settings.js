// lab/settings.js — settings.lab normaliser (V04-SPEC §E.1, §E.3, §F.4, §J Q5). Lazy. Created by V4-A drop 1 (frozen
// shape); owner V4-F. session/settings.js keeps settings.lab as given; read it through normalizeLab.
//
//   LAB_LINE_IDS (the 9 alignment lines of §E.1)   LAB_SENSITIVITIES ['standard', 'relaxed'] (relaxed = thresholds × 1.5)
//   LAB_DEFAULTS { lines: every id (all on), dynamic: false, sensitivity: 'standard' (J Q5) }
//   normalizeLab(raw?) -> settings.lab

export const LAB_LINE_IDS = Object.freeze(['head_box', 'spine', 'shoulders', 'hip_walls', 'butt_line', 'stance',
  'ball_hand_plane', 'ball_shoulder_plane', 'target_line']);
export const LAB_SENSITIVITIES = Object.freeze(['standard', 'relaxed']);
export const LAB_DEFAULTS = Object.freeze({ lines: LAB_LINE_IDS, dynamic: false, sensitivity: 'standard' });

/** settings.lab (anything) → a complete settings.lab (lines: known ids in LAB_LINE_IDS order; [] allowed). */
export function normalizeLab(raw) {
  const s = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    lines: Array.isArray(s.lines) ? LAB_LINE_IDS.filter((id) => s.lines.includes(id)) : [...LAB_DEFAULTS.lines],
    dynamic: typeof s.dynamic === 'boolean' ? s.dynamic : LAB_DEFAULTS.dynamic,
    sensitivity: LAB_SENSITIVITIES.includes(s.sensitivity) ? s.sensitivity : LAB_DEFAULTS.sensitivity,
  };
}
