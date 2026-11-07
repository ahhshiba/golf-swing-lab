// sim/recommend.js — club recommendation from the player's own gapping (or reference carries) for the plays-like
// distance (V04-SPEC §C.3). Lazy, pure. Owner V4-C.
//
//   recommendClub({ distance_m, lie, dz_m, player, gapping? }) ->
//     { club, carry: { median, p10, p90 }, alts: [longer, shorter], source: 'gapping'|'reference', flags, plays_like_m }
//   plays-like = distance + dz × 1.0 (uphill plays longer); each club's carry is scaled by its lie factor (sim/lies.js),
//   the club whose (lie-scaled) median carry is nearest wins; P10–P90 travel with it for the map.
//   Gapping rows (store/stats.js gapping(), face_on as on the Gapping screen) come from `gapping` or `player.gapping`;
//   a club with n < 5 uses the reference carry (REFERENCE_CARRY_M scaled to driver_carry_m) and flags 'small_sample';
//   when other clubs are measured, those reference carries are rescaled to the player and kept in club order
//   (playerCarries: scaled: true, low_confidence, REFERENCE_PRIOR).
//   Lies: the driver is only offered from the tee (never from a bunker, §C.3); a greenside bunker (≤ 30 m) → sw;
//   on the green → putter (carry = the distance, alts []).

import { CLUBS } from '../session/settings.js';
import { SIM_PARAMS as P } from './params.js';
import { lieFactors } from './lies.js';
import { playerCarries } from './source.js';

/** Every club's carry for the player (sim/source.js playerCarries, re-exported: same numbers as the sim prior). */
export { playerCarries };

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * @param {{ distance_m: number, lie: string, dz_m: number, player: object, gapping?: object[] }} args
 * @returns {{ club: string, carry: { median: number, p10: number, p90: number }, alts: string[],
 *   source: 'gapping'|'reference', flags: Array<'small_sample'>, plays_like_m: number,
 *   scaled: boolean, validity: 'estimated'|'low_confidence', reason_codes: string[] }}  (scaled = a reference carry
 *   scaled to the player's measured clubs — see playerCarries)
 */
export function recommendClub({ distance_m, lie = 'fairway', dz_m = 0, player = {}, gapping = null } = {}) {
  if (!(typeof distance_m === 'number' && Number.isFinite(distance_m) && distance_m >= 0)) throw new RangeError('recommendClub: distance_m must be a number >= 0');
  const dz = typeof dz_m === 'number' && Number.isFinite(dz_m) ? dz_m : 0;
  const target = distance_m + dz * P.dz_factor;
  if (lie === 'green') {
    const d = r1(distance_m);
    return { club: 'putter', carry: { median: d, p10: d, p90: d }, alts: [], source: 'reference', flags: [], plays_like_m: d, scaled: false, validity: 'low_confidence', reason_codes: [] };
  }
  const rows = Array.isArray(gapping) ? gapping : Array.isArray(player?.gapping) ? player.gapping : [];
  let ids = CLUBS.map((c) => c[0]);
  if (lie !== 'tee') ids = ids.filter((c) => c !== 'driver');
  if (lie === 'bunker' && distance_m <= P.greenside_bunker_m) ids = ['sw'];
  const carries = playerCarries(player, rows);
  const cand = ids.map((club) => {
    const pr = carries.find((x) => x.club === club);
    const f = lieFactors(lie, club).carry;
    return { club, pr, median: pr.median * f, p10: pr.p10 * f, p90: pr.p90 * f };
  }).sort((a, b) => b.median - a.median);
  let best = 0;
  for (let i = 1; i < cand.length; i++) if (Math.abs(cand[i].median - target) < Math.abs(cand[best].median - target)) best = i;
  const c = cand[best];
  const alts = [];
  if (best > 0) alts.push(cand[best - 1].club);
  if (best < cand.length - 1) alts.push(cand[best + 1].club);
  if (alts.length < 2 && cand.length > 2) alts.push(cand[best === 0 ? 2 : cand.length - 3].club);
  return {
    club: c.club, carry: { median: r1(c.median), p10: r1(c.p10), p90: r1(c.p90) }, alts: alts.slice(0, 2),
    source: c.pr.source, flags: c.pr.small_sample ? ['small_sample'] : [], plays_like_m: r1(target),
    scaled: c.pr.scaled, validity: c.pr.validity, reason_codes: c.pr.reason_codes,
  };
}
