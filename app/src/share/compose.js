// share/compose.js — the tracer clip: original clip + ball trail (detected solid, modelled dotted) + club-head (or hand)
// trail + data card, recorded with captureStream + MediaRecorder, no sound, ≤ 12 s (V04-SPEC §D.1). Lazy. Nothing is
// written to IndexedDB. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-E.

/**
 * @param {{ shot: object, clipBlob: Blob, poseSeq: object|null,
 *   opts: { ballColour: string, clubColour: string, layout: 'portrait'|'landscape', card: boolean, lines: boolean,
 *           faceMask: boolean, appMark: boolean },
 *   onProgress?: (fraction: number) => void, signal?: AbortSignal }} args   colours are TRAIL_TOKENS ids ('trail-1' …)
 * @returns {Promise<{ blob: Blob, mime: string, duration_s: number, bytes: number, width: number, height: number }>}
 */
export async function composeShotVideo(args) {
  throw Object.assign(new Error('composeShotVideo: V4-E pending'), { code: 'PACKAGE_PENDING' });
}
