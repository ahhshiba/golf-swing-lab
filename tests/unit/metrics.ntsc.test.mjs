import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellFor } from '../../app/src/metrics/registry.js';
import { RC } from '../../app/src/contract/reason-codes.js';

test('NTSC frame rates count as their nominal rate', () => {
  assert.notEqual(cellFor('tempo_ratio', 'face_on', 29.97).validity, null);
  assert.equal(cellFor('club_speed_mps', 'face_on', 239.76).validity, cellFor('club_speed_mps', 'face_on', 240).validity);
});

test('clearly lower rates are still rejected', () => {
  assert.deepEqual(cellFor('tempo_ratio', 'face_on', 25), { validity: null, code: RC.FPS_TOO_LOW });
  assert.equal(cellFor('club_speed_mps', 'face_on', 120).validity, cellFor('club_speed_mps', 'face_on', 60).validity);
});

test('fpsAtLeast allows 1 % below the nominal rate only', async () => {
  const { fpsAtLeast } = await import('../../app/src/geom/constants.js');
  assert.ok(fpsAtLeast(239.76, 240) && fpsAtLeast(29.97, 30) && fpsAtLeast(59.94, 60));
  assert.ok(!fpsAtLeast(235, 240) && !fpsAtLeast(29, 30));
});
