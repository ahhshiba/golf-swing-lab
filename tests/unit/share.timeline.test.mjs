// share/timeline.js + share/trails.js (V04-SPEC §D.1, §D.4; §G.3 V4-E 1): the tracer clip time line (≤ 12 s, swing
// ≤ 4 s, monotonic source mapping) for 240 / 60 / 30 fps, and the 8 trail colours (≥ 4.5 on the halo, pairwise
// CIEDE2000 ≥ 20) read from tokens.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTimeline, neededSourceTimes, slowFactor, OUT_FPS, SWING_MAX_S, FLIGHT_MAX_S, CARD_S, TOTAL_MAX_S } from '../../app/src/share/timeline.js';
import { TRAIL_TOKENS, parseColour, contrastRatio, ciede2000, ciede2000Lab } from '../../app/src/share/trails.js';

const ev = (address, impact) => ({ address: { t_s: address }, impact: { t_s: impact } });
const CASES = [
  { name: '240 fps, 2 s swing (sped up)', fps: 240, events: ev(0.2, 2.2), clip: 3, flightT: 6.1 },
  { name: '240 fps, 0.9 s window (quarter speed)', fps: 240, events: ev(0.5, 1.0), clip: 1.25, flightT: 5 },
  { name: '60 fps, 1.6 s swing', fps: 60, events: ev(1.0, 2.2), clip: 4, flightT: null, track: false },
  { name: '30 fps, 1.5 s swing', fps: 30, events: ev(0.4, 1.5), clip: 2.5, flightT: null },
  { name: '30 fps, very long address', fps: 30, events: ev(0.1, 9), clip: 10, flightT: 2 },
  { name: '240 fps, no events', fps: 240, events: null, clip: 3, flightT: 4 },
];

for (const c of CASES) {
  test(`timeline ${c.name}: total ≤ 12 s, swing ≤ 4 s, monotonic source times inside the clip`, () => {
    const tl = buildTimeline({ fps: c.fps, events: c.events, clipDuration_s: c.clip, flightT_s: c.flightT, ballTrack: c.track ?? true, card: true });
    assert.ok(tl.duration_s <= TOTAL_MAX_S + 1e-9, `total ${tl.duration_s}`);
    assert.ok(tl.swing.n / OUT_FPS <= SWING_MAX_S + 1e-9, `swing ${tl.swing.n / OUT_FPS}`);
    assert.ok(tl.flight.n / OUT_FPS <= FLIGHT_MAX_S + 1e-9);
    assert.equal(tl.card.n, CARD_S * OUT_FPS);
    assert.equal(tl.frames.length, tl.swing.n + tl.flight.n + tl.card.n);
    let prev = -Infinity;
    for (const f of tl.frames) {
      assert.ok(f.src_t >= prev - 1e-12, `source time goes back at k=${f.k}`);
      assert.ok(f.src_t >= 0 && f.src_t <= c.clip + 1e-9, `src ${f.src_t} outside the clip`);
      assert.ok(Math.abs(f.t_out - f.k / OUT_FPS) < 1e-12);
      prev = f.src_t;
    }
    const segs = tl.frames.map((f) => f.seg).join(',');
    assert.match(segs, /^(swing,)*(flight,)*(card,?)*$/);
    const fl = tl.frames.filter((f) => f.seg !== 'swing');
    for (let i = 1; i < fl.length; i++) assert.ok(fl[i].flight_t >= fl[i - 1].flight_t);
    if (c.events) {
      assert.ok(Math.abs(tl.swing.src_t0 - Math.max(0, c.events.address.t_s - 0.3)) < 1e-9);
      assert.ok(Math.abs(tl.swing.src_t1 - Math.min(c.clip, c.events.impact.t_s + 0.1)) < 1e-9);
      // the flight segment holds the swing's last frame (after impact; the mapping stays monotonic)
      assert.equal(tl.flight.src_t, tl.swing.src_t1);
      assert.ok(tl.flight.src_t > c.events.impact.t_s || tl.flight.src_t === c.clip);
    }
    assert.deepEqual(neededSourceTimes(tl), [...new Set(tl.frames.map((f) => f.src_t))].sort((a, b) => a - b));
  });
}

test('timeline: 240 fps at quarter speed takes every 2nd source frame; 60 fps half speed; long swings sped to 4 s', () => {
  assert.equal(slowFactor(240), 0.25);
  assert.equal(slowFactor(120), 0.5);
  assert.equal(slowFactor(60), 0.5);
  assert.equal(slowFactor(30), 1);
  const a = buildTimeline({ fps: 240, events: ev(0.5, 1.0), clipDuration_s: 1.25, flightT_s: 5 });
  assert.equal(a.swing.speed, 0.25);
  const dsrc = (a.frames[1].src_t - a.frames[0].src_t) * 240;
  assert.ok(Math.abs(dsrc - 2) < 1e-9, `${dsrc} source frames per output frame`);
  assert.equal(a.swing.n, Math.round((0.9 / 0.25) * 30)); // [0.2, 1.1] → 3.6 s
  const b = buildTimeline({ fps: 60, events: ev(1.0, 2.2), clipDuration_s: 4 });
  assert.equal(b.swing.speed, 0.5);
  const c = buildTimeline({ fps: 240, events: ev(0.2, 2.2), clipDuration_s: 3, flightT_s: 6.1 });
  assert.equal(c.swing.n, 120);
  assert.ok(Math.abs(c.swing.speed - 2.3 / 4) < 1e-9); // [0 (clamped), 2.3] in 4 s
  assert.equal(c.flight.n, 90); // a 6.1 s flight compressed into 3 s
  const d = buildTimeline({ fps: 240, events: ev(0.2, 1), clipDuration_s: 3, flightT_s: 1.2, card: false });
  assert.equal(d.flight.n, 36);
  assert.equal(d.card.n, 0);
  const e = buildTimeline({ fps: 60, events: ev(1, 2), clipDuration_s: 3, flightT_s: null, ballTrack: false });
  assert.equal(e.flight.n, 0, 'no flight and no track: no flight segment');
  // the trail is complete before the card starts
  const lastFlight = c.frames.filter((f) => f.seg === 'flight').at(-1);
  assert.equal(lastFlight.flight_t, 6.1);
});

// ---- trails (§D.4)
const css = fs.readFileSync(new URL('../../app/styles/tokens.css', import.meta.url), 'utf8');
const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf('--trail-1')));
const tokenValue = (name) => { const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(rootBlock); return m ? m[1].trim() : null; };
const HALO = parseColour(tokenValue('--media-bg'));

test('CIEDE2000 matches the Sharma–Wu–Dalal test pairs', () => {
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [50, 3.2592, 0.335], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  ];
  for (const [a, b, want] of pairs) assert.ok(Math.abs(ciede2000Lab(a, b) - want) < 1e-4, `${a} ${b}: ${ciede2000Lab(a, b)} vs ${want}`);
  assert.ok(ciede2000([255, 255, 255], [255, 255, 255]) < 1e-9);
});

test('8 trail tokens, defined once in :root; each ≥ 4.5 on the halo; pairwise CIEDE2000 ≥ 20', () => {
  assert.equal(TRAIL_TOKENS.length, 8);
  assert.ok(HALO, '--media-bg defined');
  const cols = TRAIL_TOKENS.map(({ token }) => {
    const v = tokenValue(token);
    assert.ok(v, `${token} in :root`);
    assert.equal((css.match(new RegExp(`${token}\\s*:`, 'g')) ?? []).length, 1, `${token} defined exactly once (theme-independent)`);
    return parseColour(v);
  });
  for (const [i, c] of cols.entries()) assert.ok(contrastRatio(c, HALO) >= 4.5, `trail-${i + 1} ${contrastRatio(c, HALO).toFixed(2)}`);
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const d = ciede2000(cols[i], cols[j]);
    assert.ok(d >= 20, `trail-${i + 1} vs trail-${j + 1}: ΔE00 ${d.toFixed(1)}`);
  }
  // the halo of --viz-tracer-halo (rgb 0 0 0 / .7) is the same black
  assert.deepEqual(parseColour(tokenValue('--viz-tracer-halo')), [0, 0, 0]);
});
