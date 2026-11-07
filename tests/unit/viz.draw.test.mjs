// LM-C acceptance 2 (LAUNCH-MONITOR-SPEC §5.2): every draw against a recording fake canvas (self-contained here; the
// shared tests/unit/_fakedom.mjs is not touched). Asserts: every strokeStyle / fillStyle / shadowColor is a value of
// the palette object (no colour literal anywhere), low-validity lines carry setLineDash([6, 4]), reduced motion draws
// the whole tracer, and every returned a11y key exists in app/i18n/{zh-Hant,en}/viz.json with the same placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  vizPalette, drawSide, drawTop, createTraj3d, drawTracer, projectFlight, drawBars, drawBox, quantile, seriesIndex,
} from '../../app/src/viz/index.js';

const catalog = (loc) => JSON.parse(fs.readFileSync(new URL(`../../app/i18n/${loc}/viz.json`, import.meta.url), 'utf8'));
const CAT = { 'zh-Hant': catalog('zh-Hant'), en: catalog('en') };
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/shots/v2/${name}.json`, import.meta.url), 'utf8'));

// palette values are opaque token names: if anything but these reaches a style property the test fails
const PALETTE = Object.freeze({
  series: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8].map((i) => `tok:--viz-series-${i}`)),
  seriesGlyph: Object.freeze(['circle', 'square', 'triangle', 'diamond', 'down', 'plus', 'cross', 'ring']),
  axis: 'tok:--viz-axis', grid: 'tok:--viz-grid', text: 'tok:--viz-text', target: 'tok:--viz-target', ciAlpha: 0.18,
  tracer: 'tok:--viz-tracer', halo: 'tok:--viz-tracer-halo', bg: 'tok:--viz-bg', ink: 'tok:--text', font: 'system-ui', dark: true,
});
const SUN = Object.freeze({ ...PALETTE, ciAlpha: 0, dark: false });
const ALLOWED = new Set([...PALETTE.series, PALETTE.axis, PALETTE.grid, PALETTE.text, PALETTE.target, PALETTE.tracer, PALETTE.halo, PALETTE.bg, PALETTE.ink]);
const STYLE_PROPS = ['strokeStyle', 'fillStyle', 'shadowColor'];

function fakeCanvas(w = 390, h = 330) {
  const log = [];
  const state = { strokeStyle: null, fillStyle: null, shadowColor: null, dash: [], alpha: 1 };
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'getLineDash') return () => state.dash;
      if (STYLE_PROPS.includes(k)) return state[k];
      if (k === 'globalAlpha') return state.alpha;
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      return (...args) => {
        if (k === 'setLineDash') state.dash = [...args[0]];
        log.push({ op: k, args, strokeStyle: state.strokeStyle, fillStyle: state.fillStyle, dash: [...state.dash], alpha: state.alpha });
      };
    },
    set(_, k, v) {
      if (STYLE_PROPS.includes(k)) state[k] = v;
      if (k === 'globalAlpha') state.alpha = v;
      log.push({ op: 'set', key: k, value: v });
      return true;
    },
  });
  const listeners = new Map();
  return {
    width: w, height: h, log, style: {},
    getContext: () => ctx,
    addEventListener: (ev, fn) => listeners.set(ev, fn),
    removeEventListener: (ev) => listeners.delete(ev),
    fire: (ev, e) => listeners.get(ev)?.(e),
    listeners,
  };
}

function assertPaletteOnly(c) {
  const sets = c.log.filter((e) => e.op === 'set' && STYLE_PROPS.includes(e.key));
  assert.ok(sets.length > 0, 'something was drawn');
  for (const e of sets) assert.ok(ALLOWED.has(e.value), `${e.key} = ${JSON.stringify(e.value)} is not a palette value`);
  for (const e of c.log) if (e.op === 'createLinearGradient' || e.op === 'createRadialGradient' || e.op === 'createPattern') assert.fail(`${e.op} bypasses the palette`);
}
const strokedWith = (c, dash, colour) => c.log.some((e) => (e.op === 'stroke' || e.op === 'strokeRect') && JSON.stringify(e.dash) === JSON.stringify(dash) && (!colour || e.strokeStyle === colour));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function assertA11y(r) {
  assert.match(r.a11y, /^viz\./);
  const key = r.a11y.slice(4);
  for (const loc of ['zh-Hant', 'en']) assert.ok(typeof CAT[loc][key] === 'string', `${r.a11y} missing in ${loc}/viz.json`);
  assert.deepEqual(placeholders(CAT['zh-Hant'][key]), placeholders(CAT.en[key]), `${r.a11y}: placeholders differ`);
  for (const p of placeholders(CAT.en[key])) assert.ok(r.params && p in r.params, `${r.a11y}: param {${p}} not returned`);
  return r;
}

const seen = new Set();
const check = (r) => { seen.add(assertA11y(r).a11y); return r; };

const fo = fixture('valid_face_on_240');
const hb = fixture('valid_high_behind_240');
const flight = (shot, validity, extra = {}) => ({ samples: shot.flight.samples, club: shot.club.type, validity, band: shot.flight.band, rest: shot.flight.rest, ...extra });

test('vizPalette reads the --viz-* tokens through getComputedStyle', () => {
  const tokens = { '--viz-bg': '#07100B', '--viz-ci-alpha': ' .18', '--text': 'rgb(234 242 237)', '--font': 'system-ui' };
  for (let i = 1; i <= 8; i++) tokens[`--viz-series-${i}`] = `s${i}`;
  for (const k of ['axis', 'grid', 'text', 'target', 'tracer', 'tracer-halo']) tokens[`--viz-${k}`] = `v-${k}`;
  const el = { ownerDocument: { defaultView: { getComputedStyle: () => ({ color: 'c', getPropertyValue: (n) => tokens[n] ?? '' }) } } };
  const p = vizPalette(el);
  assert.deepEqual(p.series, ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
  assert.equal(p.axis, 'v-axis');
  assert.equal(p.halo, 'v-tracer-halo');
  assert.equal(p.ink, 'rgb(234 242 237)');
  assert.equal(p.ciAlpha, 0.18);
  assert.equal(p.dark, true);
  assert.equal(p.seriesGlyph.length, 8);
  assert.equal(new Set(p.seriesGlyph).size, 8, 'a distinct shape per series');
});

test('series follow the CLUBS order; off-list clubs map to a neighbour', () => {
  assert.deepEqual(['driver', '3w', 'hybrid', '5i', '7i', '9i', 'pw', 'sw'].map((c) => seriesIndex(c)), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(seriesIndex('6i'), 4);
  assert.equal(seriesIndex({ type: 'pw' }), 6);
  assert.equal(seriesIndex('7i', 9), 1);
});

test('drawSide: single estimated flight with ±1σ band, low-confidence dashed, overlays, empty', () => {
  let c = fakeCanvas();
  let r = check(drawSide(c, { flights: [flight(fo, 'estimated', { sigma: { carry: 8, apex: 2 } })], units: { distance: 'yd' }, palette: PALETTE, target_m: 160 }));
  assertPaletteOnly(c);
  assert.equal(r.a11y, 'viz.side.one');
  assert.ok(c.log.some((e) => e.op === 'fill' && e.alpha === PALETTE.ciAlpha && e.fillStyle === PALETTE.series[seriesIndex('driver')]), 'CI band filled at ciAlpha');
  assert.ok(strokedWith(c, [], PALETTE.series[0]), 'estimated line is solid');
  assert.ok(!strokedWith(c, [6, 4]), 'no dashed line for an estimated flight');

  c = fakeCanvas();
  r = check(drawSide(c, { flights: [flight(hb, 'low_confidence', { sigma: { carry: 17, apex: 4 } })], units: { distance: 'm' }, palette: SUN }));
  assertPaletteOnly(c);
  assert.equal(r.a11y, 'viz.side.one_low');
  assert.ok(strokedWith(c, [6, 4], PALETTE.series[seriesIndex('6i')]), 'low confidence → setLineDash([6,4]) on the flight line');
  assert.ok(!c.log.some((e) => e.op === 'fill' && e.alpha > 0 && e.alpha < 1), 'sun: no translucent fill');

  c = fakeCanvas();
  const many = Array.from({ length: 250 }, (_, i) => flight(i % 2 ? fo : hb, i % 3 ? 'estimated' : 'low_confidence', { club: ['driver', '7i', 'pw'][i % 3] }));
  r = check(drawSide(c, { flights: many, units: { distance: 'yd' }, palette: PALETTE }));
  assertPaletteOnly(c);
  assert.equal(r.a11y, 'viz.side.many_sampled');
  assert.equal(r.params.shown, 200);
  assert.ok(strokedWith(c, [6, 4]));

  c = fakeCanvas();
  check(drawSide(c, { flights: [flight(fo, 'estimated'), flight(hb, 'estimated')], units: {}, palette: PALETTE }));
  assertPaletteOnly(c);
  c = fakeCanvas();
  check(drawSide(c, { flights: [], units: {}, palette: PALETTE }));
  assertPaletteOnly(c);
});

test('drawTop: hb point with ellipse, face_on point on the "?" strip, mixed cloud keeps the planes apart', () => {
  let c = fakeCanvas();
  let r = check(drawTop(c, { points: [{ x: 158, y: 3.1, sx: 17, sy: 11, club: '6i', validity: 'low_confidence', band: hb.flight.band }], paths: [{ samples: hb.flight.samples, club: '6i', validity: 'low_confidence' }], units: { distance: 'yd' }, palette: PALETTE, target: { x: 150, y: 0 } }));
  assertPaletteOnly(c);
  assert.equal(r.a11y, 'viz.top.one');
  assert.ok(strokedWith(c, [6, 4], PALETTE.series[seriesIndex('6i')]), 'low-confidence ellipse / path dashed');

  c = fakeCanvas();
  r = check(drawTop(c, { points: [{ x: 181, y: null, sx: 9, sy: null, club: 'driver', validity: 'estimated' }], units: { distance: 'm' }, palette: PALETTE }));
  assertPaletteOnly(c);
  assert.equal(r.a11y, 'viz.top.one_unknown');
  assert.deepEqual([r.params.n_plane, r.params.n_strip], [0, 1]);

  c = fakeCanvas();
  const pts = [];
  for (let i = 0; i < 60; i++) pts.push({ x: 140 + (i % 7) * 3, y: i % 2 ? null : ((i % 5) - 2) * 4, sx: 8, sy: i % 2 ? null : 6, club: ['7i', 'driver', 'pw'][i % 3], validity: i % 4 ? 'estimated' : 'low_confidence' });
  r = check(drawTop(c, { points: pts, units: { distance: 'yd' }, palette: SUN, target: 150 }));
  assertPaletteOnly(c);
  assert.equal(r.a11y, 'viz.top.many');
  assert.deepEqual([r.params.n_plane, r.params.n_strip], [30, 30]);

  c = fakeCanvas();
  r = check(drawTop(c, { points: Array.from({ length: 230 }, (_, i) => ({ x: 100 + i % 40, y: (i % 9) - 4, sx: 5, sy: 4, club: 'pw', validity: 'estimated' })), units: {}, palette: PALETTE }));
  assert.equal(r.a11y, 'viz.top.many_sampled');
  assertPaletteOnly(c);
  c = fakeCanvas();
  r = check(drawTop(c, { points: [], paths: [{ samples: hb.flight.samples, club: '6i', validity: 'estimated' }], units: {}, palette: PALETTE }));
  assert.equal(r.a11y, 'viz.top.path');
  assertPaletteOnly(c);
  check(drawTop(fakeCanvas(), { points: [], units: {}, palette: PALETTE }));
});

test('createTraj3d: draws, rotates, switches pitch, reports a11y, low dashed, destroy removes listeners', () => {
  const c = fakeCanvas();
  const changes = [];
  const v = createTraj3d(c, { flights: [flight(fo, 'estimated'), flight(hb, 'low_confidence')], palette: PALETTE, units: { distance: 'yd' }, onChange: (x) => changes.push(x) });
  assertPaletteOnly(c);
  check({ a11y: v.a11y, params: v.params });
  assert.ok(strokedWith(c, [6, 4], PALETTE.series[seriesIndex('6i')]));
  const r = check(v.rotate(15));
  assert.equal(r.params.yaw, v.view.yaw);
  const y0 = v.view.yaw;
  check(v.setPitch('top'));
  assert.equal(v.view.mode, 'top');
  check(v.setPitch('oblique'));
  assert.ok(changes.length >= 4);
  assert.equal(c.style.touchAction, 'none');
  c.fire('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, isPrimary: true });
  c.fire('pointermove', { clientX: 140, clientY: 100, pointerId: 1 });
  assert.ok(Math.abs(v.view.yaw - (y0 - 16)) < 1e-9, 'drag 40 px → −16° yaw');
  c.fire('pointerup', { pointerId: 1 });
  c.fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.ok(Math.abs(v.view.yaw - (y0 - 16 + 15)) < 1e-9);
  v.destroy();
  assert.equal(c.listeners.size, 0);
  assertPaletteOnly(c);
  const m = createTraj3d(fakeCanvas(), { flights: Array.from({ length: 220 }, (_, i) => flight(i % 2 ? fo : hb, 'estimated', { club: '7i' })), palette: PALETTE, units: { distance: 'm' } });
  assert.equal(check({ a11y: m.a11y, params: m.params }).a11y, 'viz.traj3d.alt_sampled');
  const e = fakeCanvas();
  check({ a11y: createTraj3d(e, { flights: [], palette: SUN, units: {} }).a11y, params: { n: 0 } });
});

test('drawTracer: two strokes (halo 4 px + bright 2 px), grows by frame, reduced motion draws everything', () => {
  const proj = projectFlight(fo.calibration.camera, fo.flight.samples);
  const size = [fo.calibration.camera.W, fo.calibration.camera.H];
  let c = fakeCanvas(960, 540);
  let r = check(drawTracer(c, { track: fo.tracks, projected: proj, frame: fo.tracks.impact_frame + 3, palette: PALETTE, reducedMotion: false, size }));
  assertPaletteOnly(c);
  assert.equal(r.params.detected, 4);
  assert.equal(r.params.simulated, 0);
  const strokes = c.log.filter((e) => e.op === 'stroke');
  assert.ok(strokes.some((s) => s.strokeStyle === PALETTE.halo) && strokes.some((s) => s.strokeStyle === PALETTE.tracer));
  const widths = c.log.filter((e) => e.op === 'set' && e.key === 'lineWidth').map((e) => e.value);
  assert.ok(widths.includes(4) && widths.includes(2));

  c = fakeCanvas(960, 540);
  r = check(drawTracer(c, { track: fo.tracks, projected: proj, frame: fo.tracks.impact_frame + 3, palette: PALETTE, reducedMotion: true, size }));
  assert.equal(r.params.detected, fo.tracks.ball_px.length);
  assert.equal(r.params.simulated, proj.filter(Boolean).length);
  assert.equal(r.params.complete, true);
  assert.ok(strokedWith(c, [2, 6], PALETTE.tracer), 'simulated part dotted');
  assertPaletteOnly(c);

  c = fakeCanvas(960, 540);
  r = check(drawTracer(c, { track: fo.tracks, projected: proj, frame: fo.tracks.impact_frame + 60, palette: PALETTE, reducedMotion: false, size, times: fo.flight.samples.map((s) => s[0]), fps: 240 }));
  assert.ok(r.params.simulated > 0 && r.params.simulated < proj.length, 'grows with the video time');

  c = fakeCanvas();
  check(drawTracer(c, { track: null, projected: [], frame: 0, palette: PALETTE, reducedMotion: false }));
});

test('drawBars / drawBox: palette only, signed bars, low dashed, quantiles', () => {
  let c = fakeCanvas();
  const bars = [-6, 3, 12, -1, 0.5].map((v, i) => ({ label: String(i + 1), value: v, lo: v - 2, hi: v + 2, club: '7i', validity: i === 2 ? 'low_confidence' : 'estimated' }));
  let r = check(drawBars(c, { bars, palette: PALETTE, kind: 'distance', units: { distance: 'yd' } }));
  assertPaletteOnly(c);
  assert.equal(r.params.n, 5);
  assert.ok(strokedWith(c, [6, 4], PALETTE.series[seriesIndex('7i')]));
  c = fakeCanvas();
  check(drawBars(c, { bars: [], palette: PALETTE }));

  c = fakeCanvas();
  const groups = [['driver', 200], ['7i', 140], ['pw', 100]].map(([club, m], k) => ({ label: club, club, values: Array.from({ length: 21 }, (_, i) => m + (i - 10) * (1 + k)) }));
  r = check(drawBox(c, { groups, palette: SUN, kind: 'distance', units: { distance: 'm' } }));
  assertPaletteOnly(c);
  assert.deepEqual([r.params.groups, r.params.n], [3, 63]);
  c = fakeCanvas();
  check(drawBox(c, { groups: [{ label: 'x', stats: { p10: 1, q1: 2, median: 3, q3: 4, p90: 5 } }], palette: PALETTE, unit: 'rpm' }));
  check(drawBox(fakeCanvas(), { groups: [], palette: PALETTE }));

  // numpy.percentile(method='linear') reference values
  const v = [3, 1, 4, 1, 5, 9, 2, 6].sort((a, b) => a - b);
  assert.ok(Math.abs(quantile(v, 0.1) - 1) < 1e-12);
  assert.ok(Math.abs(quantile(v, 0.25) - 1.75) < 1e-12);
  assert.ok(Math.abs(quantile(v, 0.5) - 3.5) < 1e-12);
  assert.ok(Math.abs(quantile(v, 0.9) - 6.9) < 1e-12);
});

test('every a11y key the draws can return was exercised and exists in both catalogs', () => {
  const src = fs.readdirSync(new URL('../../app/src/viz/', import.meta.url)).map((f) => fs.readFileSync(new URL(`../../app/src/viz/${f}`, import.meta.url), 'utf8')).join('\n');
  const returned = new Set([...src.matchAll(/'(viz\.(?:side|top|tracer|traj3d|bars|box)\.(?:empty|one|one_low|one_unknown|many|many_sampled|path|alt|alt_sampled|none))'/g)].map((m) => m[1]));
  assert.ok(returned.size >= 15, `found ${returned.size} keys`);
  for (const k of returned) for (const loc of ['zh-Hant', 'en']) assert.ok(CAT[loc][k.slice(4)], `${k} in ${loc}`);
  const missed = [...returned].filter((k) => !seen.has(k));
  assert.deepEqual(missed, [], 'every a11y key exercised by a test above');
});

test('no colour literal in app/src/viz (hex, rgb(), named colours other than the getComputedStyle fallback)', () => {
  for (const f of fs.readdirSync(new URL('../../app/src/viz/', import.meta.url))) {
    const s = fs.readFileSync(new URL(`../../app/src/viz/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /['"`]#[0-9a-f]{3,8}['"`]/i, f);
    assert.doesNotMatch(s, /['"`](rgba?|hsla?)\(/i, f);
    assert.doesNotMatch(s, /\bfrom '(https?:|[a-z@])/, f);
  }
});
