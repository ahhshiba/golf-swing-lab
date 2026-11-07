// sim/settings.js — settings.sim normaliser (V04-SPEC §B.2, §C.3, §F.4, §J). Lazy. Created by V4-A drop 1 (frozen
// shape and owner defaults); owner V4-C. session/settings.js keeps settings.sim as given; read it through normalizeSim.
//
//   SIM_DEFAULTS     { unobservedSide: 'sample', putting: 'auto', puttSkill: 20 (J Q1), ob: 'drop_2' (J Q2),
//                      maxScore: 'double_par', autoChipM: 0 (off; else 10–40 m), flyover: true, tees: 'middle' }
//   SIM_OPTIONS      allowed values per key        normalizeSim(raw?) -> settings.sim
//   MANUAL_FEEDS_GAPPING = false (J Q3): manual numbers live only in the round record — never a golf-shot, never in
//                      stats / gapping / trends.

export const SIM_OPTIONS = Object.freeze({
  unobservedSide: Object.freeze(['sample', 'center']),
  putting: Object.freeze(['auto', 'manual']),
  puttSkill: Object.freeze([0, 10, 20, 30]),
  ob: Object.freeze(['drop_2', 'stroke_distance']),
  maxScore: Object.freeze(['double_par', 'none']),
  tees: Object.freeze(['forward', 'middle', 'back']),
});
export const SIM_DEFAULTS = Object.freeze({
  unobservedSide: 'sample', putting: 'auto', puttSkill: 20, ob: 'drop_2', maxScore: 'double_par', autoChipM: 0, flyover: true, tees: 'middle',
});
export const MANUAL_FEEDS_GAPPING = false;
export const AUTO_CHIP_RANGE_M = Object.freeze([10, 40]);

/** settings.sim (anything) → a complete, valid settings.sim. autoChipM: 0 (off) or 10–40 m (clamped). */
export function normalizeSim(raw) {
  const s = raw !== null && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [k, list] of Object.entries(SIM_OPTIONS)) out[k] = list.includes(s[k]) ? s[k] : SIM_DEFAULTS[k];
  const c = s.autoChipM;
  out.autoChipM = typeof c === 'number' && Number.isFinite(c) && c > 0 ? Math.min(AUTO_CHIP_RANGE_M[1], Math.max(AUTO_CHIP_RANGE_M[0], c)) : 0;
  out.flyover = typeof s.flyover === 'boolean' ? s.flyover : SIM_DEFAULTS.flyover;
  return out;
}
