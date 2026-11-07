// sim/round.js — applying strokes to a golf-round/1 record, turn order, the derived scorecard and the deterministic
// replay (V04-SPEC §C.3, §C.4, §F.2). Lazy, pure (no clock: the caller sets updated_at; no randomness). Owner V4-C.
// contract/round.js validateRound(round, { replayRound }) uses replayRound for its replay_matches rule.
//
//   playStroke(round, outcome, aim) -> { round, stroke }        (FROZEN) the current player's stroke
//   scorecard(round) -> { players: [...] }                      (FROZEN) never stored, derived from strokes
//   replayRound(round) -> { strokes: [{ rest, landing, penalty, event }] }   (FROZEN) re-run from stored draws
//   Extras for V4-D (optional, additive):
//   newRound({ round_id, created_at, app_version, course, settings, players }) -> golf-round/1 (status active)
//   roundRules(settings.sim) -> rules block    strokeSeed(round) -> uint32 for the next stroke's draw
//   ballOf(round, player_id, hole?) -> { x, y, z, lie, n, strokes, penalties, score, done, holed, picked_up, to_pin_m }
//   strokeContext(round) -> { player, hole, ball, style, seed, to_pin_m, dz_m } | null   (the current turn)
//   honourOrder(round, hole) -> player_id[]    nextTurn(round) -> { current, status }
//   applyStroke(round, player_id, outcome, aim) -> { round, stroke }   (any player; used by sim/putting.js)
//
// Turn order (§C.4 pass-and-play): everyone tees off first in honour order (previous hole's score, ties keep the
// previous order; hole 1 = player order), then the ball farthest from the pin plays. A player is done on a hole when
// holed or picked up (max score: rules.maxScore 'double_par' → picked up at 2 × par, scored 2 × par).

import { resolveStroke } from './rules.js';
import { SIM_PARAMS as P } from './params.js';
import { normalizeSim } from './settings.js';
import { mix32 } from '../course/detmath.js';
import { elevationAt, dist } from '../course/model.js';

const r2 = (x) => {
  const y = Math.round(x * 100) / 100;
  return y === 0 ? 0 : y;
};

export function roundRules(sim) {
  const s = normalizeSim(sim);
  return { unobservedSide: s.unobservedSide, putting: s.putting, ob: s.ob, maxScore: s.maxScore, autoChipM: s.autoChipM, params_version: P.version };
}

export function newRound({ round_id, created_at, app_version, course, settings = {}, players }) {
  const s = normalizeSim(settings);
  const ps = (players ?? []).map((p, i) => ({
    player_id: p.player_id ?? `p${i + 1}`, name: p.name ?? '', handedness: p.handedness === 'left' ? 'left' : 'right',
    kind: p.kind === 'guest' ? 'guest' : 'owner', driver_carry_m: typeof p.driver_carry_m === 'number' && p.driver_carry_m > 0 ? p.driver_carry_m : null,
    putt_skill: [0, 10, 20, 30].includes(p.putt_skill) ? p.putt_skill : s.puttSkill,
  }));
  const round = {
    schema: 'golf-round/1', round_id, created_at, updated_at: created_at, app_version, status: 'active',
    course, rules: roundRules(s), players: ps, strokes: [], current: null,
  };
  return { ...round, ...nextTurn(round) };
}

const holeOf = (round, n) => round.course.holes[n - 1];
const playerOf = (round, id) => round.players.find((p) => p.player_id === id) ?? null;

/** Seed for the next stroke's draw: course seed × round id × stroke seq (uint32). */
export function strokeSeed(round, offset = 0) {
  let h = mix32(round.course?.seed ?? 0, 0x726f756e);
  for (const ch of String(round.round_id ?? '')) h = mix32(h, ch.charCodeAt(0));
  const seq = (round.strokes.length ? round.strokes[round.strokes.length - 1].seq + 1 : 0) + offset;
  return mix32(h, seq + 1);
}

export function ballOf(round, player_id, holeN = round.current?.hole ?? 1) {
  const hole = holeOf(round, holeN);
  let last = null, n = 0, pen = 0, holed = false, picked = false;
  for (const s of round.strokes) {
    if (s.player_id !== player_id || s.hole !== holeN) continue;
    last = s;
    if (s.source !== 'pickup') n++;
    pen += s.penalty;
    if (s.event === 'holed') holed = true;
    if (s.source === 'pickup') picked = true;
  }
  const t = hole.tees[round.course.tees] ?? hole.tees.middle;
  const pos = last ? { x: last.rest.x, y: last.rest.y, lie: last.rest.lie } : { x: t[0], y: t[1], lie: 'tee' };
  const cap = P.max_score_par_mult * hole.par;
  return {
    ...pos, z: elevationAt(hole, pos.x, pos.y), n: (last?.n ?? 0) + 1, strokes: n, penalties: pen,
    score: picked ? cap : n + pen, done: holed || picked, holed, picked_up: picked,
    to_pin_m: dist(pos.x, pos.y, hole.pin[0], hole.pin[1]),
  };
}

export function honourOrder(round, holeN) {
  const ids = round.players.map((p) => p.player_id);
  if (holeN <= 1) return ids;
  const prev = honourOrder(round, holeN - 1);
  const score = (id) => {
    const b = ballOf(round, id, holeN - 1);
    return b.done ? b.score : Infinity;
  };
  return prev.map((id, i) => [id, score(id), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
}

export function nextTurn(round) {
  const from = round.current?.hole ?? 1;
  for (let h = from; h <= round.course.holes_n; h++) {
    const order = honourOrder(round, h);
    const balls = order.map((id) => [id, ballOf(round, id, h)]);
    const pending = balls.filter(([, b]) => !b.done);
    if (!pending.length) continue;
    const unteed = pending.filter(([, b]) => b.n === 1);
    if (unteed.length) return { current: { hole: h, player_id: unteed[0][0] }, status: 'active' };
    let best = pending[0];
    for (const p of pending) if (p[1].to_pin_m > best[1].to_pin_m) best = p;
    return { current: { hole: h, player_id: best[0] }, status: 'active' };
  }
  return { current: null, status: round.status === 'abandoned' ? 'abandoned' : 'finished' };
}

export function strokeContext(round) {
  if (!round.current) return null;
  const { hole: h, player_id } = round.current;
  const hole = holeOf(round, h);
  const ball = ballOf(round, player_id, h);
  return {
    player: playerOf(round, player_id), hole, ball, style: hole.style, seed: strokeSeed(round), to_pin_m: ball.to_pin_m,
    dz_m: elevationAt(hole, hole.pin[0], hole.pin[1]) - ball.z,
  };
}

const zeroValue = () => ({ value: 0, ci95: null, sigma: 0, validity: 'estimated', origin: 'sim', reason_codes: [] });

function append(round, stroke) {
  return { ...round, strokes: [...round.strokes, stroke] };
}

function maybePickup(round, player_id, holeN) {
  if (round.rules?.maxScore !== 'double_par') return round;
  const hole = holeOf(round, holeN);
  const b = ballOf(round, player_id, holeN);
  if (b.done || b.score < P.max_score_par_mult * hole.par) return round;
  const last = [...round.strokes].reverse().find((s) => s.player_id === player_id && s.hole === holeN);
  const seq = round.strokes[round.strokes.length - 1].seq + 1;
  return append(round, {
    seq, player_id, hole: holeN, n: b.n, from: { x: b.x, y: b.y, lie: b.lie }, aim: { x: hole.pin[0], y: hole.pin[1] },
    club: last?.club ?? 'putter', source: 'pickup', shot_id: null, carry: zeroValue(), side: zeroValue(),
    draw: { seed: 0, carry_m: 0, side_m: 0 }, landing: { x: b.x, y: b.y, z: r2(b.z) }, rest: { x: b.x, y: b.y, lie: b.lie }, penalty: 0, event: null,
  });
}

export function applyStroke(round, player_id, outcome, aim) {
  const player = playerOf(round, player_id);
  if (!player) throw new RangeError(`playStroke: unknown player ${player_id}`);
  const holeN = round.current?.hole;
  if (!holeN) throw Object.assign(new Error('playStroke: the round is finished'), { code: 'ROUND_FINISHED' });
  const hole = holeOf(round, holeN);
  const ball = ballOf(round, player_id, holeN);
  if (ball.done) throw Object.assign(new Error(`playStroke: ${player_id} is done on hole ${holeN}`), { code: 'HOLE_DONE' });
  const club = outcome.club;
  if (typeof club !== 'string' || !club) throw new TypeError('playStroke: outcome.club is required (sim/engine.js shotOutcome sets it)');
  const a = aim && Number.isFinite(aim.x) && Number.isFinite(aim.y) ? { x: r2(aim.x), y: r2(aim.y) } : { x: hole.pin[0], y: hole.pin[1] };
  const from = { x: ball.x, y: ball.y, lie: ball.lie };
  const draw = { seed: outcome.draw.seed >>> 0, carry_m: r2(outcome.draw.carry_m), side_m: r2(outcome.draw.side_m) };
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  if (fin(outcome.draw.apex_m) && fin(outcome.draw.land_deg)) { draw.apex_m = Math.round(outcome.draw.apex_m * 10) / 10; draw.land_deg = Math.round(outcome.draw.land_deg * 10) / 10; }
  const res = resolveStroke(hole, { from, aim: a, draw, club, source: outcome.source, handedness: player.handedness, rules: round.rules, style: hole.style });
  const seq = round.strokes.length ? round.strokes[round.strokes.length - 1].seq + 1 : 0;
  const stroke = {
    seq, player_id, hole: holeN, n: ball.n, from, aim: a, club, source: outcome.source,
    shot_id: outcome.source === 'manual' ? null : outcome.shot_id ?? null,
    carry: outcome.carry, side: outcome.side, draw, landing: res.landing, rest: res.rest, penalty: res.penalty, event: res.event,
  };
  let next = maybePickup(append(round, stroke), player_id, holeN);
  next = { ...next, ...nextTurn(next) };
  return { round: next, stroke };
}

/**
 * Land an outcome from the current ball position toward `aim`: flight vs slope, trees, water, OB, roll, penalties,
 * max score, next player. Returns a NEW round (input untouched) and the stroke appended to it.
 * @param {object} round      golf-round/1
 * @param {import('./engine.js').Outcome} outcome   (+ outcome.club, set by shotOutcome)
 * @param {{ x: number, y: number }} aim
 * @returns {{ round: object, stroke: object }}
 */
export function playStroke(round, outcome, aim) {
  if (!round || !Array.isArray(round.strokes) || !round.course) throw new TypeError('playStroke: round must be a golf-round/1 record');
  if (!outcome || !outcome.draw) throw new TypeError('playStroke: outcome must come from sim/engine.js shotOutcome');
  if (!round.current) throw Object.assign(new Error('playStroke: the round is finished'), { code: 'ROUND_FINISHED' });
  return applyStroke(round, round.current.player_id, outcome, aim);
}

/**
 * The scorecard (never stored): per player per hole strokes, putts, penalties; out / in / total; to par.
 * strokes / putts are null until the player has finished that hole (extras: done, so_far = strokes + penalties so far).
 */
export function scorecard(round) {
  const holes = round.course.holes;
  return {
    players: round.players.map((p) => {
      const rows = holes.map((h) => {
        const b = ballOf(round, p.player_id, h.n);
        const started = b.n > 1;
        let putts = 0;
        for (const s of round.strokes) if (s.player_id === p.player_id && s.hole === h.n && s.source !== 'pickup' && s.club === 'putter') putts++;
        return {
          hole: h.n, par: h.par, strokes: b.done ? b.score : null, putts: b.done ? putts : null, penalties: b.penalties,
          picked_up: b.picked_up, done: b.done, so_far: started ? b.strokes + b.penalties : 0,
        };
      });
      const sum = (list) => {
        const d = list.filter((r) => r.done);
        return d.length ? d.reduce((a, r) => a + r.strokes, 0) : null;
      };
      const total = sum(rows);
      const parDone = rows.filter((r) => r.done).reduce((a, r) => a + r.par, 0);
      return {
        player_id: p.player_id, holes: rows, out: sum(rows.slice(0, 9)), in: holes.length > 9 ? sum(rows.slice(9)) : null,
        total, to_par: total === null ? null : total - parDone,
      };
    }),
  };
}

/**
 * Re-run every stroke from its stored draw and the round rules; same order and length as round.strokes. The chain of
 * positions is rebuilt (each stroke starts where the replayed previous one rested), so a tampered or inconsistent
 * record shows up as a rest mismatch (contract/round.js replay_matches, tolerance 0.05 m).
 */
export function replayRound(round) {
  const at = new Map();
  const out = [];
  for (const s of round.strokes) {
    const hole = holeOf(round, s.hole);
    const player = playerOf(round, s.player_id);
    const key = `${s.player_id}\u0000${s.hole}`;
    let from = at.get(key);
    if (!from) {
      const t = hole.tees[round.course.tees] ?? hole.tees.middle;
      from = { x: t[0], y: t[1], lie: 'tee' };
    }
    const res = resolveStroke(hole, { from, aim: s.aim, draw: s.draw, club: s.club, source: s.source, handedness: player?.handedness ?? 'right', rules: round.rules, style: hole.style });
    at.set(key, res.rest);
    out.push({ from, rest: res.rest, landing: res.landing, penalty: res.penalty, event: res.event });
  }
  return { strokes: out };
}
