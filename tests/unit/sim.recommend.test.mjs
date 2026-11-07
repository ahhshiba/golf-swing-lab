// V04-SPEC §G.3 V4-C acceptance 7: fixture gapping table → expected club; n < 5 → small_sample; no driver from a bunker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendClub } from '../../app/src/sim/recommend.js';
import { gapping } from '../../app/src/store/stats.js';

// a fixture gapping table built through store/stats.js gapping() from synthetic face_on shots
function shots() {
  const carries = { driver: 215, '3w': 195, hybrid: 178, '5i': 165, '7i': 148, '9i': 128, pw: 112, sw: 85 };
  const out = [];
  for (const [club, c] of Object.entries(carries)) {
    const n = club === 'hybrid' ? 3 : 8;
    for (let i = 0; i < n; i++) {
      out.push({ capture: { view: 'face_on' }, club: { type: club }, metrics: { carry_m: { value: c + (i - (n - 1) / 2) * 3, sigma: 8 }, total_m: { value: c + 10, sigma: 9 } } });
    }
  }
  return out;
}
const rows = gapping(shots());
const owner = { player_id: 'p1', kind: 'owner', driver_carry_m: null, gapping: rows };

test('fixture gapping table → the club whose median carry is nearest the plays-like distance', () => {
  const cases = [[150, 'fairway', 0, '7i'], [126, 'fairway', 0, '9i'], [110, 'fairway', 0, 'pw'], [80, 'fairway', 0, 'sw'], [215, 'tee', 0, 'driver'],
    [196, 'fairway', 0, '3w'], [138, 'fairway', 10, '7i'], [158, 'fairway', -12, '7i'], [300, 'tee', 0, 'driver']];
  for (const [d, lie, dz, want] of cases) {
    const r = recommendClub({ distance_m: d, lie, dz_m: dz, player: owner });
    assert.equal(r.club, want, `${d} m ${lie} dz ${dz}`);
    assert.equal(r.source, 'gapping');
    assert.ok(r.carry.p10 < r.carry.median && r.carry.median < r.carry.p90);
    assert.equal(r.alts.length, 2);
    assert.ok(!r.alts.includes(r.club));
  }
  assert.equal(recommendClub({ distance_m: 138, lie: 'fairway', dz_m: 10, player: owner }).plays_like_m, 148, 'uphill plays longer');
});

test('n < 5 for the chosen club → reference carry + small_sample; no table → reference', () => {
  const r = recommendClub({ distance_m: 178, lie: 'fairway', dz_m: 0, player: { ...owner, driver_carry_m: 215 } });
  assert.equal(r.club, 'hybrid');
  assert.equal(r.source, 'reference');
  assert.deepEqual(r.flags, ['small_sample']);
  const g = recommendClub({ distance_m: 100, lie: 'fairway', dz_m: 0, player: { player_id: 'g', kind: 'guest', driver_carry_m: 200 } });
  assert.equal(g.club, 'pw');
  assert.equal(g.source, 'reference');
  assert.deepEqual(g.flags, []);
});

test('lies: never the driver from a bunker (or off the tee); rough plays longer; greenside bunker → sw; green → putter', () => {
  const b = recommendClub({ distance_m: 230, lie: 'bunker', dz_m: 0, player: owner });
  assert.notEqual(b.club, 'driver');
  assert.ok(!b.alts.includes('driver'));
  assert.notEqual(recommendClub({ distance_m: 230, lie: 'fairway', dz_m: 0, player: owner }).club, 'driver');
  assert.equal(recommendClub({ distance_m: 133, lie: 'rough', dz_m: 0, player: owner }).club, '7i', 'rough: 7i × 0.9 = 133');
  assert.equal(recommendClub({ distance_m: 20, lie: 'bunker', dz_m: 0, player: owner }).club, 'sw');
  const p = recommendClub({ distance_m: 6.3, lie: 'green', dz_m: 0, player: owner });
  assert.equal(p.club, 'putter');
  assert.deepEqual(p.alts, []);
  assert.throws(() => recommendClub({ distance_m: -1, lie: 'fairway', player: owner }), RangeError);
});

test('short hitter with only some clubs measured: reference carries scaled to the player, monotonic, driver off the tee', async () => {
  const { playerCarries } = await import('../../app/src/sim/recommend.js');
  const { CLUBS } = await import('../../app/src/session/settings.js');
  // measured: driver 170, 7i 115, pw 85 (n = 8); everything else unmeasured (reference 3w = 180 > 170 before the fix)
  const mk = (club, c) => Array.from({ length: 8 }, (_, i) => ({ capture: { view: 'face_on' }, club: { type: club }, metrics: { carry_m: { value: c + (i - 3.5) * 2, sigma: 8 }, total_m: { value: c + 8, sigma: 9 } } }));
  const short = { player_id: 's', kind: 'owner', driver_carry_m: null, gapping: gapping([...mk('driver', 170), ...mk('7i', 115), ...mk('pw', 85)]) };
  const list = playerCarries(short, short.gapping);
  assert.deepEqual(list.map((x) => x.club), CLUBS.map((c) => c[0]));
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].median > list[i].median, `${list[i - 1].club} ${list[i - 1].median} > ${list[i].club} ${list[i].median}`);
  for (const x of list) {
    if (['driver', '7i', 'pw'].includes(x.club)) {
      assert.equal(x.source, 'gapping');
      assert.equal(x.scaled, false);
      assert.ok(x.reason_codes.includes('GAPPING_PRIOR'));
    } else {
      assert.equal(x.scaled, true);
      assert.equal(x.validity, 'low_confidence');
      assert.ok(x.reason_codes.includes('REFERENCE_PRIOR'));
    }
  }
  assert.equal(list.find((x) => x.club === 'driver').median, 170, 'personal data used as is');
  assert.ok(list.find((x) => x.club === '3w').median < 170);
  const r = recommendClub({ distance_m: 380, lie: 'tee', dz_m: 0, player: short });
  assert.equal(r.club, 'driver');
  assert.equal(r.source, 'gapping');
  const mid = recommendClub({ distance_m: 150, lie: 'fairway', dz_m: 0, player: short });
  assert.ok(mid.scaled && mid.reason_codes.includes('REFERENCE_PRIOR') && mid.validity === 'low_confidence', JSON.stringify(mid));
  // no personal data at all → plain reference (unscaled), still monotonic
  const ref = playerCarries({ driver_carry_m: 200 }, []);
  assert.ok(ref.every((x) => !x.scaled && x.source === 'reference'));
  for (let i = 1; i < ref.length; i++) assert.ok(ref[i - 1].median > ref[i].median);
});
