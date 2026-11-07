// share/trails.js — the tracer-clip colour choices (V04-SPEC §D.4): token names of --trail-1 … --trail-8 (tokens.css,
// :root only, ≥ 4.5 on black, pairwise CIEDE2000 ≥ 20). Lazy. Created by V4-A drop 1 (FROZEN value); owner V4-E.

/** [{ id: 'trail-1', token: '--trail-1' }, …]; settings.share.ballColour / clubColour hold an id. */
export const TRAIL_TOKENS = Object.freeze(Array.from({ length: 8 }, (_, i) => Object.freeze({ id: `trail-${i + 1}`, token: `--trail-${i + 1}` })));
