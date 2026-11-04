// workers/protocol.js message validation and the Traditional Chinese error table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage, ERROR_CODES, ERR, errorMessage, toErrorCode, errorReply, transferablesOf, TO_WORKER, TO_MAIN, WorkerError } from '../../app/src/workers/protocol.js';

const bmp = () => ({ width: 10, height: 10, close() { this.closed = true; } });

test('every section 5 message validates; malformed ones are rejected with a reason', () => {
  const good = [
    [{ type: 'init', delegate: 'GPU' }, 'to_worker'],
    [{ type: 'pose', id: 1, bitmap: bmp(), t_s: 0.5, model: 'lite' }, 'to_worker'],
    [{ type: 'analyze_clip', id: 'a', file: {}, options: {} }, 'to_worker'],
    [{ type: 'cancel', id: 'a' }, 'to_worker'],
    [{ type: 'ready', delegate: 'CPU', models: ['lite'] }, 'to_main'],
    [{ type: 'pose_result', id: 1, t_s: 0.5, img: new Float32Array(132), world: new Float32Array(99), ms: 12 }, 'to_main'],
    [{ type: 'progress', id: 'a', stage: 'pose', frac: 0.5 }, 'to_main'],
    [{ type: 'clip_result', id: 'a', shot: {}, timings_ms: {} }, 'to_main'],
    [{ type: 'cancelled', id: 'a' }, 'to_main'],
    [{ type: 'error', id: 'a', code: 'DECODE_FAILED', message: 'x' }, 'to_main'],
    [{ type: 'decode_request', id: 'a', req: 1, from_s: -Infinity, to_s: Infinity, hz: 60 }, 'to_main'],
    [{ type: 'decode_frame', id: 'a', req: 1, bitmap: bmp(), t_s: 0, index: 0 }, 'to_worker'],
  ];
  for (const [m, d] of good) assert.deepEqual(validateMessage(m, d), { ok: true }, JSON.stringify(m.type));
  const bad = [
    [null, 'to_worker'], [{ type: 'nope' }, 'to_worker'], [{ type: 'init', delegate: 'TPU' }, 'to_worker'],
    [{ type: 'pose', id: 1, bitmap: bmp(), t_s: 0.5, model: 'xl' }, 'to_worker'],
    [{ type: 'pose', id: 1, t_s: 0.5, model: 'lite' }, 'to_worker'],
    [{ type: 'pose', id: 1, bitmap: bmp(), t_s: NaN, model: 'lite' }, 'to_worker'],
    [{ type: 'pose_result', id: 1, t_s: 0, img: new Float32Array(10), world: new Float32Array(99), ms: 1 }, 'to_main'],
    [{ type: 'pose_result', id: 1, t_s: 0, img: [], world: new Float32Array(99), ms: 1 }, 'to_main'],
    [{ type: 'progress', id: 'a', stage: 'pose', frac: 1.5 }, 'to_main'],
    [{ type: 'error', id: 'a', code: 'lowercase', message: 'x' }, 'to_main'],
    [{ type: 'init', delegate: 'GPU' }, 'sideways'],
    [{ type: 'ready', delegate: 'GPU', models: 'lite' }, 'to_main'],
    [{ type: 'clip_result', id: 'a', shot: {}, timings_ms: {} }, 'to_worker'],
  ];
  for (const [m, d] of bad) {
    const r = validateMessage(m, d);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.error, 'string');
  }
  assert.ok(Object.keys(TO_WORKER).includes('analyze_clip') && Object.keys(TO_MAIN).includes('clip_result'));
});

test('error codes are UPPER_SNAKE with Traditional Chinese messages', () => {
  const codes = Object.keys(ERROR_CODES);
  assert.ok(codes.length >= 12);
  for (const c of codes) {
    assert.match(c, /^[A-Z][A-Z0-9_]*$/);
    assert.match(ERROR_CODES[c], /[一-鿿]/);
    assert.equal(ERR[c], c);
  }
  for (const need of ['INIT_FAILED', 'WASM_LOAD_FAILED', 'MODEL_LOAD_FAILED', 'UNSUPPORTED_CODEC', 'DEMUX_FAILED', 'DECODE_FAILED', 'WEBCODECS_UNAVAILABLE', 'CANCELLED', 'BAD_MESSAGE', 'INTERNAL']) {
    assert.ok(codes.includes(need), need);
  }
  assert.equal(errorMessage('NOPE'), ERROR_CODES.INTERNAL);
});

test('toErrorCode / errorReply / transferables', () => {
  assert.equal(toErrorCode(new WorkerError(ERR.DEMUX_FAILED)), 'DEMUX_FAILED');
  assert.equal(toErrorCode({ code: 'UNSUPPORTED_CODEC' }), 'UNSUPPORTED_CODEC');
  assert.equal(toErrorCode({ code: 'weird' }), 'INTERNAL');
  assert.equal(toErrorCode(Object.assign(new Error('x'), { name: 'AbortError' })), 'CANCELLED');
  assert.equal(toErrorCode(new Error('Out of memory')), 'OUT_OF_MEMORY');
  const r = errorReply('j1', new Error('kaboom'));
  assert.equal(r.type, 'error');
  assert.equal(r.id, 'j1');
  assert.equal(r.code, 'INTERNAL');
  assert.match(r.message, /kaboom/);
  assert.equal(validateMessage(r, 'to_main').ok, true);
  const img = new Float32Array(132), world = new Float32Array(99), bitmap = bmp();
  const t = transferablesOf({ img, world, bitmap });
  assert.equal(t.length, 3);
  assert.ok(t.includes(img.buffer) && t.includes(bitmap));
});
