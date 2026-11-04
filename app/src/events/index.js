// events — swing event detection (CAFCR F3, K9; P4 live state machine). Pure.
//
// API summary (signatures only; definitions in docs/metrics-by-view.md):
//
// features.js
//   FEATURE_VERSION 'evfeat-1', FEATURE_HZ 30, FEATURE_NAMES[12], LR_PAIRS, LR_SWAP
//   resamplePose(poseSeq, hz = 30) -> { t, img, K, W, H }
//   computeFeatures(poseSeq, { handedness = 'right', hz = 30 }) -> { version, names, hz, K, F, t_s, data, torso_px, px }
//   featureColumn(feat, name) -> Float64Array      gradient(y, hz)      unwrap(p)
// rules.js
//   EVENTS, EVENT_CONF_MIN, RULES, ruleHz(poseSeq)
//   detectEvents(poseSeq, { view, audioOnset_t?, handedness = 'right', hz? }) -> EventSet (source 'rules')
// detect.js
//   BACKGROUND_CLASS = 8, decodeOrdered(probs, C = 9) -> { frames, probs, score }
//   detect(poseSeq, { view, handedness, audioOnset_t?, useTcn = false, tcn?: { predict(features) -> probs[T][9] } })
// tcn.js
//   TCN_FORMAT 'gsl-event-tcn/1', TCN_CLASSES 9
//   loadTcn(json, arrayBuffer) -> { meta, predict(features) -> Float32Array(K*9), predictRows(features) -> probs[K][9] }
// live.js
//   LIVE (thresholds), createLiveDetector({ audioAvailable = true }) -> { feed(sample) -> Event[], state(), reset() }
//   initialLiveState(opts) -> state      liveStep(state, sample) -> { state, events }
// signal.js
//   movingAverage, oddWindow, parabolicOffset, firstCrossing, nearestIndex, gridIndex, wrapPi, estimateFps

export * from './features.js';
export * from './rules.js';
export * from './detect.js';
export * from './tcn.js';
export * from './live.js';
export * from './signal.js';
