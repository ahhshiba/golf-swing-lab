// face_on attack angle (LAUNCH-MONITOR-SPEC §1.2 #2; RN §8-6): the vertical part of the club-head chord velocity in
// the ball plane (physics/club.js clubSpeed: last pre-impact samples intersected with the plane y = ball + 2.5 cm,
// v_vec, chord mid-time t_mid < 0) plus an arc term, like the κ of physics/clubpath.js: before the low point the head
// still descends more steeply than at impact, so attack(0) = chord + κ_v·s̄ with s̄ = |t_mid|·speed the distance of
// the chord midpoint before impact. κ_v and its spread were fitted on tests/synth/ballflight.js simulateClubHead
// (plane 48–66°, radius 1.0–1.8 m, attack −5…+4°, path ±4°, head depth 0–5 cm, 240 fps; the sweep is in
// tests/unit/lm.physics.club.test.mjs). σ = pixel noise of the chord (≈ the relative speed σ, in radians) ⊕ κ_v
// spread · s̄ ⊕ a model term. UNVERIFIED on real clips (blurred head centroid). Validity low_confidence (registry).

import { LM_PARAMS } from './params.js';

const D = Math.PI / 180;

/** club: physics/club.js clubSpeed result. Returns { ok, value, sigma, chord_deg, s_mid_m } or { ok: false }. */
export function attackFromClub(club) {
  if (!club || !club.ok || !Array.isArray(club.v_vec) || !Number.isFinite(club.t_mid) || !(club.club_speed_mps > 0)) return { ok: false };
  const v = club.v_vec;
  const sp = Math.hypot(v[0], v[1], v[2]);
  if (!(sp > 0)) return { ok: false };
  const P = LM_PARAMS.attack;
  const chord = Math.atan2(v[2], Math.hypot(v[0], v[1])) / D;
  const s = Math.abs(club.t_mid) * sp;
  const value = chord + (P.kappa_v_per_m * s) / D;
  const sPix = (club.sigma ?? 0) / club.club_speed_mps / D;
  const sigma = Math.hypot(sPix, (P.kappa_v_sigma * s) / D, P.model_sigma_deg);
  return { ok: true, value, sigma, chord_deg: chord, s_mid_m: s };
}
