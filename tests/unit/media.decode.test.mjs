// import/decode.js WebCodecs path against a fake VideoDecoder (ordering, range decode, subsampling, closing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFile, selection, decodeSpan, decoderConfig, codecSupport } from '../../app/src/import/decode.js';
import { openDemuxer } from '../../app/src/import/demux.js';
import { buildTimebase } from '../../app/src/import/timebase.js';
import { mp4Blob } from './media.fixtures.mjs';

function fakeEnv({ supported = (c) => c.startsWith('avc1'), hold = 2, failAt = -1 } = {}) {
  const frames = [];
  const log = { configured: null, chunks: [] };
  class EncodedVideoChunk {
    constructor(o) { Object.assign(this, o); this.byteLength = o.data.byteLength; }
  }
  class VideoDecoder {
    constructor({ output, error }) { this.output = output; this.error = error; this.q = []; this.state = 'unconfigured'; this.decodeQueueSize = 0; }
    static async isConfigSupported(cfg) { return { supported: supported(cfg.codec), config: cfg }; }
    configure(cfg) { log.configured = cfg; this.state = 'configured'; }
    decode(chunk) {
      if (!log.chunks.length) assert.equal(chunk.type, 'key', 'first chunk must be a key frame');
      log.chunks.push(chunk);
      if (log.chunks.length - 1 === failAt) { queueMicrotask(() => this.error(new Error('boom'))); return; }
      this.q.push(chunk.timestamp);
      this.q.sort((a, b) => a - b);
      this.decodeQueueSize = this.q.length;
      // asynchronous output, presentation order, a few frames of reorder delay (B-frames)
      setTimeout(() => this._drain(hold), 0);
    }
    _drain(keep) {
      while (this.q.length > keep) this._emit(this.q.shift());
      this.decodeQueueSize = this.q.length;
    }
    _emit(ts) {
      const f = { timestamp: ts, codedWidth: 64, codedHeight: 32, displayWidth: 64, displayHeight: 32, closed: false, close() { this.closed = true; } };
      frames.push(f);
      this.output(f);
    }
    async flush() { await new Promise((r) => setTimeout(r, 1)); this._drain(0); }
    close() { this.state = 'closed'; }
  }
  return { env: { VideoDecoder, EncodedVideoChunk }, frames, log };
}

test('full decode: every frame delivered once, in presentation order, and closed', async () => {
  const blob = mp4Blob({ n: 40, timescale: 24000, deltas: () => 100, bframes: true });
  const { env, frames, log } = fakeEnv();
  const got = [];
  const res = await decodeFile(blob, {
    env,
    onFrame: async (frame, t_s, index) => { assert.equal(frame.closed, false); got.push([index, t_s]); await new Promise((r) => setTimeout(r, 0)); },
  });
  assert.equal(res.path, 'webcodecs');
  assert.equal(res.emitted, 40);
  assert.equal(res.decoded, 40);
  assert.deepEqual(got.map((g) => g[0]), Array.from({ length: 40 }, (_, i) => i));
  for (let i = 1; i < got.length; i++) assert.ok(got[i][1] > got[i - 1][1]);
  assert.ok(frames.every((f) => f.closed), 'every VideoFrame closed');
  assert.equal(log.configured.codec, 'avc1.42001e');
  assert.ok(log.configured.description instanceof Uint8Array);
});

test('range decode [from_s, to_s] starts at the preceding key frame and emits only the window', async () => {
  const blob = mp4Blob({ n: 48, timescale: 24000, deltas: () => 100 }); // 240 fps, key every 8
  const dm = await openDemuxer(blob);
  const { env, frames, log } = fakeEnv({ hold: 3 });
  const got = [];
  const from_s = 21 / 240, to_s = 30 / 240;
  const res = await decodeFile(blob, { env, demuxer: dm, from_s, to_s, onFrame: (f, t, i) => { got.push(i); } });
  assert.deepEqual(got, [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  assert.equal(log.chunks[0].type, 'key');
  assert.equal(log.chunks.length, 31 - 16); // decode from key frame 16 through 30
  assert.equal(res.emitted, 10);
  assert.ok(frames.every((f) => f.closed));
});

test('hz subsampling (pose pass) decodes everything but emits a 60 Hz grid', async () => {
  const blob = mp4Blob({ n: 97, timescale: 24000, deltas: () => 100 });
  const { env, frames } = fakeEnv();
  const got = [];
  await decodeFile(blob, { env, hz: 60, onFrame: (f, t, i) => got.push(i) });
  assert.deepEqual(got, Array.from({ length: 25 }, (_, k) => 4 * k));
  assert.equal(frames.length, 97);
  assert.ok(frames.every((f) => f.closed));
});

test('B-frame range: decodeSpan covers every needed sample', async () => {
  const dm = await openDemuxer(mp4Blob({ n: 24, timescale: 6000, deltas: () => 100, bframes: true }));
  const tb = buildTimebase(dm.samples);
  const want = selection(tb.t_s, { from_s: tb.t_s[5], to_s: tb.t_s[9] });
  assert.deepEqual([...want], [5, 6, 7, 8, 9]);
  const [d0, d1] = decodeSpan(dm.samples, tb, want);
  assert.ok(dm.samples[d0].is_sync);
  for (const p of want) assert.ok(tb.order[p] >= d0 && tb.order[p] <= d1);
  const { env, frames } = fakeEnv({ hold: 2 });
  const got = [];
  await decodeFile(null, { env, demuxer: dm, from_s: tb.t_s[5], to_s: tb.t_s[9], onFrame: (f, t, i) => got.push(i) });
  assert.deepEqual(got, [5, 6, 7, 8, 9]);
  assert.ok(frames.every((f) => f.closed));
});

test('unsupported codec, decoder error, consumer error and cancel all reject and close every frame', async () => {
  const blob = mp4Blob({ n: 32, timescale: 24000, deltas: () => 100 });
  const a = fakeEnv({ supported: () => false });
  await assert.rejects(decodeFile(blob, { env: a.env, onFrame() {} }), (e) => e.code === 'UNSUPPORTED_CODEC');
  const b = fakeEnv({ failAt: 5 });
  await assert.rejects(decodeFile(blob, { env: b.env, onFrame() {} }), (e) => e.code === 'DECODE_FAILED');
  assert.ok(b.frames.every((f) => f.closed));
  const c = fakeEnv();
  await assert.rejects(decodeFile(blob, { env: c.env, onFrame(f, t, i) { if (i === 3) throw new Error('consumer'); } }), /consumer/);
  assert.ok(c.frames.every((f) => f.closed));
  const d = fakeEnv();
  const ctl = new AbortController();
  await assert.rejects(decodeFile(blob, { env: d.env, signal: ctl.signal, onFrame(f, t, i) { if (i === 4) ctl.abort(); } }), (e) => e.code === 'CANCELLED');
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(d.frames.every((f) => f.closed));
  await assert.rejects(decodeFile(blob, { env: {}, onFrame() {} }), (e) => e.code === 'WEBCODECS_UNAVAILABLE');
});

test('decoderConfig / codecSupport', async () => {
  const dm = await openDemuxer(mp4Blob({ n: 4 }));
  const cfg = decoderConfig(dm);
  assert.equal(cfg.codec, 'avc1.42001e');
  assert.equal(cfg.codedWidth, 640);
  const { env } = fakeEnv({ supported: (c) => c.startsWith('avc1') });
  assert.deepEqual(await codecSupport({ env }), { webcodecs: true, avc1: true, hevc: false });
  assert.deepEqual(await codecSupport({ env: {} }), { webcodecs: false, avc1: false, hevc: false });
});
