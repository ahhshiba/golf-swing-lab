// ui/quickcard.js — the quick-read card on the live screen (V04-SPEC §A.2, §A.3). Lazy (preloaded by ui/live.js when a
// session starts, never in the boot graph). STUB created by V4-A drop 1 with the FROZEN signature; owner V4-B.
// The card carries data-testid="quick-card" and data-stage="provisional"|"refined".

/**
 * @param {HTMLElement} el   container (the card is rendered inside it)
 * @param {object} app       the app object (main.js)
 * @returns {{ provisional(r: import('../quick/estimate.js').QuickResult): void, refined(shot: object): void, clear(): void }}
 */
export function mountQuickCard(el, app) {
  throw Object.assign(new Error('mountQuickCard: V4-B pending'), { code: 'PACKAGE_PENDING' });
}
