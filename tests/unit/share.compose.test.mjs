// share/compose.js pieces that are provable without a browser (V04-SPEC §D.1): the recorder mime choice per engine
// (iOS Safari → video/mp4, Chromium without mp4 recording / Android → video/webm; the browser gate sees whatever its
// Chromium records — Safari's own mp4 is only provable on the device checklist), file extension, support detection,
// layout, and the early ComposeError codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clipMime, mimeBase, clipExtension, videoSupport, layoutRect, composeShotVideo, SIZES, BITRATE, RETRY_BITRATE, MAX_BYTES } from '../../app/src/share/compose.js';

const engine = (accepts) => (m) => accepts.some((re) => re.test(m));
const SAFARI = engine([/^video\/mp4(;codecs=avc1(\.[0-9A-F]+)?(,mp4a\.40\.2)?)?$/i]);
const CHROMIUM_NO_H264 = engine([/^video\/webm/]);
const CHROME_126 = engine([/^video\/webm/, /^video\/mp4/]);
const FIREFOX = engine([/^video\/webm(;codecs=vp8(,opus)?)?$/]);

test('clipMime: iOS Safari → mp4 (avc1), Chromium without H.264 → webm, Firefox → webm vp8, nothing → browser default', () => {
  assert.match(clipMime(SAFARI), /^video\/mp4;codecs=avc1/);
  assert.equal(mimeBase(clipMime(SAFARI)), 'video/mp4');
  assert.equal(clipExtension(clipMime(SAFARI)), 'mp4');
  assert.match(clipMime(CHROMIUM_NO_H264), /^video\/webm/);
  assert.equal(clipExtension(clipMime(CHROMIUM_NO_H264)), 'webm');
  assert.equal(clipMime(FIREFOX), 'video/webm;codecs=vp8,opus');
  // a Chromium that records H.264 picks mp4 (first candidate), which also plays in iOS Photos
  assert.equal(mimeBase(clipMime(CHROME_126)), 'video/mp4');
  assert.equal(clipMime(() => false), '');
  assert.equal(clipMime(null), '');
  assert.equal(clipMime(() => { throw new Error('boom'); }), '');
});

test('mimeBase / clipExtension: parameters dropped, unknown → webm extension, empty → video/webm', () => {
  assert.equal(mimeBase('video/mp4;codecs=avc1.640028,mp4a.40.2'), 'video/mp4');
  assert.equal(mimeBase('VIDEO/WEBM;codecs=vp9'), 'video/webm');
  assert.equal(mimeBase(''), 'video/webm');
  assert.equal(clipExtension('video/x-matroska'), 'webm');
  assert.equal(clipExtension('video/mp4'), 'mp4');
});

test('videoSupport: needs MediaRecorder and HTMLCanvasElement.prototype.captureStream', () => {
  function MR() {}
  function Canvas() {}
  Canvas.prototype.captureStream = () => {};
  assert.deepEqual(videoSupport({}), { ok: false, reason: 'no_recorder' });
  assert.deepEqual(videoSupport({ MediaRecorder: MR }), { ok: false, reason: 'no_capture_stream' });
  assert.deepEqual(videoSupport({ MediaRecorder: MR, HTMLCanvasElement: function X() {} }), { ok: false, reason: 'no_capture_stream' });
  assert.deepEqual(videoSupport({ MediaRecorder: MR, HTMLCanvasElement: Canvas }), { ok: true, reason: null });
});

test('layoutRect: the clip contained (letterboxed) in 720×1280 / 1280×720; constants per §D.1', () => {
  assert.deepEqual(SIZES.portrait, [720, 1280]);
  assert.deepEqual(SIZES.landscape, [1280, 720]);
  assert.equal(BITRATE, 4000000);
  assert.equal(RETRY_BITRATE, 2000000);
  assert.equal(MAX_BYTES, 15000000);
  assert.deepEqual(layoutRect(1920, 1080, 720, 1280), { x: 0, y: 438, w: 720, h: 405 });
  assert.deepEqual(layoutRect(1920, 1080, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 });
  assert.deepEqual(layoutRect(1080, 1920, 1280, 720), { x: 438, y: 0, w: 405, h: 720 });
});

test('composeShotVideo: VIDEO_UNSUPPORTED without a recorder, NO_CLIP without a clip (before any work)', async () => {
  await assert.rejects(composeShotVideo({ shot: {}, clipBlob: new Blob([]), env: {} }), (e) => e.code === 'VIDEO_UNSUPPORTED');
  function MR() {}
  function Canvas() {}
  Canvas.prototype.captureStream = () => {};
  await assert.rejects(composeShotVideo({ shot: {}, clipBlob: null, env: { MediaRecorder: MR, HTMLCanvasElement: Canvas } }), (e) => e.code === 'NO_CLIP');
});

test('alignment lines in the clip (integration): the real lab/lines.js + lab/overlay.js drawn through drawLinesInRect land on the video pixels of the letterboxed rect', async () => {
  const { drawLinesInRect } = await import('../../app/src/share/compose.js');
  const { computeLines } = await import('../../app/src/lab/lines.js');
  const { drawLines } = await import('../../app/src/lab/overlay.js');
  const { synthSwing } = await import('../synth/swing.js');
  const s = synthSwing({ seed: 5, view: 'face_on', fps: 60 });
  const events = Object.fromEntries(Object.entries(s.truth.events).map(([n, e]) => [n, { ...e, conf: 0.9 }]));
  const lines = computeLines({ view: 'face_on', poseSeq: s.poseSeq, events, calibration: { camera: s.camera }, handedness: 'right' });
  for (const [W, H, srcW, srcH] of [[1080, 1920, 1920, 1080], [1920, 1080, 1080, 1920], [1080, 1350, 1280, 720]]) {
    const rect = layoutRect(srcW, srcH, W, H);
    // a recording 2-D context that applies translate / scale like a canvas does
    let m = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const pts = [];
    let lastRect = null;
    let clipRect = null;
    const tx = (x, y) => [m[0] * x + m[4], m[3] * y + m[5]];
    const ctx = {
      canvas: { width: W, height: H },
      save() { stack.push(m.slice()); }, restore() { m = stack.pop() ?? [1, 0, 0, 1, 0, 0]; },
      translate(x, y) { m = [m[0], 0, 0, m[3], m[4] + m[0] * x, m[5] + m[3] * y]; },
      scale(a, b) { m = [m[0] * a, 0, 0, m[3] * b, m[4], m[5]]; },
      moveTo(x, y) { pts.push(tx(x, y)); }, lineTo(x, y) { pts.push(tx(x, y)); },
      beginPath() {}, closePath() {}, stroke() {}, setLineDash() {}, rect(x, y, w, h) { lastRect = [...tx(x, y), ...tx(x + w, y + h)]; if (clipRect) pts.push(tx(x, y), tx(x + w, y + h)); },
      clip() { clipRect = lastRect; },
      lineCap: '', lineJoin: '', lineWidth: 1, strokeStyle: '',
    };
    const r = drawLinesInRect(ctx, drawLines, lines, { rect, W, H, frame: 0, outline: '#000', enabled: null });
    assert.ok(r.drawn.length >= 4, `${W}x${H}: drew ${r.drawn}`);
    assert.deepEqual(m, [1, 0, 0, 1, 0, 0], 'transform restored');
    for (const id of r.drawn) {
      for (const [u, v] of lines[id].pts) {
        const want = [rect.x + u * rect.w, rect.y + v * rect.h];
        assert.ok(pts.some(([x, y]) => Math.abs(x - want[0]) < 1e-6 && Math.abs(y - want[1]) < 1e-6), `${W}x${H} ${id}: (${u}, ${v}) not at ${want}`);
      }
    }
    // drawing is clipped to the video rect (a target line running past the frame never paints the letterbox bars)
    assert.deepEqual(clipRect, [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h], `${W}x${H}: clip`);
  }
});
