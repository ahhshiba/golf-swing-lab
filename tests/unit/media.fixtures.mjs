// Synthetic MP4 files for the media tests, written with the vendored mp4box (no binary fixtures, no ffmpeg).
import { createFile } from '../../app/vendor/mp4box/mp4box.all.mjs';

export const AVCC = new Uint8Array([1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0, 0x1e, 1, 0, 2, 0x68, 0xce]);

export const MATRIX = Object.freeze({
  0: [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824],
  90: [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824],
  180: [-65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824],
  270: [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824],
});

/**
 * makeMp4({ n, timescale, deltas?(i) -> ticks, bframes?, rotation?, width?, height?, gop? }) -> ArrayBuffer
 * Presentation times: cumulative deltas (ticks). With bframes, decode order is I P B B per group of 4 with
 * cts = presentation time (+ one frame of composition offset), dts = decode index * mean delta.
 */
export function makeMp4(o = {}) {
  const n = o.n ?? 48;
  const ts = o.timescale ?? 24000;
  const delta = o.deltas ?? (() => 100);
  const f = createFile();
  const id = f.addTrack({ width: o.width ?? 640, height: o.height ?? 360, timescale: ts, type: 'avc1', avcDecoderConfigRecord: AVCC.buffer });
  const pts = [];
  let t = 0;
  for (let i = 0; i < n; i++) { pts.push(t); t += delta(i); }
  let order = Array.from({ length: n }, (_, i) => i);
  if (o.bframes) {
    order = [];
    for (let g = 0; g < n; g += 4) {
      const grp = [g, g + 3, g + 1, g + 2].filter((k) => k < n);
      order.push(...grp);
    }
  }
  const gop = o.gop ?? (o.bframes ? 4 : 8);
  const off = o.bframes ? delta(0) : 0;
  order.forEach((p, d) => {
    const data = new Uint8Array([p & 255, (p >> 8) & 255, 0xab, d & 255]);
    f.addSample(id, data, { duration: delta(p), cts: pts[p] + off, dts: d * delta(0), is_sync: p % gop === 0 && order.indexOf(p) === d && (o.bframes ? p % 4 === 0 : true) });
  });
  if (o.rotation !== undefined) f.getTrackById(id).tkhd.matrix = MATRIX[o.rotation].slice();
  const ds = f.getBuffer();
  return ds.buffer.slice(0, ds.byteLength);
}

export function mp4Blob(o) {
  return new Blob([makeMp4(o)], { type: 'video/mp4' });
}
