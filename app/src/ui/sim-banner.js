// ui/sim-banner.js — the round banner on the live screen ("hole 3 · stroke 2 · 7 iron · name") with "use this shot" /
// "retake (no stroke)" once a quick read arrives (V04-SPEC §C.4). ui/live.js (V4-B) imports it when
// params.sink === 'sim'. Lazy. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-D.

/**
 * @param {HTMLElement} el
 * @param {object} app            app.sim.active() gives ctx; the banner calls app.sim.submit({ kind: 'quick', result })
 * @param {{ round_id: string, hole: number, player_id: string, stroke_n: number, club: string }} ctx
 * @returns {{ quick(r: object): void, destroy(): void }}
 */
export function mountSimBanner(el, app, ctx) {
  throw Object.assign(new Error('mountSimBanner: V4-D pending'), { code: 'PACKAGE_PENDING' });
}
