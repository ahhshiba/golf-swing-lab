// contract/round.js — golf-round/1 (simulated round) and golf-lab/1 (swing-lab result) contracts, V04-SPEC §F.2.
// Lazy (scripts/build.mjs LAZY_GLOBS): loaded by store/export.js on import and by the course / lab screens.
// Pure: no DOM, no clock, no randomness. Owner V4-A; FROZEN at V4-A drop 1 (docs/V04-INTERFACES.md §1).
//
//   ROUND_SCHEMA = 'golf-round/1'   LAB_SCHEMA = 'golf-lab/1'   ROUND_MAX_BYTES (256 KB, JSON text)
//   enums: ROUND_STATUSES, COURSE_STYLES, HOLE_STYLES, TEE_IDS, SIM_LIES, STROKE_SOURCES, STROKE_EVENTS, ROUND_ORIGINS,
//          PUTT_SKILLS, RULE_OPTIONS { unobservedSide, putting, ob, maxScore }, PLAYER_KINDS, FAULT_STATUSES
//   validateRound(round, { replayRound }?) -> { ok, errors: [{ path, msg, rule }] }
//       every message ends with `(<rule>)`; rules: schema, shape, players_count, holes_count, hole_shape,
//       stroke_seq_increasing, stroke_player_known, stroke_hole_range, stroke_n_sequence, manual_entry_code,
//       value_needs_uncertainty, null_needs_reason, validity_not_valid, size_limit, replay_matches.
//       replay_matches (rest within REPLAY_TOLERANCE_M of the stored rest) runs only when a replayRound function is
//       given (sim/round.js replayRound, V4-C); store/export.js import passes none (the replay engine is lazy, V4-C).
//   validateLabRecord(rec) -> { ok, errors }  (golf-lab/1 shape; derived data, never exported)
//   scorecard() is NOT stored: sim/round.js scorecard(round) derives it from strokes.

import { VALIDITIES, VALUE_ORIGINS, HANDEDNESS, VIEWS } from './enums.js';
import { REASON_CODES, RC } from './reason-codes.js';

export const ROUND_SCHEMA = 'golf-round/1';
export const LAB_SCHEMA = 'golf-lab/1';
export const ROUND_MAX_BYTES = 256 * 1024;
export const REPLAY_TOLERANCE_M = 0.05;
const DRAW_KEYS = Object.freeze(['seed', 'carry_m', 'side_m', 'apex_m', 'land_deg']);
export const ROUND_STATUSES = Object.freeze(['active', 'finished', 'abandoned']);
export const HOLE_STYLES = Object.freeze(['parkland', 'links', 'desert']);
export const COURSE_STYLES = Object.freeze([...HOLE_STYLES, 'mixed']);
export const TEE_IDS = Object.freeze(['forward', 'middle', 'back']);
/** Lie of a ball position (V04-SPEC §C.1: OB → water → bunker → green → fairway → rough; tee = the tee box). */
export const SIM_LIES = Object.freeze(['tee', 'fairway', 'rough', 'bunker', 'green', 'water', 'ob']);
export const STROKE_SOURCES = Object.freeze(['quick', 'shot', 'manual', 'auto_putt', 'auto_chip', 'penalty', 'pickup']);
export const STROKE_EVENTS = Object.freeze(['tree', 'water', 'ob', 'holed']);
/** Contract value origins plus 'sim' (a simulated outcome: auto putt / chip, penalty drop, pickup). */
export const ROUND_ORIGINS = Object.freeze([...VALUE_ORIGINS, 'sim']);
export const PUTT_SKILLS = Object.freeze([0, 10, 20, 30]);
export const PLAYER_KINDS = Object.freeze(['owner', 'guest']);
export const RULE_OPTIONS = Object.freeze({
  unobservedSide: Object.freeze(['sample', 'center']),
  putting: Object.freeze(['auto', 'manual']),
  ob: Object.freeze(['drop_2', 'stroke_distance']),
  maxScore: Object.freeze(['double_par', 'none']),
});
export const FAULT_STATUSES = Object.freeze(['fault', 'possible', 'ok', 'unknown']);
const POLY_MAX_POINTS = 24;
const HOLE_MAX_POLYS = 30;
const HOLE_MAX_TREES = 60;
const MAX_PLAYERS = 4;
const ROUND_KEYS = ['schema', 'round_id', 'created_at', 'updated_at', 'app_version', 'status', 'course', 'rules', 'players', 'strokes', 'current'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v !== '';
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const show = (v) => { try { return JSON.stringify(v); } catch (_) { return String(v); } };
const isXY = (p) => Array.isArray(p) && p.length === 2 && p.every(isNum);
const isXYZ = (p) => Array.isArray(p) && p.length === 3 && p.every(isNum);
const isPoly = (p) => Array.isArray(p) && p.length >= 3 && p.length <= POLY_MAX_POINTS && p.every(isXY);

function checker() {
  const errors = [];
  const err = (path, msg, rule) => errors.push({ path, msg: `${msg} (${rule})`, rule });
  return { errors, err };
}

function checkHole(h, path, i, err) {
  const bad = (k, m) => err(`${path}.${k}`, m, 'hole_shape');
  if (!isObj(h)) { err(path, 'hole must be an object', 'hole_shape'); return; }
  if (h.n !== i + 1) bad('n', `hole number must be ${i + 1}, got ${show(h.n)}`);
  if (![3, 4, 5].includes(h.par)) bad('par', `par must be 3, 4 or 5, got ${show(h.par)}`);
  if (!HOLE_STYLES.includes(h.style)) bad('style', `style must be one of ${HOLE_STYLES.join('|')}`);
  if (h.template !== null && !isStr(h.template)) bad('template', 'template must be null or a string');
  if (!(isNum(h.length_m) && h.length_m > 0)) bad('length_m', 'length_m must be a number > 0');
  if (!isObj(h.tees) || !TEE_IDS.every((t) => isXYZ(h.tees[t]))) bad('tees', 'tees must hold forward / middle / back [x, y, z]');
  if (!isXY(h.pin)) bad('pin', 'pin must be [x, y]');
  if (!isObj(h.green) || !isPoly(h.green.poly) || !isNum(h.green.z) || !isNum(h.green.slope_pct)) bad('green', `green must be { poly (3–${POLY_MAX_POINTS} points), z, slope_pct }`);
  let polys = 1;
  for (const k of ['fairway', 'bunkers', 'water']) {
    if (!Array.isArray(h[k]) || !h[k].every(isPoly)) bad(k, `${k} must be an array of polygons of 3–${POLY_MAX_POINTS} [x, y] points`);
    else polys += h[k].length;
  }
  if (!isPoly(h.bounds)) bad('bounds', 'bounds must be a polygon');
  else polys++;
  if (polys > HOLE_MAX_POLYS) bad('fairway', `a hole has at most ${HOLE_MAX_POLYS} polygons, got ${polys}`);
  if (!Array.isArray(h.trees) || h.trees.length > HOLE_MAX_TREES || !h.trees.every((t) => Array.isArray(t) && t.length === 4 && t.every(isNum) && t[2] > 0 && t[3] > 0)) {
    bad('trees', `trees must be at most ${HOLE_MAX_TREES} [x, y, r > 0, h > 0]`);
  }
  if (!Array.isArray(h.centerline) || h.centerline.length < 2 || !h.centerline.every(isXY)) bad('centerline', 'centerline must have at least 2 [x, y] points');
  if (!isObj(h.elevation) || !isNum(h.elevation.tee_z) || !isNum(h.elevation.green_z)) bad('elevation', 'elevation must be { tee_z, green_z }');
}

/** carry / side of a stroke: the metric-like value block. */
function checkValue(v, path, err) {
  if (!isObj(v)) { err(path, 'must be { value, ci95, sigma, validity, origin, reason_codes }', 'shape'); return; }
  const codes = Array.isArray(v.reason_codes) ? v.reason_codes : null;
  if (!codes || !codes.every((c) => typeof c === 'string' && c in REASON_CODES)) err(`${path}.reason_codes`, 'reason_codes must be an array of reason codes', 'shape');
  if (!VALIDITIES.includes(v.validity)) err(`${path}.validity`, `validity must be one of ${VALIDITIES.join('|')}`, 'shape');
  if (v.validity === 'valid') err(`${path}.validity`, 'a simulated value is never valid (measured)', 'validity_not_valid');
  if (!ROUND_ORIGINS.includes(v.origin)) err(`${path}.origin`, `origin must be one of ${ROUND_ORIGINS.join('|')}`, 'shape');
  if (v.origin === 'manual' && !(codes ?? []).includes(RC.MANUAL_ENTRY)) err(`${path}.reason_codes`, 'a manual value must carry MANUAL_ENTRY', 'manual_entry_code');
  const ci = v.ci95 ?? null;
  const sg = v.sigma ?? null;
  if (ci !== null && !(Array.isArray(ci) && ci.length === 2 && ci.every(isNum) && ci[0] <= ci[1])) err(`${path}.ci95`, 'ci95 must be null or [lo, hi] with lo <= hi', 'shape');
  if (sg !== null && !(isNum(sg) && sg >= 0)) err(`${path}.sigma`, 'sigma must be null or a number >= 0', 'shape');
  if (v.value === null) {
    if (!codes || codes.length === 0) err(`${path}.reason_codes`, 'a null value needs a reason code', 'null_needs_reason');
  } else if (!isNum(v.value)) {
    err(`${path}.value`, 'value must be a number or null', 'shape');
  } else if (v.origin !== 'manual' && ci === null && sg === null) {
    err(path, 'a non-null value needs ci95 or sigma', 'value_needs_uncertainty');
  }
}

function checkStroke(s, path, ctx, err) {
  if (!isObj(s)) { err(path, 'stroke must be an object', 'shape'); return; }
  if (!isInt(s.seq) || s.seq < 0) err(`${path}.seq`, 'seq must be an integer >= 0', 'shape');
  if (!ctx.playerIds.has(s.player_id)) err(`${path}.player_id`, `unknown player ${show(s.player_id)}`, 'stroke_player_known');
  if (!isInt(s.hole) || s.hole < 1 || s.hole > ctx.holesN) err(`${path}.hole`, `hole must be 1–${ctx.holesN}, got ${show(s.hole)}`, 'stroke_hole_range');
  if (!isInt(s.n) || s.n < 1) err(`${path}.n`, 'n must be an integer >= 1', 'shape');
  if (!isObj(s.from) || !isNum(s.from.x) || !isNum(s.from.y) || !SIM_LIES.includes(s.from.lie)) err(`${path}.from`, 'from must be { x, y, lie }', 'shape');
  if (!isObj(s.aim) || !isNum(s.aim.x) || !isNum(s.aim.y)) err(`${path}.aim`, 'aim must be { x, y }', 'shape');
  if (!isStr(s.club)) err(`${path}.club`, 'club must be a non-empty string', 'shape');
  if (!STROKE_SOURCES.includes(s.source)) err(`${path}.source`, `source must be one of ${STROKE_SOURCES.join('|')}`, 'shape');
  if (s.shot_id !== null && !isStr(s.shot_id)) err(`${path}.shot_id`, 'shot_id must be null or a string', 'shape');
  if (s.source === 'manual' && s.shot_id !== null) err(`${path}.shot_id`, 'a manual stroke has no golf-shot (it never feeds stats or gapping)', 'shape');
  checkValue(s.carry, `${path}.carry`, err);
  checkValue(s.side, `${path}.side`, err);
  if (!isObj(s.draw) || !(isInt(s.draw.seed) && s.draw.seed >= 0) || !isNum(s.draw.carry_m) || !isNum(s.draw.side_m)) err(`${path}.draw`, 'draw must be { seed (uint32), carry_m, side_m }', 'shape');
  else {
    // optional flight shape of an imported shot (sim/engine.js flightShape): apex_m > 0, land_deg 10–75; nothing else
    if ('apex_m' in s.draw && !(isNum(s.draw.apex_m) && s.draw.apex_m > 0)) err(`${path}.draw.apex_m`, 'draw.apex_m must be a number > 0', 'shape');
    if ('land_deg' in s.draw && !(isNum(s.draw.land_deg) && s.draw.land_deg >= 10 && s.draw.land_deg <= 75)) err(`${path}.draw.land_deg`, 'draw.land_deg must be a number in 10–75', 'shape');
    for (const k of Object.keys(s.draw)) if (!DRAW_KEYS.includes(k)) err(`${path}.draw.${k}`, `unknown draw key ${k}`, 'shape');
  }
  if (!isObj(s.landing) || !isNum(s.landing.x) || !isNum(s.landing.y) || !isNum(s.landing.z)) err(`${path}.landing`, 'landing must be { x, y, z }', 'shape');
  if (!isObj(s.rest) || !isNum(s.rest.x) || !isNum(s.rest.y) || !SIM_LIES.includes(s.rest.lie)) err(`${path}.rest`, 'rest must be { x, y, lie }', 'shape');
  if (![0, 1, 2].includes(s.penalty)) err(`${path}.penalty`, 'penalty must be 0, 1 or 2', 'shape');
  if (s.event !== null && !STROKE_EVENTS.includes(s.event)) err(`${path}.event`, `event must be null or one of ${STROKE_EVENTS.join('|')}`, 'shape');
}

/**
 * Validate a golf-round/1 record. opts.replayRound(round) -> { strokes: [{ rest: { x, y } }] } (or a strokes array)
 * enables the replay_matches rule; a replayRound that throws is a replay_matches error.
 */
export function validateRound(round, { replayRound = null } = {}) {
  const { errors, err } = checker();
  if (!isObj(round)) { err('$', 'round must be an object', 'shape'); return { ok: false, errors }; }
  let text = '';
  try { text = JSON.stringify(round); } catch (_) { text = ''; }
  if (text.length > ROUND_MAX_BYTES) err('$', `record is ${text.length} B, more than ${ROUND_MAX_BYTES} B`, 'size_limit');
  for (const k of Object.keys(round)) if (!ROUND_KEYS.includes(k)) err(k, 'unknown field', 'shape');
  if (round.schema !== ROUND_SCHEMA) err('schema', `schema must be '${ROUND_SCHEMA}', got ${show(round.schema)}`, 'schema');
  for (const k of ['round_id', 'app_version']) if (!isStr(round[k])) err(k, `${k} must be a non-empty string`, 'shape');
  for (const k of ['created_at', 'updated_at']) if (!(typeof round[k] === 'string' && ISO_RE.test(round[k]))) err(k, `${k} must be an ISO-8601 date-time with a timezone`, 'shape');
  if (!ROUND_STATUSES.includes(round.status)) err('status', `status must be one of ${ROUND_STATUSES.join('|')}`, 'shape');

  const c = round.course;
  let holesN = 0;
  if (!isObj(c)) err('course', 'course must be an object', 'shape');
  else {
    if (!isStr(c.generator)) err('course.generator', 'generator must be a string (course-1)', 'shape');
    if (!COURSE_STYLES.includes(c.style)) err('course.style', `style must be one of ${COURSE_STYLES.join('|')}`, 'shape');
    if (!(isInt(c.seed) && c.seed >= 0 && c.seed <= 0xffffffff)) err('course.seed', 'seed must be a uint32', 'shape');
    if (!TEE_IDS.includes(c.tees)) err('course.tees', `tees must be one of ${TEE_IDS.join('|')}`, 'shape');
    if (c.holes_n !== 9 && c.holes_n !== 18) err('course.holes_n', 'holes_n must be 9 or 18', 'holes_count');
    else holesN = c.holes_n;
    if (!Array.isArray(c.holes)) err('course.holes', 'holes must be an array', 'shape');
    else {
      if (c.holes.length !== c.holes_n) err('course.holes', `holes.length ${c.holes.length} must equal holes_n ${show(c.holes_n)}`, 'holes_count');
      c.holes.forEach((h, i) => checkHole(h, `course.holes.${i}`, i, err));
    }
  }

  const r = round.rules;
  if (!isObj(r)) err('rules', 'rules must be an object', 'shape');
  else {
    for (const [k, list] of Object.entries(RULE_OPTIONS)) if (!list.includes(r[k])) err(`rules.${k}`, `must be one of ${list.join('|')}`, 'shape');
    if (!(isNum(r.autoChipM) && r.autoChipM >= 0 && r.autoChipM <= 40)) err('rules.autoChipM', 'autoChipM must be 0–40', 'shape');
    if (!isStr(r.params_version)) err('rules.params_version', 'params_version must be a string', 'shape');
  }

  const players = Array.isArray(round.players) ? round.players : null;
  const playerIds = new Set();
  if (!players || players.length < 1 || players.length > MAX_PLAYERS) err('players', `players must hold 1–${MAX_PLAYERS} players, got ${players ? players.length : show(round.players)}`, 'players_count');
  for (const [i, p] of (players ?? []).entries()) {
    const at = `players.${i}`;
    if (!isObj(p) || !isStr(p.player_id) || playerIds.has(p.player_id)) { err(at, 'player needs a unique player_id', 'shape'); continue; }
    playerIds.add(p.player_id);
    if (typeof p.name !== 'string') err(`${at}.name`, 'name must be a string', 'shape');
    if (!HANDEDNESS.includes(p.handedness)) err(`${at}.handedness`, `handedness must be ${HANDEDNESS.join('|')}`, 'shape');
    if (!PLAYER_KINDS.includes(p.kind)) err(`${at}.kind`, `kind must be ${PLAYER_KINDS.join('|')}`, 'shape');
    if (p.driver_carry_m !== null && !(isNum(p.driver_carry_m) && p.driver_carry_m > 0)) err(`${at}.driver_carry_m`, 'driver_carry_m must be null or > 0', 'shape');
    if (!PUTT_SKILLS.includes(p.putt_skill)) err(`${at}.putt_skill`, `putt_skill must be one of ${PUTT_SKILLS.join('|')}`, 'shape');
  }

  const strokes = Array.isArray(round.strokes) ? round.strokes : null;
  if (!strokes) err('strokes', 'strokes must be an array', 'shape');
  const ctx = { playerIds, holesN: holesN || 18 };
  const lastN = new Map();
  let prevSeq = -1;
  for (const [i, s] of (strokes ?? []).entries()) {
    const at = `strokes.${i}`;
    checkStroke(s, at, ctx, err);
    if (!isObj(s)) continue;
    if (isInt(s.seq)) {
      if (!(s.seq > prevSeq)) err(`${at}.seq`, `seq ${s.seq} must be greater than the previous ${prevSeq}`, 'stroke_seq_increasing');
      prevSeq = s.seq;
    }
    const key = `${s.player_id}\u0000${s.hole}`;
    const want = (lastN.get(key) ?? 0) + 1;
    if (s.n !== want) err(`${at}.n`, `stroke n must be ${want} for player ${show(s.player_id)} on hole ${show(s.hole)}, got ${show(s.n)}`, 'stroke_n_sequence');
    if (isInt(s.n)) lastN.set(key, s.n);
  }

  const cur = round.current;
  if (cur !== null && !(isObj(cur) && isInt(cur.hole) && cur.hole >= 1 && cur.hole <= ctx.holesN && playerIds.has(cur.player_id))) {
    err('current', 'current must be null or { hole, player_id } of a known player', 'shape');
  }

  if (typeof replayRound === 'function' && strokes && errors.length === 0) {
    try {
      const out = replayRound(round);
      const re = Array.isArray(out) ? out : out?.strokes;
      if (!Array.isArray(re) || re.length !== strokes.length) err('strokes', 'replay produced a different number of strokes', 'replay_matches');
      else {
        re.forEach((x, i) => {
          const d = Math.hypot((x?.rest?.x ?? NaN) - strokes[i].rest.x, (x?.rest?.y ?? NaN) - strokes[i].rest.y);
          if (!(d <= REPLAY_TOLERANCE_M)) err(`strokes.${i}.rest`, `replayed rest differs by ${Number.isFinite(d) ? d.toFixed(3) : 'NaN'} m (> ${REPLAY_TOLERANCE_M} m)`, 'replay_matches');
        });
      }
    } catch (e) {
      err('strokes', `replay failed: ${e?.code ?? e?.message ?? String(e)}`, 'replay_matches');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** golf-lab/1: { shot_id, view, algo: { version, sha256 }, faults: [{ id, status, value, sigma, threshold, event, reason_codes }], computed_at }. */
export function validateLabRecord(rec) {
  const { errors, err } = checker();
  if (!isObj(rec)) { err('$', 'record must be an object', 'shape'); return { ok: false, errors }; }
  if (!isStr(rec.shot_id)) err('shot_id', 'shot_id must be a non-empty string', 'shape');
  if (!VIEWS.includes(rec.view)) err('view', `view must be one of ${VIEWS.join('|')}`, 'shape');
  if (!isObj(rec.algo) || !isStr(rec.algo.version) || !isStr(rec.algo.sha256)) err('algo', 'algo must be { version, sha256 }', 'shape');
  if (!(typeof rec.computed_at === 'string' && ISO_RE.test(rec.computed_at))) err('computed_at', 'computed_at must be an ISO-8601 date-time', 'shape');
  if (!Array.isArray(rec.faults)) err('faults', 'faults must be an array', 'shape');
  for (const [i, f] of (Array.isArray(rec.faults) ? rec.faults : []).entries()) {
    const at = `faults.${i}`;
    if (!isObj(f) || !isStr(f.id)) { err(at, 'fault needs an id', 'shape'); continue; }
    if (!FAULT_STATUSES.includes(f.status)) err(`${at}.status`, `status must be one of ${FAULT_STATUSES.join('|')}`, 'shape');
    if (!Array.isArray(f.reason_codes) || !f.reason_codes.every((c) => c in REASON_CODES)) err(`${at}.reason_codes`, 'reason_codes must be reason codes', 'shape');
    if (f.status === 'unknown' && !(f.reason_codes ?? []).length) err(`${at}.reason_codes`, 'an unknown status needs a reason code', 'null_needs_reason');
    if (f.status === 'possible' && !(f.reason_codes ?? []).includes(RC.FAULT_INCONCLUSIVE)) err(`${at}.reason_codes`, 'possible needs FAULT_INCONCLUSIVE', 'shape');
    for (const k of ['value', 'sigma', 'threshold']) if (has(f, k) && f[k] !== null && !isNum(f[k])) err(`${at}.${k}`, `${k} must be a number or null`, 'shape');
  }
  return { ok: errors.length === 0, errors };
}
