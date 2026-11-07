// V04-SPEC §G.3 V4-C acceptance 3: an 18-hole course generates in ≤ 30 ms (median, Node; the iPhone 12 target of
// ≤ 150 ms is a device-checklist item).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse } from '../../app/src/course/generate.js';

test('18-hole generateCourse median ≤ 30 ms (each style)', () => {
  for (const style of ['parkland', 'links', 'desert', 'mixed']) {
    for (let i = 0; i < 3; i++) generateCourse({ seed: 1000 + i, style, holes: 18, tees: 'middle' }); // warm up
    const t = [];
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now();
      generateCourse({ seed: 7 + i * 7919, style, holes: 18, tees: 'back' });
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    assert.ok(t[10] <= 30, `${style}: median ${t[10].toFixed(2)} ms`);
  }
});
