// A tiny owner event model built in JS for the model tests (no GolfDB, no Python): random weights of a small TCN
// in the gsl-event-tcn/1 format, a golden made by the JS inference itself, and a model card (PRODUCT-SPEC §7.4).
import { createHash } from 'node:crypto';
import { loadTcn, TCN_FORMAT } from '../../app/src/events/tcn.js';
import { FEATURE_VERSION, FEATURE_NAMES } from '../../app/src/events/features.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

export function ownerModel({ version = 'event-tcn-owner-test', card = {}, seed = 3 } = {}) {
  const F = FEATURE_NAMES.length;
  const C = 4;
  const k = 3;
  const dil = [1, 2];
  const rng = mulberry32(seed);
  const tensors = [];
  const vals = [];
  const add = (name, shape) => {
    const n = shape.reduce((a, b) => a * b, 1);
    tensors.push({ name, shape, offset: vals.length });
    for (let i = 0; i < n; i++) vals.push((rng() - 0.5) * 0.6);
  };
  dil.forEach((d, l) => { add(`convs.${l}.weight`, [C, l === 0 ? F : C, k]); add(`convs.${l}.bias`, [C]); });
  add('head.weight', [9, C, 1]);
  add('head.bias', [9]);
  const bin = new Float32Array(vals).buffer;
  const json = {
    format: TCN_FORMAT, version, feature_version: FEATURE_VERSION, classes: [], n_params: vals.length,
    arch: { in_ch: F, ch: C, k, dilations: dil, n_classes: 9 },
    norm: { mean: new Array(F).fill(0), std: new Array(F).fill(1) },
    tensors, bin_bytes: bin.byteLength, sha256: createHash('sha256').update(Buffer.from(bin)).digest('hex'),
    model_card: {
      schema: 'gsl-model-card/1', training_data: ['owner', 'synthetic'], golfdb: false, init: 'synthetic-pretrain',
      views: ['face_on', 'dtl'],
      owner_holdout: { n: 24, impact_within_1_rate: 0.95, address_within_3_rate: 0.9, tempo_within_rate: 0.92,
        rules: { n: 24, impact_within_1_rate: 0.9, address_within_3_rate: 0.85, tempo_within_rate: 0.9 }, gate: { passed: true, reasons: [] } },
      ...card,
    },
  };
  const tcn = loadTcn(json, bin);
  const K = 20;
  const data = Float64Array.from({ length: K * F }, () => rng() - 0.5);
  const probs = Array.from(tcn.predict({ K, F, data }));
  const argmax = [];
  for (let t = 0; t < K; t++) { let b = 0; for (let c = 1; c < 9; c++) if (probs[t * 9 + c] > probs[t * 9 + b]) b = c; argmax.push(b); }
  json.golden = { cases: [{ name: 'js', K, F, features: Array.from(data), probs, argmax }] };
  return { json, bin };
}
