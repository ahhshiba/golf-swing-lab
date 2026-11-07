// share/card.js (V04-SPEC §D.3; §G.3 V4-E 2) on a recording fake canvas: every drawn distance / speed number has ± or
// a range next to it (in the same string), every fill / stroke colour comes from the palette, "indistinguishable"
// spread is written as words, the public cards never say "measured", the round card says "simulated".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setCatalog, flattenNamespace, setLocale } from '../../app/src/i18n/index.js';
import { drawShotCard, drawSessionCard, drawRoundCard, pmText, sessionSummary, roundScore, CARD_W, CARD_H } from '../../app/src/share/card.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
function loadLocale(loc) {
  const m = new Map();
  const dir = path.join(ROOT, 'app/i18n', loc);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) flattenNamespace(f.replace(/\.json$/, ''), read(`app/i18n/${loc}/${f}`), m);
  setCatalog(loc, m);
  return m;
}
const CAT = { 'zh-Hant': loadLocale('zh-Hant'), en: loadLocale('en') };

const PALETTE = Object.freeze({ bg: 'pal-bg', panel: 'pal-panel', line: 'pal-line', ink: 'pal-ink', muted: 'pal-muted', accent: 'pal-accent', font: 'sans-serif' });
const PAL_COLOURS = new Set(Object.values(PALETTE));

function fakeCanvas() {
  const calls = { text: [], fill: [], stroke: [] };
  const ctx = {
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1,
    set fillStyle(v) { calls.fill.push(v); }, get fillStyle() { return calls.fill.at(-1); },
    set strokeStyle(v) { calls.stroke.push(v); }, get strokeStyle() { return calls.stroke.at(-1); },
    measureText(s) { const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10); return { width: String(s).length * px * 0.55 }; },
    fillText(s, x, y) { calls.text.push(String(s)); },
  };
  for (const k of ['beginPath', 'moveTo', 'lineTo', 'arcTo', 'closePath', 'rect', 'fill', 'stroke', 'arc', 'save', 'restore', 'setLineDash', 'fillRect']) ctx[k] = () => {};
  return { canvas: { width: 0, height: 0, getContext: () => ctx }, calls };
}

// a distance / speed number in a drawn string: digits followed by a distance / speed unit of either locale
const UNIT_RE = /\d[\d,.]*\s*(yd|m|ft|mph|km\/h|m\/s|碼|公尺|英里\/時|公里\/時|公尺\/秒)(?![a-z])/i;
function assertEveryNumberHasUncertainty(texts, where) {
  for (const s of texts) {
    if (!UNIT_RE.test(s)) continue;
    assert.ok(/±/.test(s) || /\d\s*[–-]\s*\d/.test(s), `${where}: "${s}" has a distance/speed number without ± or a range`);
  }
}
function assertPaletteOnly(calls, where) {
  for (const c of [...calls.fill, ...calls.stroke]) assert.ok(PAL_COLOURS.has(c), `${where}: colour ${c} not from the palette`);
}
// "measured" as a validity word (the validity.valid label as a word of its own) or 實測 anywhere; "measuring error" is fine
const measuredWords = (loc) => [CAT[loc].get('validity.valid')];
const saysMeasured = (s, w) => s.includes('實測') || s === w || s.startsWith(`${w} `) || s.includes(` ${w}`) || s.includes(`${w} ·`);

const SHOTS = ['valid_face_on_240', 'valid_high_behind_240', 'valid_dtl_30', 'valid_face_on_240_no_clip'].map((n) => read(`tests/fixtures/shots/v2/${n}.json`));
const UNITS = [{ distance: 'yd', speed: 'mph' }, { distance: 'm', speed: 'm/s' }, { distance: 'm', speed: 'km/h' }];

for (const loc of ['zh-Hant', 'en']) {
  test(`${loc}: shot cards — ± on every distance/speed, palette colours only, never "measured"`, async () => {
    await setLocale(loc);
    for (const shot of SHOTS) for (const units of UNITS) {
      const { canvas, calls } = fakeCanvas();
      const r = drawShotCard(canvas, { shot, units, palette: PALETTE, locale: loc });
      assert.equal(canvas.width, CARD_W);
      assert.equal(canvas.height, CARD_H);
      assertEveryNumberHasUncertainty(calls.text, `${shot.shot_id} ${JSON.stringify(units)}`);
      assertPaletteOnly(calls, shot.shot_id);
      for (const w of measuredWords(loc)) assert.ok(!calls.text.some((s) => saysMeasured(s, w)), `"${w}" on a public card`);
      assert.ok(r.a11y.length > 0 && r.params.metrics.every((id) => shot.metrics[id].value !== null));
      // null metrics are not drawn
      assert.ok(!r.params.metrics.includes('launch_h_deg') || shot.metrics.launch_h_deg.value !== null);
    }
  });

  test(`${loc}: session card — club medians with P10–P90, ball speed ±, indistinguishable spread in words`, async () => {
    await setLocale(loc);
    const fo = SHOTS[0];
    const hb = SHOTS[1];
    const many = [];
    for (let i = 0; i < 6; i++) {
      const a = structuredClone(fo); a.shot_id = `fo-${i}`; a.metrics.carry_m.value += i * 3; a.metrics.carry_m.ci95 = [a.metrics.carry_m.value - 20, a.metrics.carry_m.value + 20];
      a.metrics.ball_speed_mps.value += i * 0.2; a.metrics.ball_speed_mps.ci95 = [a.metrics.ball_speed_mps.value - 1.8, a.metrics.ball_speed_mps.value + 1.8];
      many.push(a);
    }
    const hbTight = [];
    for (let i = 0; i < 5; i++) { // a spread far smaller than each shot's own σ → indistinguishable
      const b = structuredClone(hb); b.shot_id = `hb-${i}`; b.metrics.carry_side_m = { ...hb.metrics.carry_side_m, value: (i - 2) * 0.5 };
      if (b.metrics.carry_side_m.ci95) b.metrics.carry_side_m.ci95 = [b.metrics.carry_side_m.value - 15, b.metrics.carry_side_m.value + 15];
      b.metrics.carry_side_m.sigma = 7.5;
      hbTight.push(b);
    }
    for (const units of UNITS) {
      const { canvas, calls } = fakeCanvas();
      const r = drawSessionCard(canvas, { shots: [...many, ...hbTight], filter: {}, units, palette: PALETTE });
      assert.equal(canvas.width, CARD_W);
      assertEveryNumberHasUncertainty(calls.text, `session ${JSON.stringify(units)}`);
      assertPaletteOnly(calls, 'session');
      assert.equal(r.params.side, 'indistinguishable');
      const words = CAT[loc].get('share.card.spread_within_error');
      assert.ok(calls.text.includes(words), 'indistinguishable → the explanation, not a number');
      assert.ok(!calls.text.some((s) => s.startsWith(CAT[loc].get('share.card.side_spread').split('{')[0]) && /\d/.test(s)), 'no spread number when indistinguishable');
      for (const w of measuredWords(loc)) assert.ok(!calls.text.some((s) => saysMeasured(s, w)));
    }
    // a real spread → a ± number
    const wide = hbTight.map((b, i) => { const c = structuredClone(b); c.metrics.carry_side_m.value = (i - 2) * 25; c.metrics.carry_side_m.ci95 = [c.metrics.carry_side_m.value - 4, c.metrics.carry_side_m.value + 4]; c.metrics.carry_side_m.sigma = 2; return c; });
    const { canvas, calls } = fakeCanvas();
    const r = drawSessionCard(canvas, { shots: wide, filter: { view: 'high_behind' }, units: UNITS[0], palette: PALETTE });
    assert.equal(r.params.side, 'sd');
    assertEveryNumberHasUncertainty(calls.text, 'session wide');
    assert.ok(calls.text.some((s) => s.includes('±') && s.startsWith(CAT[loc].get('share.card.side_spread').split('{')[0])));
  });

  test(`${loc}: round card says "simulated", counts strokes, palette colours only`, async () => {
    await setLocale(loc);
    for (const f of ['valid_9_links_2p', 'valid_18_parkland_1p_finished', 'valid_manual_only']) {
      const round = read(`tests/fixtures/rounds/${f}.json`);
      const { canvas, calls } = fakeCanvas();
      const r = drawRoundCard(canvas, { round, playerId: round.players[0].player_id, palette: PALETTE });
      assert.ok(calls.text.includes(CAT[loc].get('share.card.simulated')), `${f}: the simulated mark`);
      assertPaletteOnly(calls, f);
      assertEveryNumberHasUncertainty(calls.text, f);
      const sc = roundScore(round).card.players.find((p) => p.player_id === round.players[0].player_id);
      assert.equal(r.params.total, sc.total);
      for (const w of measuredWords(loc)) assert.ok(!calls.text.some((s) => saysMeasured(s, w)));
    }
  });
}

test('pmText: ± never disappears; null → null', async () => {
  await setLocale('en');
  assert.equal(pmText({ value: 150, unit: 'm', ci95: [149.9, 150.1], sigma: null }, { distance: 'm' }, 'carry_m'), '150 ± 1 m');
  assert.equal(pmText({ value: 150, unit: 'm', ci95: [140, 160], sigma: null }, { distance: 'm' }, 'carry_m'), '150 ± 10 m');
  assert.equal(pmText({ value: null, unit: 'm', ci95: null, sigma: null }, { distance: 'm' }, 'carry_m'), null);
  assert.match(pmText({ value: 40, unit: 'm/s', ci95: null, sigma: 1 }, { speed: 'mph' }, 'club_speed_mps'), /± 4\.4 mph/);
});

test('sessionSummary: longest carry, per-club summaries sorted by median, side spread only from high_behind', () => {
  const s = sessionSummary(SHOTS);
  assert.equal(s.n, 4);
  assert.ok(s.longest && s.longest.metrics.carry_m.value === Math.max(...SHOTS.map((x) => x.metrics.carry_m.value ?? -Infinity)));
  for (let i = 1; i < s.clubs.length; i++) assert.ok(s.clubs[i - 1].median >= s.clubs[i].median);
  assert.equal(s.side, null, 'one high_behind shot: no spread');
});
