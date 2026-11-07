// sim/recommend.js — club recommendation from the player's own gapping (or reference carries) for the plays-like
// distance (V04-SPEC §C.3). Lazy, pure. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-C.

/**
 * @param {{ distance_m: number, lie: string, dz_m: number, player: object }} args
 * @returns {{ club: string, carry: { median: number, p10: number, p90: number }, alts: string[],
 *   source: 'gapping'|'reference', flags: Array<'small_sample'> }}
 */
export function recommendClub(args) {
  throw Object.assign(new Error('recommendClub: V4-C pending'), { code: 'PACKAGE_PENDING' });
}
