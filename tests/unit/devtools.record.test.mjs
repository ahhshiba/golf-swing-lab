import test from 'node:test';
import assert from 'node:assert/strict';
import { record, get, reset, increment, STORAGE_KEY } from '../../app/src/diag/record.js';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('record/get/reset work in memory without localStorage', () => {
  reset();
  assert.deepEqual(get(), {});
  record('gum.actual_fps', 29.97);
  record('setup.durations_s.C3', 61);
  assert.equal(get('gum.actual_fps'), 29.97);
  assert.deepEqual(get('setup'), { durations_s: { C3: 61 } });
  assert.equal(get('nope.deep'), undefined);
  assert.equal(increment('gum.calls'), 1);
  assert.equal(increment('gum.calls'), 2);
  reset();
  assert.deepEqual(get(), {});
});

test('values are cloned both ways, NaN becomes null, typed arrays become arrays', () => {
  reset();
  const v = { a: [1, 2], b: NaN, c: new Float32Array([1, 2]) };
  record('x', v);
  v.a.push(3);
  const out = get('x');
  assert.deepEqual(out, { a: [1, 2], b: null, c: [1, 2] });
  out.a.push(9);
  assert.deepEqual(get('x.a'), [1, 2]);
});

test('bad paths throw; prototype pollution is impossible', () => {
  assert.throws(() => record('', 1), TypeError);
  assert.throws(() => record('a..b', 1), TypeError);
  assert.throws(() => record('__proto__.x', 1), TypeError);
  assert.equal({}.x, undefined);
});

test('mirrors to localStorage and survives a throwing storage', () => {
  const st = fakeStorage();
  globalThis.localStorage = st;
  try {
    reset();
    record('a.b', 5);
    assert.deepEqual(JSON.parse(st.m.get(STORAGE_KEY)), { a: { b: 5 } });
    reset();
    assert.equal(st.m.has(STORAGE_KEY), false);
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    reset();
    record('z', 1);
    assert.equal(get('z'), 1);
  } finally {
    delete globalThis.localStorage;
    reset();
  }
});
