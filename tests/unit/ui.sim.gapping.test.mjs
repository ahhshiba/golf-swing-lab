// Integration (V4-C follow-up 3): the round screen gives shotOutcome the SAME gapping table it gives recommendClub,
// so an unmeasured club flies the scaled carry the recommendation showed (not the unscaled reference).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendClub } from '../../app/src/sim/recommend.js';
import { shotOutcome } from '../../app/src/sim/engine.js';
import { gapping } from '../../app/src/store/stats.js';
import { simRows, previewEllipse } from '../../app/src/ui/round.js';

// a long hitter: only 7i and pw measured (n = 8), both ~15 % past the reference table
function shots() {
  const out = [];
  for (const [club, c] of Object.entries({ '7i': 170, pw: 130 })) {
    for (let i = 0; i < 8; i++) out.push({ capture: { view: 'face_on' }, club: { type: club }, metrics: { carry_m: { value: c + (i - 3.5) * 3, sigma: 8 }, total_m: { value: c + 10, sigma: 9 } } });
  }
  return out;
}
const rows = { gap: gapping(shots()), side: {} };
const owner = { player_id: 'p1', kind: 'owner', driver_carry_m: null };

test('UI path: sim carry of an unmeasured club ≈ the recommendation (dtl quick → prior; manual-free)', () => {
  for (const d of [190, 155, 110]) {
    const rec = recommendClub({ distance_m: d, lie: 'fairway', dz_m: 0, player: { ...owner, gapping: rows.gap } });
    assert.ok(!['7i', 'pw'].includes(rec.club), `${d} m → ${rec.club} should be unmeasured`);
    const r = simRows(owner, rows, rec.club);
    assert.equal(r.gap, null);
    const out = shotOutcome({ input: { kind: 'quick', result: { stage: 'provisional', metrics: {}, carry_source: null } }, view: 'dtl', club: rec.club, player: owner, rows: r, rules: {}, seed: 1, lie: 'fairway' });
    assert.ok(Math.abs(out.carry.value - rec.carry.median) <= 0.5, `${rec.club}: sim ${out.carry.value} vs rec ${rec.carry.median}`);
    // the preview ellipse the map draws sits at the same carry
    const pv = previewEllipse({ x: 0, y: 0 }, { x: 0, y: 300 }, rec.club, owner, r, 'fairway', 'parkland');
    assert.ok(Math.abs(pv.median - rec.carry.median) <= 0.5, `${rec.club}: preview ${pv.median} vs rec ${rec.carry.median}`);
  }
  // guests never use the owner's table
  assert.deepEqual(simRows({ kind: 'guest' }, rows, '5i'), { gap: null, side: null, gapping: [] });
});
