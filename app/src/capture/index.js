// capture — live camera, MediaRecorder segments, ROI frame tap (main thread; app-architecture.md section 4).
//   camera.js    openCamera(opts) closeCamera() getGumCalls() onTrackEnded(cb) currentStream() cameraConstraints(opts)
//   recorder.js  createSegmentRecorder(stream, opts) pickMimeType(isTypeSupported) supportedTypes() RECORDER_CANDIDATES
//   frametap.js  createFrameTap(videoEl, opts) cropRect(roi, W, H, maxWidth) createThrottle(fps)
export * from './camera.js';
export * from './recorder.js';
export * from './frametap.js';
