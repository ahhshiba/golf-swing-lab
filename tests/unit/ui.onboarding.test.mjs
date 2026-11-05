// WP-B: onboarding logic (PRODUCT-SPEC §2.2) and the practice catalogs (§3.1, §3.6 rules applied to B's namespaces).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ONBOARDING_VERSION, ONB_STEPS, onboardingSteps, needsOnboarding, classifyCameraError, requestPermissionsOnce } from '../../app/src/ui/onboarding.js';

const ROOT = new URL('../../', import.meta.url);
const NS = ['onboarding', 'home', 'venue', 'setup', 'calib', 'live', 'bay', 'health', 'camera'];
const FILES = ['ui/onboarding.js', 'ui/home.js', 'ui/venue.js', 'ui/venues.js', 'ui/setup.js', 'ui/live.js', 'ui/magnifier.js', 'ui/sensors.js', 'ui/tripod-diagram.js', 'session/bay.js', 'calib/checks.js'];
const src = (f) => readFileSync(new URL(`app/src/${f}`, ROOT), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
function catalog(loc) {
  const m = new Map();
  for (const f of readdirSync(new URL(`app/i18n/${loc}/`, ROOT))) {
    if (!f.endsWith('.json')) continue;
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(new URL(`app/i18n/${loc}/${f}`, ROOT), 'utf8')))) m.set(`${f.slice(0, -5)}.${k}`, v);
  }
  return m;
}
const zh = catalog('zh-Hant');
const en = catalog('en');

test('onboarding steps, version flag and the automated-browser seam', () => {
  assert.equal(ONBOARDING_VERSION, 1);
  assert.deepEqual([...ONB_STEPS], ['welcome', 'need', 'install', 'you', 'permissions', 'first']);
  assert.deepEqual(onboardingSteps({ standalone: true }), ['welcome', 'need', 'you', 'permissions', 'first']);
  assert.equal(onboardingSteps({}).length, 6);
  assert.equal(needsOnboarding({ onboarding: { done_v: 0 } }), true);
  assert.equal(needsOnboarding({ onboarding: { done_v: 1 } }), false);
  assert.equal(needsOnboarding({}), true);
  assert.equal(needsOnboarding({ onboarding: { done_v: 0 } }, { webdriver: true }), false);
  assert.equal(needsOnboarding({ onboarding: { done_v: 0 } }, { webdriver: true, seam: true }), true);
  assert.equal(needsOnboarding({ onboarding: { done_v: 1 } }, { force: true }), true);
});

test('camera error names map to denied / busy / missing', () => {
  assert.equal(classifyCameraError('NotAllowedError'), 'denied');
  assert.equal(classifyCameraError('SecurityError'), 'denied');
  assert.equal(classifyCameraError('NotReadableError'), 'busy');
  assert.equal(classifyCameraError('AbortError'), 'busy');
  assert.equal(classifyCameraError('NotFoundError'), 'missing');
  assert.equal(classifyCameraError('OverconstrainedError'), 'missing');
  assert.equal(classifyCameraError(''), 'unsupported');
});

test('requestPermissionsOnce invokes motion then getUserMedia synchronously (same click) and reports per row', async () => {
  const calls = [];
  const track = (kind) => ({ kind, stop() { calls.push(`stop:${kind}`); } });
  const env = (gum) => ({
    DeviceMotionEvent: { requestPermission: () => { calls.push('motion'); return Promise.resolve('granted'); } },
    navigator: { mediaDevices: { getUserMedia: (c) => { calls.push(`gum:${c.audio ? 'av' : 'v'}`); return gum(c); } } },
  });
  const ok = (c) => Promise.resolve({ getAudioTracks: () => (c.audio ? [track('audio')] : []), getTracks: () => [track('video'), ...(c.audio ? [track('audio')] : [])] });
  const p = requestPermissionsOnce(env(ok));
  assert.deepEqual(calls, ['motion', 'gum:av']); // both invoked before any await
  assert.deepEqual(await p, { camera: 'granted', microphone: 'granted', motion: 'granted' });
  assert.ok(calls.includes('stop:video'), 'the probe stream is stopped');
  // microphone refused: audio+video rejects, video alone works
  calls.length = 0;
  const deny = (c) => (c.audio ? Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })) : ok(c));
  assert.deepEqual(await requestPermissionsOnce(env(deny)), { camera: 'granted', microphone: 'denied', motion: 'granted' });
  assert.deepEqual(await requestPermissionsOnce(env(() => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })))), { camera: 'denied', microphone: 'denied', motion: 'granted' });
  assert.deepEqual(await requestPermissionsOnce(env(() => Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })))), { camera: 'busy', microphone: 'busy', motion: 'granted' });
  const none = await requestPermissionsOnce({ navigator: {}, DeviceMotionEvent: undefined });
  assert.deepEqual(none, { camera: 'unsupported', microphone: 'unsupported', motion: 'unsupported' });
});

test('practice sources carry no CJK literals (comments aside) and use RC.<NAME> for reason codes', () => {
  for (const f of FILES) {
    const s = stripComments(src(f));
    const hits = s.split('\n').filter((l) => /[㐀-鿿＀-￯]/.test(l));
    assert.deepEqual(hits, [], `${f}: CJK literals`);
    assert.ok(!/'(NO_GRAVITY_REF|SETUP_UNVERIFIED|NO_CALIBRATION|AUDIO_UNAVAILABLE)'/.test(s), `${f}: reason code as a string literal`);
  }
});

test('practice catalogs: every t() key exists in both locales, same placeholders, no spec codes, no CJK in en', () => {
  const used = new Set();
  for (const f of FILES) for (const m of src(f).matchAll(/\bt\('([a-z_]+\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !zh.has(k) || !en.has(k));
  assert.deepEqual(missing, []);
  const mine = [...zh.keys()].filter((k) => NS.includes(k.split('.')[0]));
  assert.ok(mine.length > 350, `only ${mine.length} practice keys`);
  const ph = (v) => [...new Set(JSON.stringify(v).match(/\{\w+\}/g) ?? [])].sort().join(',');
  const BAD = /\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|GolfDB|tcn\b/i;
  for (const k of mine) {
    assert.ok(en.has(k), `en lacks ${k}`);
    assert.equal(ph(en.get(k)), ph(zh.get(k)), `placeholders differ: ${k}`);
    for (const [loc, m] of [['zh-Hant', zh], ['en', en]]) assert.ok(!BAD.test(JSON.stringify(m.get(k))), `${loc} ${k}: spec code / internal word`);
    assert.ok(!/[一-鿿]/.test(JSON.stringify(en.get(k))), `CJK in en ${k}`);
    const zv = zh.get(k);
    if (zv && typeof zv === 'object') assert.deepEqual(Object.keys(zv), ['other'], `zh plural ${k} uses other only`);
    const ev = en.get(k);
    if (ev && typeof ev === 'object') assert.deepEqual(Object.keys(ev).sort(), ['one', 'other'], `en plural ${k}`);
  }
  for (const k of [...en.keys()].filter((x) => NS.includes(x.split('.')[0]))) assert.ok(zh.has(k), `zh lacks ${k}`);
});

test('dynamic key families used by the practice screens are complete in both locales', () => {
  const fam = [];
  for (const k of ['camera', 'microphone', 'motion']) {
    fam.push(`onboarding.perm.${k}`, `onboarding.perm.${k}_why`);
    for (const s of ['denied', 'busy', 'unsupported']) fam.push(`onboarding.perm.${k}_fix_${s}`);
  }
  for (const s of ['granted', 'denied', 'busy', 'missing', 'unsupported']) fam.push(`onboarding.perm.state_${s}`);
  for (const m of ['live', 'highspeed']) for (const x of ['title', 'body', 'gets']) fam.push(`onboarding.first.${m}_${x}`);
  for (const s of ['length', 'width', 'ball', 'bay', 'finish']) fam.push(`venue.${s}.title`, `venue.${s}.body`);
  for (const k of ['denied', 'busy', 'missing']) fam.push(`camera.${k}.title`, `camera.${k}.body`);
  for (const p of ['ios', 'other']) for (const i of [1, 2, 3]) fam.push(`camera.denied.${p}${i}`);
  for (const i of [0, 1, 2, 3]) fam.push(`setup.corner.${i}`);
  for (const d of ['left', 'right', 'up', 'down']) fam.push(`setup.picker.nudge_${d}`);
  for (const l of ['green', 'amber', 'red']) fam.push(`setup.light.${l}`);
  for (const s of ['idle', 'ready', 'swinging', 'analysing', 'practice', 'done', 'failed', 'no_module', 'too_slow', 'camera_lost', 'camera_still_off', 'starting']) fam.push(`live.state.${s}`);
  for (const s of ['start', 'C0', 'C1']) fam.push(`home.dev.timer_${s}`);
  const gaps = fam.filter((k) => !zh.has(k) || !en.has(k));
  assert.deepEqual(gaps, []);
});
