// contract/migrate.js — golf-shot/1 -> golf-shot/2, lossless (LAUNCH-MONITOR-SPEC §2.1; FROZEN interface, LM-A).
// Pure: no DOM, no clock, no randomness, never mutates its input.
//
//   migrateShot(any) -> { shot, migrated }
//     golf-shot/1  -> a deep copy as golf-shot/2: the 14 new metric ids appended as not_computed + MIGRATED_V1 (unit
//                     and value_origin from enums.js), flight / tracks / practice = null, algorithms.lm =
//                     { version: 'none', sha256: sha256('none') }; every other field unchanged. migrated = true.
//     anything else (golf-shot/2, a non-shot, an unknown schema) -> the input itself, migrated = false
//                     (idempotent: migrateShot(migrateShot(x).shot) deep-equals migrateShot(x)). The validator decides
//                     whether such an input is acceptable.
//   SCHEMA_V2 = 'golf-shot/2'   SCHEMA_V1 = 'golf-shot/1'
//
// The store migrates on read (store/core.js shots.get / shots.list / queryShots) and writes back in batches
// (repo.migrateBatch); the backup import migrates before validating (store/export.js).

import { RC } from './reason-codes.js';
import { SCHEMA_V1, SCHEMA_V2, LM_METRIC_IDS, METRIC_UNITS, METRIC_DEFAULT_ORIGIN, LM_ALGORITHM_NONE } from './enums.js';

export { SCHEMA_V1, SCHEMA_V2 };

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** The placeholder a migrated shot gets for an id golf-shot/1 did not have. */
export function migratedNull(id) {
  return {
    value: null, unit: METRIC_UNITS[id], ci95: null, sigma: null, validity: 'not_computed',
    value_origin: METRIC_DEFAULT_ORIGIN[id], measured: false, reason_codes: [RC.MIGRATED_V1],
  };
}

export function migrateShot(any) {
  if (!isObj(any) || any.schema !== SCHEMA_V1) return { shot: any, migrated: false };
  const out = {};
  for (const [k, v] of Object.entries(any)) if (v !== undefined) out[k] = copy(v);
  out.schema = SCHEMA_V2;
  if (isObj(out.algorithms) && !('lm' in out.algorithms)) out.algorithms.lm = { ...LM_ALGORITHM_NONE };
  if (isObj(out.metrics)) for (const id of LM_METRIC_IDS) if (!(id in out.metrics)) out.metrics[id] = migratedNull(id);
  for (const k of ['flight', 'tracks', 'practice']) if (!(k in out)) out[k] = null;
  return { shot: out, migrated: true };
}
