// Shared assertions of the pipeline tests (not a test file itself: no .test. in the name).
import assert from 'node:assert/strict';
import { registryFps } from '../../app/src/pipeline/assemble.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { METRIC_IDS } from '../../app/src/contract/enums.js';
import { cellFor } from '../../app/src/metrics/registry.js';

const RANK = { valid: 0, estimated: 1, low_confidence: 2 };

/** Every metric: null cells of the registry carry its code; numbers never claim more than the registry cell. */
export function checkRegistry(shot) {
  const view = shot.capture.view;
  const fps = registryFps(shot.capture);
  for (const id of METRIC_IDS) {
    const m = shot.metrics[id];
    const cell = cellFor(id, view, fps);
    if (cell.validity === null) {
      assert.equal(m.value, null, `${id} must be null in ${view}@${fps}`);
      assert.ok(m.reason_codes.includes(cell.code), `${id} must carry ${cell.code}, got ${m.reason_codes}`);
    } else if (m.value !== null) {
      assert.ok(RANK[m.validity] >= RANK[cell.validity], `${id}: ${m.validity} better than registry ${cell.validity}`);
      assert.ok(m.ci95 !== null || m.sigma !== null, `${id}: number without uncertainty`);
    }
  }
}

export function assertContract(shot) {
  const v = validateShot(shot);
  assert.ok(v.ok, JSON.stringify(v.errors.slice(0, 3)));
  for (const k of ['pose', 'events', 'calib', 'ball', 'fit3d', 'carry']) assert.match(shot.algorithms[k].sha256, /^[0-9a-f]{64}$/);
  checkRegistry(shot);
}

