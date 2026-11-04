// import/timebase.js math and import/{demux,probe}.js on synthetic MP4s written with the vendored mp4box.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rotationFromMatrix, displaySize, displayPoint, ctsStats, buildTimebase, gridIndices, rangeIndices, impactWindow, VFR_CV_LIMIT,
} from '../../app/src/import/timebase.js';
import { openDemuxer, codecFamily, DemuxError } from '../../app/src/import/demux.js';
import { probeFile } from '../../app/src/import/probe.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { MATRIX, AVCC, mp4Blob } from './media.fixtures.mjs';

test('rotation from the tkhd matrix (16.16 fixed point), incl. mirror flag', () => {
  for (const r of [0, 90, 180, 270]) {
    const got = rotationFromMatrix(MATRIX[r]);
    assert.equal(got.rotation, r);
    assert.equal(got.mirrored, false);
    assert.equal(got.exact, true);
  }
  assert.equal(rotationFromMatrix([-65536, 0, 0, 0, 65536, 0, 0, 0, 1 << 30]).mirrored, true);
  assert.equal(rotationFromMatrix(null).rotation, 0);
  assert.deepEqual(displaySize(1920, 1080, 90), { width: 1080, height: 1920 });
  assert.deepEqual(displaySize(1920, 1080, 180), { width: 1920, height: 1080 });
  // 90: coded (x, y) -> display (H - y, x); corners stay corners
  assert.deepEqual(displayPoint(0, 0, 90, 1920, 1080), [1080, 0]);
  assert.deepEqual(displayPoint(1920, 1080, 90, 1920, 1080), [0, 1920]);
  assert.deepEqual(displayPoint(10, 20, 270, 1920, 1080), [20, 1910]);
  assert.deepEqual(displayPoint(10, 20, 180, 1920, 1080), [1910, 1060]);
});

test('effective fps = (n-1)/(t_last - t_first); VFR when CV of deltas > 5 %', () => {
  const n = 481;
  const cfr = Float64Array.from({ length: n }, (_, i) => i / 240);
  const s = ctsStats(cfr);
  assert.ok(Math.abs(s.effective_fps - 240) < 1e-9);
  assert.equal(s.vfr, false);
  assert.ok(s.cv < 1e-9);
  // alternating 1/200 and 1/280 deltas: CV ~ 0.17
  const t = [0];
  for (let i = 1; i < n; i++) t.push(t[i - 1] + (i % 2 ? 1 / 200 : 1 / 280));
  const v = ctsStats(t);
  assert.equal(v.vfr, true);
  assert.ok(v.cv > VFR_CV_LIMIT);
  assert.ok(Math.abs(v.effective_fps - (n - 1) / t[n - 1]) < 1e-9);
  // a small jitter (1 %) is not VFR
  const j = [0];
  for (let i = 1; i < n; i++) j.push(j[i - 1] + (1 / 240) * (1 + (i % 2 ? 0.01 : -0.01)));
  assert.equal(ctsStats(j).vfr, false);
});

test('buildTimebase sorts decode order into presentation order; non-monotonic CTS -> nominal + TIMESTAMPS_NOMINAL', () => {
  const ts = 600;
  const dec = [0, 30, 10, 20, 40, 70, 50, 60].map((c) => ({ cts: c, timescale: ts }));
  const tb = buildTimebase(dec);
  assert.deepEqual(Array.from(tb.t_s, (x) => Math.round(x * ts)), [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.deepEqual(Array.from(tb.order), [0, 2, 3, 1, 4, 6, 7, 5]);
  for (let p = 0; p < 8; p++) assert.equal(tb.pres[tb.order[p]], p);
  assert.equal(tb.timestamps, 'container');
  assert.deepEqual(tb.reason_codes, []);
  assert.ok(Math.abs(tb.effective_fps - 60) < 1e-9);
  const dup = buildTimebase([0, 10, 10, 20].map((c) => ({ cts: c, timescale: ts })), { nominal_fps: 30 });
  assert.equal(dup.timestamps, 'nominal');
  assert.deepEqual(dup.reason_codes, [RC.TIMESTAMPS_NOMINAL]);
  assert.deepEqual(Array.from(dup.t_s), [0, 1 / 30, 2 / 30, 3 / 30]);
  const missing = buildTimebase([{ cts: 0, timescale: 0 }, { cts: 1, timescale: 0 }]);
  assert.equal(missing.timestamps, 'nominal');
});

test('gridIndices picks the frame nearest each 1/hz grid point; rangeIndices / impactWindow', () => {
  const t = Float64Array.from({ length: 241 }, (_, i) => i / 240);
  const g = gridIndices(t, 60);
  assert.equal(g.length, 61);
  assert.deepEqual(Array.from(g.slice(0, 4)), [0, 4, 8, 12]);
  // VFR clip: every grid frame is within half a period of its grid point
  const v = [0];
  for (let i = 1; i < 500; i++) v.push(v[i - 1] + (i % 3 ? 1 / 230 : 1 / 260));
  const gv = gridIndices(v, 60);
  gv.forEach((idx, k) => assert.ok(Math.abs(v[idx] - k / 60) <= 1 / 120 + 1e-12));
  assert.equal(new Set(gv).size, gv.length);
  assert.deepEqual(Array.from(gridIndices(t, 0, 0.5, 0.52)), [120, 121, 122, 123, 124]);
  assert.deepEqual(rangeIndices(t, 0.5, 0.6), [120, 144]);
  const w = impactWindow(1.0, 240);
  assert.ok(Math.abs(w.from_s - (1 - 30 / 240)) < 1e-12 && Math.abs(w.to_s - (1 + 60 / 240)) < 1e-12);
  assert.deepEqual(impactWindow(0.05, 240, { t_min: 0, t_max: 0.2 }), { from_s: 0, to_s: 0.2 });
});

test('probeFile on a synthetic 240 fps MP4 with rotation 90 (moov parsed in 64-byte chunks)', async () => {
  const blob = mp4Blob({ n: 120, timescale: 24000, deltas: () => 100, rotation: 90, width: 1920, height: 1080 });
  const dm = await openDemuxer(blob, { chunkSize: 64 });
  assert.equal(dm.samples.length, 120);
  assert.deepEqual(Array.from(dm.description), Array.from(AVCC));
  const p = await probeFile(blob, { demuxer: dm });
  assert.equal(p.codec, 'avc1.42001e');
  assert.equal(p.family, 'avc');
  assert.equal(p.rotation, 90);
  assert.equal(p.width, 1920);
  assert.equal(p.display_width, 1080);
  assert.equal(p.display_height, 1920);
  assert.equal(p.sample_count, 120);
  assert.ok(Math.abs(p.effective_fps - 240) < 1e-9, String(p.effective_fps));
  assert.ok(Math.abs(p.nominal_fps - 240) < 1e-9, String(p.nominal_fps));
  assert.equal(p.vfr, false);
  assert.equal(p.timestamps, 'container');
  assert.equal(p.cts_s.length, 120);
  assert.ok(Math.abs(p.cts_s[1] - 1 / 240) < 1e-12);
  // payloads come back byte-exact, in decode order
  let k = 0;
  for await (const s of dm.readSamples(0, 119, 50)) {
    assert.equal(s.index, k);
    assert.deepEqual(Array.from(s.data), [k & 255, 0, 0xab, k & 255]);
    k++;
  }
  assert.equal(k, 120);
});

test('probeFile: VFR and B-frame clips', async () => {
  const vfr = await probeFile(mp4Blob({ n: 200, timescale: 24000, deltas: (i) => (i % 2 ? 80 : 120) }));
  assert.equal(vfr.vfr, true);
  assert.ok(Math.abs(vfr.effective_fps - 199 / (vfr.cts_s[199] - vfr.cts_s[0])) < 1e-9);
  const b = await probeFile(mp4Blob({ n: 16, timescale: 6000, deltas: () => 100, bframes: true }));
  assert.equal(b.timestamps, 'container');
  for (let i = 1; i < b.cts_s.length; i++) assert.ok(b.cts_s[i] > b.cts_s[i - 1]);
  assert.ok(Math.abs(b.effective_fps - 60) < 1e-9);
  assert.equal(b.rotation, 0);
});

test('demux errors carry protocol codes', async () => {
  await assert.rejects(openDemuxer(new Blob([new Uint8Array(1000).fill(7)])), (e) => e instanceof DemuxError && e.code === 'DEMUX_FAILED');
  await assert.rejects(openDemuxer(new Blob([])), (e) => e.code === 'DEMUX_FAILED');
  assert.equal(codecFamily('hvc1.1.6.L153.B0'), 'hevc');
  assert.equal(codecFamily('hev1.1.6.L120.90'), 'hevc');
  assert.equal(codecFamily('avc1.64002A'), 'avc');
  assert.equal(codecFamily('mp4a.40.2'), 'other');
});
