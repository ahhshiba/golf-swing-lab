// Event TCN inference in plain JS (CAFCR K9 / R2): the model trained by training/train_tcn.py and exported by
// training/export.py to app/models/event-tcn-v1.{bin,json}. Pure: no DOM, no clock, no randomness, no fetch
// (the caller loads the two files and passes them in).
//
// Network (training/model.py): x = (features - mean) / std (non-finite -> 0), per frame of the evfeat-1 30 Hz grid;
//   h0 = relu(conv0(x)); h_l = h_{l-1} + relu(conv_l(h_{l-1})) for l = 1..L-1; logits = head(h); softmax over 9.
// conv_l: Conv1d(kernel k, dilation d_l, zero padding d_l * (k - 1) / 2 on both sides, output length = input
// length), identical to torch.nn.Conv1d(padding = d * (k - 1) // 2). Weights are little-endian float32 in the
// order of json.tensors (torch layout: weight [out][in][k], bias [out]). Activations are stored in Float32Array;
// each dot product is accumulated in a JS double and rounded to float32 once.
// predict(features) -> Float32Array(K * 9) row-major (frame, class); class 8 = background (detect.js contract).

import { FEATURE_VERSION } from './features.js';

export const TCN_FORMAT = 'gsl-event-tcn/1';
export const TCN_CLASSES = 9;

function tensorView(buf, spec) {
  const n = spec.shape.reduce((a, b) => a * b, 1);
  if (!(Number.isInteger(spec.offset) && spec.offset >= 0 && (spec.offset + n) * 4 <= buf.byteLength)) {
    throw new RangeError(`loadTcn: tensor ${spec.name} is outside the weight file`);
  }
  const out = new Float32Array(n);
  const dv = new DataView(buf, spec.offset * 4, n * 4);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/**
 * loadTcn(json, arrayBuffer) -> { meta, predict(features) -> Float32Array(K*9), predictRows(features) -> rows }
 * json: parsed event-tcn-v1.json; arrayBuffer: the bytes of event-tcn-v1.bin. Throws on a format, feature
 * version or size mismatch (the caller then keeps the rules).
 */
export function loadTcn(json, arrayBuffer) {
  if (!json || json.format !== TCN_FORMAT) throw new TypeError(`loadTcn: format must be ${TCN_FORMAT}`);
  if (json.feature_version !== FEATURE_VERSION) {
    throw new TypeError(`loadTcn: model wants ${json.feature_version}, features.js is ${FEATURE_VERSION}`);
  }
  const buf = ArrayBuffer.isView(arrayBuffer)
    ? arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength)
    : arrayBuffer;
  if (!(buf instanceof ArrayBuffer)) throw new TypeError('loadTcn: weights must be an ArrayBuffer');
  if (buf.byteLength !== json.bin_bytes) throw new RangeError('loadTcn: weight file size mismatch');
  const a = json.arch;
  const F = a.in_ch;
  const C = a.ch;
  const k = a.k;
  const dil = a.dilations;
  if (a.n_classes !== TCN_CLASSES || k % 2 !== 1 || dil.length < 1) throw new RangeError('loadTcn: bad arch');
  const byName = new Map(json.tensors.map((s) => [s.name, s]));
  const get = (name, shape) => {
    const s = byName.get(name);
    if (!s || s.shape.join(',') !== shape.join(',')) throw new RangeError(`loadTcn: tensor ${name} missing or misshaped`);
    return tensorView(buf, s);
  };
  const layers = dil.map((d, l) => ({
    d, cin: l === 0 ? F : C, cout: C,
    w: get(`convs.${l}.weight`, [C, l === 0 ? F : C, k]), b: get(`convs.${l}.bias`, [C]),
  }));
  const hw = get('head.weight', [TCN_CLASSES, C, 1]);
  const hb = get('head.bias', [TCN_CLASSES]);
  const mean = Float32Array.from(json.norm.mean);
  const std = Float32Array.from(json.norm.std);
  if (mean.length !== F || std.length !== F) throw new RangeError('loadTcn: normalisation size mismatch');

  function conv(x, T, L) {
    // x: Float32Array(cin*T) channel-major -> relu(conv) Float32Array(cout*T)
    const { d, cin, cout, w, b } = L;
    const half = (k - 1) >> 1;
    const y = new Float32Array(cout * T);
    for (let o = 0; o < cout; o++) {
      const wo = o * cin * k;
      for (let t = 0; t < T; t++) {
        let s = b[o];
        for (let j = 0; j < k; j++) {
          const tt = t + (j - half) * d;
          if (tt < 0 || tt >= T) continue;
          let wi = wo + j;
          for (let i = 0; i < cin; i++, wi += k) s += w[wi] * x[i * T + tt];
        }
        y[o * T + t] = s > 0 ? s : 0;
      }
    }
    return y;
  }

  function predict(features) {
    const T = features.K;
    const Fin = features.F ?? F;
    const data = features.data;
    if (!(T >= 1) || Fin !== F || !data || data.length < T * F) throw new RangeError('tcn.predict: bad features');
    let h = new Float32Array(F * T);
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < F; i++) {
        const z = Math.fround(Math.fround(Math.fround(data[t * F + i]) - mean[i]) / std[i]);
        h[i * T + t] = Number.isFinite(z) ? z : 0;
      }
    }
    layers.forEach((L, l) => {
      const y = conv(h, T, L);
      if (l > 0) for (let i = 0; i < y.length; i++) y[i] = h[i] + y[i];
      h = y;
    });
    const out = new Float32Array(T * TCN_CLASSES);
    const z = new Float64Array(TCN_CLASSES);
    for (let t = 0; t < T; t++) {
      let m = -Infinity;
      for (let c = 0; c < TCN_CLASSES; c++) {
        let s = hb[c];
        for (let i = 0; i < C; i++) s += hw[c * C + i] * h[i * T + t];
        z[c] = Math.fround(s);
        if (z[c] > m) m = z[c];
      }
      let sum = 0;
      for (let c = 0; c < TCN_CLASSES; c++) { z[c] = Math.exp(z[c] - m); sum += z[c]; }
      for (let c = 0; c < TCN_CLASSES; c++) out[t * TCN_CLASSES + c] = z[c] / sum;
    }
    return out;
  }

  function predictRows(features) {
    const p = predict(features);
    const rows = [];
    for (let t = 0; t < features.K; t++) rows.push(Array.from(p.subarray(t * TCN_CLASSES, (t + 1) * TCN_CLASSES)));
    return rows;
  }

  return {
    meta: { format: json.format, version: json.version, feature_version: json.feature_version, classes: json.classes,
      n_params: json.n_params, sha256: json.sha256 },
    predict, predictRows,
  };
}
