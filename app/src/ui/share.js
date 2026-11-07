// ui/share.js — the share sheet: colours, layout, card, lines, face mask → "make video" (progress + cancel) → preview →
// a SECOND tap shares (navigator.share needs a fresh user activation) or downloads (V04-SPEC §D.2). Calls
// app.loadStyles('share') before it opens. Lazy. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-E.

/**
 * @param {object} app
 * @param {{ kind: 'shot'|'session'|'round', shot?: object, shots?: object[], filter?: object, round?: object, playerId?: string }} opts
 * @returns {Promise<void>}  resolves when the sheet closes
 */
export async function openShareSheet(app, opts) {
  throw Object.assign(new Error('openShareSheet: V4-E pending'), { code: 'PACKAGE_PENDING' });
}
