// LAUNCH-MONITOR-SPEC §5.2 LM-B acceptance 3 (regression lock; change the model -> change
// docs/research/launch-monitor-physics.md in the same change): the spin-loft model reproduces the RN §2 tour table
// spin of all 7 rows within 1 % (A_club fitted self-consistently through the same inverse D-plane), and the RK4 flight
// reproduces the RN §4 recorded carry / apex / landing angle / hang time of driver, 7-iron and PW.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LM_PARAMS } from '../../app/src/physics/lm/params.js';
import { inverseVertical } from '../../app/src/physics/lm/dplane.js';
import { spinFromLoft } from '../../app/src/physics/lm/spin.js';
import { fly } from '../../app/src/physics/lm/flight.js';

const MPH = 0.44704;
// RN §4 table (lm/flight.py replica of the same aerodynamics): carry m, apex m, landing °, hang s
const RN4 = {
  driver: { ball_mph: 167, launch: 10.9, spin: 2686, carry: 240.4, apex: 31.7, landing: 39.9, hang: 6.82 },
  iron_mid: { ball_mph: 120, launch: 16.3, spin: 7097, carry: 156.9, apex: 27.7, landing: 45.2, hang: 6.17 },
  wedge: { ball_mph: 102, launch: 24.2, spin: 9304, carry: 119.8, apex: 28.8, landing: 51.0, hang: 5.90 },
};

test('spin model: tour rows (club speed, attack, launch -> spin) within 1 % for all 7 rows', () => {
  const rows = Object.entries(LM_PARAMS.clubs).filter(([, c]) => c.tour);
  assert.equal(rows.length, 7);
  for (const [cat, c] of rows) {
    const t = c.tour;
    const r = inverseVertical(t.launch, t.aoa);
    const spin = spinFromLoft(t.club_mph * MPH, r.spin_loft, cat);
    const rel = Math.abs(spin / t.spin - 1);
    console.log(`# ${cat.padEnd(10)} DL ${r.dl.toFixed(2)} SL ${r.spin_loft.toFixed(2)} A ${c.a_spin} spin ${spin.toFixed(0)} vs ${t.spin} (${(100 * rel).toFixed(3)} %)`);
    assert.ok(rel <= 0.01, `${cat}: ${spin} vs ${t.spin}`);
    assert.ok(Math.abs(c.spin_loft.mean - r.spin_loft) < 0.06, `${cat}: spin-loft prior ${c.spin_loft.mean} vs the tour row ${r.spin_loft}`);
  }
});

test('RK4 flight (dt 4 ms) matches the RN §4 recorded values: carry ±0.5 m, apex ±0.2 m, landing ±0.2°, hang ±0.02 s', () => {
  assert.equal(LM_PARAMS.flight.dt_s, 0.004);
  for (const [cat, t] of Object.entries(RN4)) {
    const f = fly({ speed_mps: t.ball_mph * MPH, launch_v_deg: t.launch, spin_rpm: t.spin });
    console.log(`# ${cat.padEnd(10)} carry ${f.x.toFixed(2)} (${t.carry}) apex ${f.apex.toFixed(2)} landing ${f.landing_deg.toFixed(2)} hang ${f.t.toFixed(3)}`);
    assert.ok(Math.abs(f.x - t.carry) <= 0.5, `${cat} carry ${f.x} vs ${t.carry}`);
    assert.ok(Math.abs(f.apex - t.apex) <= 0.2, `${cat} apex ${f.apex}`);
    assert.ok(Math.abs(f.landing_deg - t.landing) <= 0.2, `${cat} landing ${f.landing_deg}`);
    assert.ok(Math.abs(f.t - t.hang) <= 0.02, `${cat} hang ${f.t}`);
  }
});

test('RN §4 curve sensitivity: landing side per degree of spin axis (driver 1.94, 7-iron 1.44, PW 1.06 m/°) ±0.05', () => {
  const want = { driver: 1.94, iron_mid: 1.44, wedge: 1.06 };
  for (const [cat, t] of Object.entries(RN4)) {
    const o = { speed_mps: t.ball_mph * MPH, launch_v_deg: t.launch, spin_rpm: t.spin };
    const d = (fly(o).y - fly({ ...o, axis_deg: 5 }).y) / 5;
    assert.ok(Math.abs(d - want[cat]) <= 0.05, `${cat}: ${d}`);
  }
});

test('roll table (RN §6) and its interpolation', async () => {
  const { rollFrac } = await import('../../app/src/physics/lm/roll.js');
  assert.equal(rollFrac(25, 'normal'), 0.10);
  assert.equal(rollFrac(40, 'firm'), 0.09);
  assert.ok(Math.abs(rollFrac(45, 'normal') - 0.0425) < 1e-12);
  assert.equal(rollFrac(60, 'soft'), 0);
  assert.equal(rollFrac(40, 'unknown-ground'), 0.06);
  // RN §6 check: driver carry 240 m landing 40° on normal ground -> roll ≈ 14 m
  assert.ok(Math.abs(240 * rollFrac(40, 'normal') - 14.4) < 0.01);
});
