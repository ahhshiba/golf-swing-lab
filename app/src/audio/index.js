// audio — impact-sound onsets. onset.worklet.js runs in the AudioWorklet (OnsetCore is exported for tests).
//   onset.js  startOnsetDetector(audioCtx, stream, { onOnset, toMediaTime, options }) ctxToPerfMs(t_ctx, stamp)
export * from './onset.js';
export { OnsetCore, ONSET_DEFAULTS } from './onset.worklet.js';
