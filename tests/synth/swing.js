// Parametric synthetic golfer for the events + metrics tests (pure, deterministic given the seed).
//
// A right-handed golfer is modelled in the mat frame M (docs/interfaces.md §2: +x target, +z up, golfer at +y
// facing -y). 33 BlazePose landmarks are animated through a full swing with controllable tempo, spine tilts,
// head sway, hip / shoulder turn, pelvis shift and club shaft; then projected through a camera of any view into
// a PoseSeq (image landmarks + MediaPipe-style world landmarks) with visibility, pixel noise, motion-blur noise and
// out-of-frame extrapolation. A left-handed swing is the exact mirror image: the scene and the camera are mirrored
// through the plane y = 0, which is the same as mirroring the RH image (u -> W - u) and swapping the left/right
// landmark labels (proved in docs/metrics-by-view.md, "Handedness").
//
//   swingParams(rng, overrides?)      -> params (random but plausible)
//   buildSwingModel(params)           -> { landmarks(t) -> Float64Array(99), hands(t), clubHead(t), shaftDir(t),
//                                          p(t), times, truth: { events, metrics } }   (canonical right-handed M)
//   synthSwing(opts)                  -> { poseSeq, truth, camera, calibration, audioOnset_t, clubObs, model, … }
//   mirrorCamera(cam)                 -> camera of the mirrored (left-handed) setup
//   synthLiveSession(opts)            -> { samples: [{type:'wrist'|'audio', t_s, …}], truth }
//
// Ground truth definitions match docs/metrics-by-view.md (event definitions and metric definitions).

import { mulberry32, gauss, uniform } from '../../app/src/geom/rng.js';
import { DEG, RAD2DEG } from '../../app/src/geom/constants.js';
import { add3, sub3, scale3, dot3, cross3, norm3, normalize3, rotAxisAngle, mat3MulVec } from '../../app/src/geom/linalg.js';
import { nominalCamera, project, makeCamera, center, toCamera, eulerFromR, rFromEuler, poseReport } from '../../app/src/geom/camera.js';

export const EVENT_NAMES = ['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact', 'mid_follow_through', 'finish'];
const LR_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const SWAP = (() => { const m = Array.from({ length: 33 }, (_, i) => i); for (const [a, b] of LR_PAIRS) { m[a] = b; m[b] = a; } return m; })();

const clamp01 = (s) => (s < 0 ? 0 : s > 1 ? 1 : s);
const smooth = (s) => { const x = clamp01(s); return x * x * (3 - 2 * x); };
// Downswing progress g(s) = GA s^2 + GB s^3: g(0) = 0, g'(0) = 0 (rest at the top), g(1) = 1, hands still
// accelerating until s ~ 0.85, g'(1) = 1.355.
const GA = 1.645;
const GB = -0.645;
const gDown = (s) => GA * s * s + GB * s * s * s;
const G_D1 = 2 * GA + 3 * GB;

/** Random but plausible swing parameters (all lengths in m, angles in deg, times in s). */
export function swingParams(rng, o = {}) {
  const u = (lo, hi) => uniform(rng, lo, hi);
  const p = {
    stature: u(1.65, 1.88),
    stance: u(0.34, 0.48),
    feetX: u(-0.06, 0.02),
    feetY: u(0.62, 0.72),
    spineFwd_deg: u(30, 45),
    spineSide_deg: u(3, 12),
    t_address: u(0.8, 1.2),
    backswing_s: u(0.7, 1.0),
    tempo: u(2.4, 3.6),
    ftFrac: u(0.6, 0.9),
    hold_s: u(1.0, 1.4),
    pFin: -u(1.1, 1.3),
    shoulderTurnTop_deg: u(75, 100),
    hipTurnTop_deg: u(30, 55),
    shoulderImp_deg: -u(10, 30),
    hipImp_deg: -u(25, 45),
    shoulderFin_deg: -u(95, 120),
    hipFin_deg: -u(75, 95),
    headTop: [u(-0.08, 0.01), u(-0.02, 0.02), u(-0.02, 0.02)],
    headImp: [u(-0.04, 0.05), -u(-0.02, 0.06), u(-0.05, 0.03)],
    pelvisTop: [u(-0.05, -0.01), u(-0.01, 0.02), 0],
    pelvisImp: [u(0.03, 0.12), -u(-0.02, 0.08), u(-0.01, 0.02)],
    sideTiltTop_deg: -u(2, 6),
    sideTiltImp_deg: u(8, 20),
    fwdTiltLossImp_deg: u(0, 8),
    handsAhead: u(0.0, 0.06),
    handsTopX: u(0.15, 0.3),
    handsTopY: u(0.1, 0.22),
    handsTopZ: u(1.4, 1.62),
    handsFinX: u(0.3, 0.45),
    handsFinY: u(0.18, 0.3),
    handsFinZ: u(1.35, 1.65),
    lowPointP: u(0, 0.06),
    shaftTop_deg: u(255, 285),
    shaftFin_deg: u(250, 290),
    shaftOutOfPlaneTop_deg: u(-10, 10),
    clubLen: u(0.8, 0.95),
    ankleH: 0.075 + u(-0.012, 0.012),
    heelH: 0.032 + u(-0.008, 0.008),
    toeH: 0.022 + u(-0.006, 0.006),
  };
  return { ...p, ...o };
}

function keyed(t, T4, keys, shapes) {
  if (t <= T4[0]) return keys[0];
  for (let i = 0; i < 3; i++) {
    if (t <= T4[i + 1]) {
      const s = (t - T4[i]) / (T4[i + 1] - T4[i]);
      const w = (shapes && shapes[i] ? shapes[i] : smooth)(s);
      const a = keys[i];
      const b = keys[i + 1];
      return Array.isArray(a) ? a.map((x, j) => x + (b[j] - x) * w) : a + (b - a) * w;
    }
  }
  return keys[3];
}

function ik(S, W, L1in, L2in, pole) {
  const d = sub3(W, S);
  const dist = norm3(d);
  if (dist < 1e-9) return add3(S, [0, 0, -L1in]);
  const uvec = scale3(d, 1 / dist);
  // soft reach: the limb lengthens smoothly instead of snapping straight (no sqrt singularity at full reach)
  const x = dist / (0.95 * (L1in + L2in)) - 1;
  const grow = 1 + 0.03 * Math.log1p(Math.exp(x / 0.03));
  const L1 = L1in * grow;
  const L2 = L2in * grow;
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  let n = sub3(pole, scale3(uvec, dot3(pole, uvec)));
  if (norm3(n) < 1e-9) n = Math.abs(uvec[0]) < 0.9 ? cross3(uvec, [1, 0, 0]) : cross3(uvec, [0, 1, 0]);
  n = normalize3(n);
  return add3(add3(S, scale3(uvec, a)), scale3(n, h));
}

function wrapPi(a) {
  let y = a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  if (y <= -Math.PI) y += 2 * Math.PI;
  return y;
}

/** Deterministic kinematic model of one right-handed swing in M. */
export function buildSwingModel(P) {
  const k = P.stature / 1.75;
  const tA = P.t_address;
  const B = P.backswing_s;
  const D = B / P.tempo;
  const tT = tA + B;
  const tI = tT + D;
  const v0 = -G_D1 / D; // dp/dt at impact (p units per s, negative)
  const F = (P.ftFrac * 3 * Math.abs(P.pFin)) / Math.abs(v0);
  const aF = 6 * (P.pFin / (v0 * F) - 0.5);
  const tF = tI + F;
  const tEnd = tF + P.hold_s;
  const T4 = [tA, tT, tI, tF];

  const pOf = (t) => {
    if (t <= tA) return 0;
    if (t <= tT) return smooth((t - tA) / B);
    if (t <= tI) return 1 - gDown((t - tT) / D);
    if (t <= tF) {
      const s = (t - tI) / F;
      return v0 * F * (s + ((aF - 1) * s * s) / 2 - (aF * s * s * s) / 3);
    }
    return P.pFin;
  };

  const ankleL = [P.feetX + P.stance / 2, P.feetY, P.ankleH * k];
  const ankleR = [P.feetX - P.stance / 2, P.feetY, P.ankleH * k];
  const P0 = [P.feetX, P.feetY + 0.06 * k, 0.88 * k];
  const Lsp = 0.5 * k;
  const ws = 0.19 * k;
  const wh = 0.14 * k;
  const spineVec = (aDeg, bDeg) => normalize3([-Math.tan(bDeg * DEG), -Math.tan(aDeg * DEG), 1]);
  const s0 = spineVec(P.spineFwd_deg, P.spineSide_deg);
  const M0 = add3(P0, scale3(s0, Lsp));
  const xh0 = P.feetX + P.handsAhead;
  const yh0 = M0[1] - 0.03;
  const zh0 = 0.74 * k;
  const Hc0 = add3(add3(M0, scale3(s0, 0.25 * k)), [0, -0.03 * k, 0]);
  const KX = 0.85;
  const KZ = 0.8;
  const S1 = Math.sin((Math.PI * KX) / 2);
  const C1 = 1 - Math.cos(Math.PI * KZ);
  const CX1 = 1 - Math.cos(Math.PI * KX);
  const aZ = ((P.handsTopZ - zh0) * (Math.PI * KZ) ** 2) / 2 / C1;
  const cLP = 2 * aZ * P.lowPointP;
  const Xm = (P.handsTopX + P.handsFinX) / 2;
  const Xd = (P.handsFinX - P.handsTopX) / 2;

  const handsAtP = (p) => {
    const Sx = Math.sin((p * Math.PI * KX) / 2) / S1;
    const ex = (1 - Math.cos(p * Math.PI * KX)) / CX1;
    const w = (1 - Math.cos(p * Math.PI * KZ)) / C1;
    const x = xh0 - Xm * Sx + Xd * ex;
    const y = yh0 + (p >= 0 ? P.handsTopY : P.handsFinY) * w;
    const z = zh0 + ((p >= 0 ? P.handsTopZ : P.handsFinZ) - zh0) * w + cLP * p;
    return [x, y, z];
  };
  const eB = [-1, 0, 0];
  const eD = normalize3([0, -yh0, -(zh0 - 0.03)]);
  const nP = cross3(eB, eD);
  // In-plane shaft angle (deg): 0 = pointing at the ball, 90 = toe up (parallel to the target line, trail side),
  // 270 = parallel at the top. Downswing release r(p) = 1 - (1 - p)^RC keeps the lag early and has a finite
  // slope at impact; the follow-through profile matches dσ/dt across impact.
  const RCD = 1.8;
  const RCF = (RCD * P.shaftTop_deg * Math.abs(P.pFin)) / P.shaftFin_deg;
  const sigmaOf = (t) => {
    const p = pOf(t);
    if (t <= tA) return 0;
    if (t <= tT) return P.shaftTop_deg * Math.pow(Math.max(p, 0), 0.9);
    if (t <= tI) return P.shaftTop_deg * (1 - Math.pow(1 - clamp01(p), RCD));
    if (t <= tF) return -P.shaftFin_deg * (1 - Math.pow(1 - clamp01(p / P.pFin), RCF));
    return -P.shaftFin_deg;
  };
  const shaftDir = (t) => {
    const sg = sigmaOf(t) * DEG;
    const p = Math.max(pOf(t), 0);
    const oop = Math.tan(P.shaftOutOfPlaneTop_deg * DEG) * p ** 4;
    return normalize3(add3(add3(scale3(eD, Math.cos(sg)), scale3(eB, Math.sin(sg))), scale3(nP, oop)));
  };
  const hands = (t) => handsAtP(pOf(t));
  const clubHead = (t) => add3(hands(t), scale3(shaftDir(t), P.clubLen));
  const hipSlow = (s) => smooth(Math.min(1, s / 0.8));

  const pelvis = (t) => add3(P0, keyed(t, T4, [[0, 0, 0], P.pelvisTop, P.pelvisImp,
    add3(P.pelvisImp, [0.05, -0.03, 0.03])], [smooth, hipSlow, smooth]));
  const spineAngles = (t) => [
    keyed(t, T4, [P.spineFwd_deg, P.spineFwd_deg - 1, P.spineFwd_deg - P.fwdTiltLossImp_deg, P.spineFwd_deg - 25]),
    keyed(t, T4, [P.spineSide_deg, P.spineSide_deg + P.sideTiltTop_deg, P.spineSide_deg + P.sideTiltImp_deg,
      P.spineSide_deg + 15]),
  ];
  const shTurn = (t) => keyed(t, T4, [0, P.shoulderTurnTop_deg, P.shoulderImp_deg, P.shoulderFin_deg]);
  const hipTurn = (t) => keyed(t, T4, [0, P.hipTurnTop_deg, P.hipImp_deg, P.hipFin_deg], [smooth, hipSlow, smooth]);
  const headDisp = (t) => keyed(t, T4, [[0, 0, 0], P.headTop, P.headImp, add3(P.headImp, [0.1, 0, 0.04])]);
  const headRot = (t) => keyed(t, T4, [0, 0, 0, 60]);
  const heelLift = (t) => keyed(t, T4, [0, 0, 0, 0.08 * k]);

  function landmarks(t) {
    const L = new Float64Array(99);
    const set = (j, X) => { L[3 * j] = X[0]; L[3 * j + 1] = X[1]; L[3 * j + 2] = X[2]; };
    const Pv = pelvis(t);
    const ph = hipTurn(t) * DEG;
    const hipL = add3(Pv, [wh * Math.cos(ph), -wh * Math.sin(ph), 0]);
    const hipR = sub3(Pv, [wh * Math.cos(ph), -wh * Math.sin(ph), 0]);
    const [aD, bD] = spineAngles(t);
    const s = spineVec(aD, bD);
    const Mv = add3(Pv, scale3(s, Lsp));
    const e0 = normalize3(sub3([1, 0, 0], scale3(s, s[0])));
    const e = mat3MulVec(rotAxisAngle(s, -shTurn(t) * DEG), e0);
    const shL = add3(Mv, scale3(e, ws));
    const shR = sub3(Mv, scale3(e, ws));
    const h = hands(t);
    const d = shaftDir(t);
    const wL = sub3(h, scale3(d, 0.035));
    const wR = add3(h, scale3(d, 0.035));
    const pole = [0, 0.3, -1];
    const elL = ik(shL, wL, 0.29 * k, 0.27 * k, pole);
    const elR = ik(shR, wR, 0.29 * k, 0.27 * k, pole);
    let n = cross3(d, [0, 0, 1]);
    n = norm3(n) > 1e-6 ? normalize3(n) : [1, 0, 0];
    // feet: the lead foot stays planted; the trail heel lifts after impact
    const lift = heelLift(t);
    const aL = ankleL;
    const aR = [ankleR[0], ankleR[1], ankleR[2] + 0.6 * lift];
    const heelL = [aL[0], aL[1] + 0.06 * k, P.heelH * k];
    const heelR = [ankleR[0], ankleR[1] + 0.06 * k, P.heelH * k + lift];
    const toeL = [aL[0] + 0.04 * k, aL[1] - 0.17 * k, P.toeH * k];
    const toeR = [ankleR[0] - 0.04 * k, ankleR[1] - 0.17 * k, P.toeH * k];
    const kneePole = [0, -1, 0.2];
    const knL = ik(hipL, aL, 0.43 * k, 0.42 * k, kneePole);
    const knR = ik(hipR, aR, 0.43 * k, 0.42 * k, kneePole);
    // head
    const Hc = add3(Hc0, headDisp(t));
    let f = normalize3(sub3([0, 0, 0], Hc0));
    const hr = headRot(t) * DEG;
    f = [f[0] * Math.cos(hr) - f[1] * Math.sin(hr), f[0] * Math.sin(hr) + f[1] * Math.cos(hr), f[2]];
    const l = normalize3(cross3([0, 0, 1], f));
    const up = normalize3(cross3(f, l));
    const hp = (a, b, c) => add3(add3(add3(Hc, scale3(f, a * k)), scale3(l, b * k)), scale3(up, c * k));
    set(0, hp(0.1, 0, 0));
    set(1, hp(0.085, 0.015, 0.035)); set(2, hp(0.08, 0.03, 0.035)); set(3, hp(0.075, 0.045, 0.035));
    set(4, hp(0.085, -0.015, 0.035)); set(5, hp(0.08, -0.03, 0.035)); set(6, hp(0.075, -0.045, 0.035));
    set(7, hp(0, 0.075, 0)); set(8, hp(0, -0.075, 0));
    set(9, hp(0.085, 0.025, -0.045)); set(10, hp(0.085, -0.025, -0.045));
    set(11, shL); set(12, shR); set(13, elL); set(14, elR); set(15, wL); set(16, wR);
    set(17, add3(add3(wL, scale3(d, 0.06)), scale3(n, -0.02))); set(18, add3(add3(wR, scale3(d, 0.06)), scale3(n, -0.02)));
    set(19, add3(add3(wL, scale3(d, 0.07)), scale3(n, 0.02))); set(20, add3(add3(wR, scale3(d, 0.07)), scale3(n, 0.02)));
    set(21, add3(add3(wL, scale3(d, 0.04)), scale3(n, 0.03))); set(22, add3(add3(wR, scale3(d, 0.04)), scale3(n, 0.03)));
    set(23, hipL); set(24, hipR); set(25, knL); set(26, knR); set(27, aL); set(28, aR);
    set(29, heelL); set(30, heelR); set(31, toeL); set(32, toeR);
    return L;
  }

  const lm = (t, j) => { const L = landmarks(t); return [L[3 * j], L[3 * j + 1], L[3 * j + 2]]; };
  const bisect = (fn, a, b) => {
    let fa = fn(a);
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2;
      const fm = fn(m);
      if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
    }
    return (a + b) / 2;
  };
  const firstCrossing = (fn, a, b, step = 1e-3) => {
    let prev = fn(a);
    for (let t = a + step; t <= b + 1e-12; t += step) {
      const cur = fn(t);
      if ((cur > 0) !== (prev > 0)) return bisect(fn, t - step, t);
      prev = cur;
    }
    return null;
  };
  const leadArmZ = (t) => lm(t, 15)[2] - lm(t, 11)[2];
  const events = {
    address: tA,
    toe_up: firstCrossing((t) => sigmaOf(t) - 90, tA + 1e-6, tT),
    mid_backswing: firstCrossing(leadArmZ, tA + 1e-6, tT),
    top: tT,
    mid_downswing: firstCrossing(leadArmZ, tT + 1e-6, tI),
    impact: tI,
    mid_follow_through: firstCrossing((t) => sigmaOf(t) + 90, tI + 1e-6, tF),
    finish: tF,
  };

  // ---- ground-truth metrics (definitions: docs/metrics-by-view.md) ----
  const mid = (t, a, b) => { const A = lm(t, a); const Bv = lm(t, b); return scale3(add3(A, Bv), 0.5); };
  const head = (t) => mid(t, 7, 8);
  const pel = (t) => mid(t, 23, 24);
  const handsMid = (t) => mid(t, 15, 16);
  const az = (t, a, b) => { const A = lm(t, a); const Bv = lm(t, b); return Math.atan2(A[1] - Bv[1], A[0] - Bv[0]); };
  const turn = (a, b) => -wrapPi(az(tT, a, b) - az(tA, a, b)) * RAD2DEG;
  const hA = head(tA);
  const sv = sub3(mid(tA, 11, 12), pel(tA));
  const ha = handsMid(tA);
  const ht = handsMid(tT);
  const sd = shaftDir(tT);
  const shoulder = turn(11, 12);
  const hip = turn(23, 24);
  const metrics = {
    backswing_s: tT - tA,
    downswing_s: tI - tT,
    tempo_ratio: (tT - tA) / (tI - tT),
    head_sway_x_m: head(tT)[0] - hA[0],
    head_lift_z_m: head(tI)[2] - hA[2],
    head_depth_y_m: -(head(tI)[1] - hA[1]),
    spine_forward_tilt_deg: Math.atan2(-sv[1], sv[2]) * RAD2DEG,
    spine_side_tilt_deg: Math.atan2(-sv[0], sv[2]) * RAD2DEG,
    shoulder_turn_deg: shoulder,
    hip_turn_deg: hip,
    x_factor_deg: shoulder - hip,
    hand_plane_dev_m: (ht[2] * ha[1] - ht[1] * ha[2]) / Math.hypot(ha[1], ha[2]),
    top_shaft_angle_deg: Math.atan2(-sd[1], sd[0]) * RAD2DEG,
    weight_shift_pct: (100 * (pel(tI)[0] - pel(tA)[0])) / Math.abs(lm(tA, 27)[0] - lm(tA, 28)[0]),
    early_extension_m: -(pel(tI)[1] - pel(tA)[1]),
  };
  return {
    params: P, landmarks, hands, clubHead, shaftDir, p: pOf, sigma: sigmaOf,
    times: { tA, tT, tI, tF, tEnd, B, D, F },
    truth: { events, metrics },
  };
}

/** Camera of the mirrored setup (scene mirrored through y = 0): R' = S R M, t' = S t, S = diag(-1,1,1), M = diag(1,-1,1). */
export function mirrorCamera(cam) {
  const R = cam.R;
  const R2 = [-R[0], R[1], -R[2], R[3], -R[4], R[5], R[6], -R[7], R[8]];
  return makeCamera({ W: cam.W, H: cam.H, f: cam.f, k1: cam.k1, R: R2, t: [-cam.t[0], cam.t[1], cam.t[2]], readout: cam.readout });
}

function perturbCamera(cam, view, rng, sAng_deg, sPos_m, sF_rel) {
  const e = eulerFromR(cam.R, view);
  const R = rFromEuler({
    yaw: e.yaw + gauss(rng, 0, sAng_deg * DEG),
    pitch: e.pitch + gauss(rng, 0, sAng_deg * DEG),
    roll: e.roll + gauss(rng, 0, sAng_deg * DEG),
  }, view);
  const C = center(cam).map((c) => c + gauss(rng, 0, sPos_m));
  return makeCamera({ W: cam.W, H: cam.H, f: cam.f * (1 + gauss(rng, 0, sF_rel)), k1: cam.k1, R, C, readout: cam.readout });
}

function baseVisibility(view, j) {
  if (view === 'face_on') return j <= 10 ? 0.9 : 0.95;
  const leadSide = [11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31];
  if (j <= 6 || j === 9 || j === 10) return 0.5;
  if (j === 7) return 0.55;
  if (j === 8) return 0.85;
  return leadSide.includes(j) ? 0.7 : 0.92;
}

/**
 * One synthetic swing seen from a view. opts: { seed = 1, view = 'face_on', fps = 60, handedness = 'right',
 *   params? (overrides), noisePx = 2.0, arPx = 1.0, arRho = 0.85, blurK = 0.1, blurCapPx = 10, outPx = 15,
 *   worldNoise_m = 0.03, worldBias_m = 0.015, camJitter = true, calibSigma_deg = 0.15, calibSigma_m = 0.01,
 *   tsJitter_s = 0, W?, H?, cameraOpts? }.
 * Returns { poseSeq, truth: { events: {name: {t_s, frame}}, metrics }, camera (true), calibration (estimated),
 *   audioOnset_t, clubObs, model, view, fps, handedness, params }.
 */
export function synthSwing(opts = {}) {
  const seed = opts.seed ?? 1;
  const view = opts.view ?? 'face_on';
  const fps = opts.fps ?? 60;
  const handedness = opts.handedness ?? 'right';
  const rng = mulberry32(seed * 7919 + 17);
  const params = swingParams(rng, opts.params ?? {});
  const model = buildSwingModel(params);
  const nrng = mulberry32(seed * 104729 + 3);

  // true camera: nominal view geometry with setup-tolerance jitter
  const camOpts = { ...(opts.cameraOpts ?? {}) };
  if (opts.W) camOpts.W = opts.W;
  if (opts.H) camOpts.H = opts.H;
  if (opts.camJitter !== false) {
    camOpts.yaw = (camOpts.yaw ?? 0) + gauss(nrng, 0, 0.5 * DEG);
    camOpts.pitch = (camOpts.pitch ?? 0) + gauss(nrng, 0, 0.5 * DEG);
    camOpts.roll = (camOpts.roll ?? 0) + gauss(nrng, 0, 0.3 * DEG);
  }
  const camRH = nominalCamera(view, camOpts);
  const calRH = perturbCamera(camRH, view, nrng, opts.calibSigma_deg ?? 0.15, opts.calibSigma_m ?? 0.01, 0.003);
  const { W, H } = camRH;

  const N = Math.floor(model.times.tEnd * fps) + 1;
  const t_s = new Float64Array(N);
  const jit = opts.tsJitter_s ?? 0;
  for (let i = 0; i < N; i++) t_s[i] = i / fps + (jit ? uniform(nrng, -jit, jit) : 0);
  if (jit) t_s.sort();

  // noise-free projections (RH scene, RH camera)
  const uv = new Float64Array(N * 33 * 2);
  const zc = new Float64Array(N * 33);
  const world = new Float32Array(N * 99);
  const L3 = [];
  for (let i = 0; i < N; i++) {
    const L = model.landmarks(t_s[i]);
    L3.push(L);
    for (let j = 0; j < 33; j++) {
      const X = [L[3 * j], L[3 * j + 1], L[3 * j + 2]];
      const pr = project(camRH, X);
      uv[(i * 33 + j) * 2] = pr.u;
      uv[(i * 33 + j) * 2 + 1] = pr.v;
      zc[i * 33 + j] = pr.z;
    }
  }
  const sPx = opts.noisePx ?? 2.0;
  const sAr = opts.arPx ?? 1.0;
  const rho = opts.arRho ?? 0.85;
  const blurK = opts.blurK ?? 0.1;
  const blurCap = opts.blurCapPx ?? 10;
  const outPx = opts.outPx ?? 15;
  const sW = opts.worldNoise_m ?? 0.03;
  const bias = Array.from({ length: 99 }, () => gauss(nrng, 0, opts.worldBias_m ?? 0.015));
  const ar = new Float64Array(66);
  const img = new Float32Array(N * 132);
  for (let i = 0; i < N; i++) {
    const L = L3[i];
    const Pm = [(L[69] + L[72]) / 2, (L[70] + L[73]) / 2, (L[71] + L[74]) / 2];
    const zHip = toCamera(camRH, Pm)[2];
    for (let j = 0; j < 33; j++) {
      const o = (i * 33 + j) * 2;
      let u = uv[o];
      let v = uv[o + 1];
      const inside = u >= 0 && u <= W && v >= 0 && v <= H;
      let s = sPx;
      if (i > 0) {
        const dd = Math.hypot(u - uv[o - 66], v - uv[o - 65]);
        s = Math.hypot(s, Math.min(blurCap, blurK * dd));
      }
      if (!inside) s = Math.hypot(s, outPx);
      ar[2 * j] = rho * ar[2 * j] + Math.sqrt(1 - rho * rho) * gauss(nrng, 0, sAr);
      ar[2 * j + 1] = rho * ar[2 * j + 1] + Math.sqrt(1 - rho * rho) * gauss(nrng, 0, sAr);
      u += gauss(nrng, 0, s) + ar[2 * j];
      v += gauss(nrng, 0, s) + ar[2 * j + 1];
      let vis = inside ? baseVisibility(view, j) + uniform(nrng, -0.05, 0.05) : uniform(nrng, 0.02, 0.15);
      vis = Math.min(1, Math.max(0, vis));
      const q = (i * 33 + j) * 4;
      img[q] = u / W;
      img[q + 1] = v / H;
      img[q + 2] = ((zc[i * 33 + j] - zHip) * camRH.f) / (zHip * W);
      img[q + 3] = vis;
      // MediaPipe-style world landmark: camera-aligned axes (x right, y down, z away), origin mid-hip
      const Xc = toCamera(camRH, [L[3 * j] - Pm[0], L[3 * j + 1] - Pm[1], L[3 * j + 2] - Pm[2]]);
      const Oc = toCamera(camRH, [0, 0, 0]);
      for (let c = 0; c < 3; c++) world[i * 99 + 3 * j + c] = Xc[c] - Oc[c] + bias[3 * j + c] + gauss(nrng, 0, sW);
    }
  }
  // club head observations (track module stand-in), 2 px noise
  const clubObs = [];
  for (let i = 0; i < N; i++) {
    const pr = project(camRH, model.clubHead(t_s[i]));
    if (pr.u >= 0 && pr.u <= W && pr.v >= 0 && pr.v <= H) {
      clubObs.push({ frame: i, t_s: t_s[i], u: pr.u + gauss(nrng, 0, 2), v: pr.v + gauss(nrng, 0, 2), conf: 0.9 });
    }
  }

  let camera = camRH;
  let calCam = calRH;
  if (handedness === 'left') {
    mirrorPoseArrays(img, world, N);
    camera = mirrorCamera(camRH);
    calCam = mirrorCamera(calRH);
    for (const o of clubObs) o.u = W - o.u;
  }
  const calibration = {
    method: 'mat_pnp', source: 'clip', f_px: calCam.f, f_locked: true, pose: poseReport(calCam, view),
    pose_sigma: { yaw_deg: 0.15, pitch_deg: 0.15, roll_deg: 0.15, X_m: 0.01, Y_m: 0.01, h_m: 0.01, D_m: 0.01 },
    reproj_rmse_px: 1.0, slope_deg: 0, preset_dev: null, readout_ms: 3.0, readout_source: 'assumed', camera: calCam,
  };
  const frameOf = (t) => {
    let best = 0;
    for (let i = 1; i < N; i++) if (Math.abs(t_s[i] - t) < Math.abs(t_s[best] - t)) best = i;
    return best;
  };
  const events = {};
  for (const name of EVENT_NAMES) {
    const t = model.truth.events[name];
    events[name] = t === null ? null : { t_s: t, frame: frameOf(t) };
  }
  return {
    poseSeq: { t_s, img, world, W, H, model: 'synthetic' },
    truth: { events, metrics: { ...model.truth.metrics } },
    camera, calibration, audioOnset_t: model.times.tI + gauss(nrng, 0, 0.002), clubObs, model,
    view, fps, handedness, params,
  };
}

/** Mirror PoseSeq arrays in place: x_norm -> 1 - x_norm, world x -> -x, swap left/right landmarks. */
export function mirrorPoseArrays(img, world, N) {
  const tmpI = new Float32Array(132);
  const tmpW = new Float32Array(99);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 33; j++) {
      const s = SWAP[j];
      tmpI[4 * j] = 1 - img[i * 132 + 4 * s];
      tmpI[4 * j + 1] = img[i * 132 + 4 * s + 1];
      tmpI[4 * j + 2] = img[i * 132 + 4 * s + 2];
      tmpI[4 * j + 3] = img[i * 132 + 4 * s + 3];
      if (world) {
        tmpW[3 * j] = -world[i * 99 + 3 * s];
        tmpW[3 * j + 1] = world[i * 99 + 3 * s + 1];
        tmpW[3 * j + 2] = world[i * 99 + 3 * s + 2];
      }
    }
    img.set(tmpI, i * 132);
    if (world) world.set(tmpW, i * 99);
  }
}

// ------------------------------------------------------------------------------------------ live (P4) streams

function practiceParams(P, rng) {
  const A = uniform(rng, 0.45, 0.7);
  const k = P.stature / 1.75;
  const zh0 = 0.74 * k;
  return {
    ...P,
    handsTopX: A * P.handsTopX, handsTopY: A * P.handsTopY, handsTopZ: zh0 + A * (P.handsTopZ - zh0),
    handsFinX: A * P.handsFinX, handsFinY: A * P.handsFinY, handsFinZ: zh0 + A * (P.handsFinZ - zh0),
    backswing_s: P.backswing_s * uniform(rng, 1.2, 1.5), tempo: uniform(rng, 1.4, 2.0), pFin: -A, hold_s: 0.9,
  };
}

/**
 * A live-mode session as the P4 state machine sees it: 10 Hz wrist samples in the body plane
 * ({ type: 'wrist', t_s, x_m (along target), y_m (up), vis }) and audio onsets ({ type: 'audio', t_s }).
 * opts: { seed = 1, nReal = 10, nPractice = 5, nNeighbour = 10, nMissingAudio = 1, hz = 10, noise_m = 0.005 }.
 * truth: { real: [{ t_address, t_impact, t_finish, audio }], practice: [{ t_start, t_end }], neighbour: [t_s] }.
 */
export function synthLiveSession(opts = {}) {
  const rng = mulberry32((opts.seed ?? 1) * 31337 + 5);
  const hz = opts.hz ?? 10;
  const noise = opts.noise_m ?? 0.005;
  const nReal = opts.nReal ?? 10;
  const nPractice = opts.nPractice ?? 5;
  const nNeighbour = opts.nNeighbour ?? 10;
  const nMissing = opts.nMissingAudio ?? 1;
  const items = [];
  for (let i = 0; i < nReal; i++) items.push({ kind: 'real', audio: i >= nMissing });
  for (let i = 0; i < nPractice; i++) items.push({ kind: 'practice' });
  for (let i = 0; i < nNeighbour; i++) items.push({ kind: 'neighbour' });
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const segs = []; // { t0, t1, pos(t) -> [x, z] }
  const audio = [];
  const truth = { real: [], practice: [], neighbour: [] };
  let t = 0;
  let pos = [0.4, 0.9];
  const restPos = () => [uniform(rng, 0.2, 0.6), uniform(rng, 0.85, 1.0)];
  const moveTo = (target, speed) => {
    const from = pos.slice();
    const dist = Math.hypot(target[0] - from[0], target[1] - from[1]);
    const dur = Math.max(0.3, (1.5 * dist) / speed);
    const t0 = t;
    segs.push({ t0, t1: t0 + dur, pos: (tt) => { const s = smooth((tt - t0) / dur); return [from[0] + (target[0] - from[0]) * s, from[1] + (target[1] - from[1]) * s]; } });
    t += dur;
    pos = target.slice();
  };
  const fidget = (dur) => {
    // slow wandering hands (0.1-0.5 m/s), never still for long
    const n = Math.max(1, Math.round(dur / 0.8));
    for (let i = 0; i < n; i++) {
      const tgt = [pos[0] + uniform(rng, -0.25, 0.25), Math.min(1.2, Math.max(0.6, pos[1] + uniform(rng, -0.2, 0.2)))];
      moveTo(tgt, uniform(rng, 0.25, 0.6));
    }
  };
  const hold = (dur) => {
    const p0 = pos.slice();
    const t0 = t;
    segs.push({ t0, t1: t0 + dur, pos: () => p0 });
    t += dur;
  };
  for (const it of items) {
    fidget(uniform(rng, 2.5, 5));
    if (it.kind === 'neighbour') {
      const standStill = rng() < 0.5;
      const t0 = t;
      if (standStill) hold(uniform(rng, 2.0, 4.0)); else fidget(uniform(rng, 2.0, 4.0));
      const ta = uniform(rng, t0 + 0.5, t - 0.5);
      audio.push(ta);
      truth.neighbour.push(ta);
      continue;
    }
    const P = swingParams(rng);
    const Pm = it.kind === 'practice' ? practiceParams(P, rng) : P;
    const model = buildSwingModel(Pm);
    const h0 = model.hands(0);
    moveTo([h0[0], h0[2]], uniform(rng, 0.4, 0.7));
    // the model's own still address period is t in [0, tA]; prepend extra stillness
    hold(uniform(rng, 0.4, 1.5));
    const t0 = t;
    const dur = model.times.tEnd;
    segs.push({ t0, t1: t0 + dur, pos: (tt) => { const h = model.hands(tt - t0); return [h[0], h[2]]; } });
    t += dur;
    const hEnd = model.hands(dur);
    pos = [hEnd[0], hEnd[2]];
    if (it.kind === 'real') {
      const ti = t0 + model.times.tI;
      if (it.audio) audio.push(ti + gauss(rng, 0, 0.003));
      truth.real.push({ t_address: t0 + model.times.tA, t_impact: ti, t_finish: t0 + model.times.tF, audio: it.audio });
    } else {
      truth.practice.push({ t_start: t0 + model.times.tA, t_end: t0 + model.times.tF });
    }
    moveTo(restPos(), uniform(rng, 0.5, 0.8));
  }
  fidget(3);
  const samples = [];
  const phase = rng() / hz;
  let si = 0;
  for (let ts = phase; ts < t; ts += 1 / hz) {
    while (si < segs.length - 1 && segs[si].t1 < ts) si++;
    const p = segs[si].pos(Math.min(ts, segs[si].t1));
    samples.push({ type: 'wrist', t_s: ts, x_m: p[0] + gauss(rng, 0, noise), y_m: p[1] + gauss(rng, 0, noise), vis: 0.9 });
  }
  for (const ta of audio) samples.push({ type: 'audio', t_s: ta });
  samples.sort((a, b) => a.t_s - b.t_s || (a.type === 'audio' ? 1 : -1));
  return { samples, truth, duration_s: t };
}

// ------------------------------------------------------------------------------------------------ stress modes
// PRODUCT-SPEC §7.3: the synthetic stress suite of the rule-based events (3 views × 8 modes × 40 seeds, 60 / 240 Hz).
// Each mode models one pre-shot routine or capture artefact on top of synthSwing; the ground truth stays the swing's
// own event times (mapped to media time for slowmo_x8).

export const STRESS_MODES = Object.freeze(['baseline', 'waggle', 'forward_press', 'short_tail', 'finish_relax',
  'impact_dropout', 'slowmo_x8', 'low_visibility']);
/**
 * Extra modes used only to fit and check the confidence calibration (§7.2 EV-4): clips where the rules are expected
 * to fail sometimes, so the calibration sees negative examples. Not part of the §7.3 detection gates.
 */
export const CALIB_EXTRA_MODES = Object.freeze(['late_start', 'heavy_noise', 'occluded_hands', 'early_end']);
const HANDS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
/** Slow-motion factor baked into a slowmo_x8 export. */
export const SLOWMO_FACTOR = 8;

function torsoPx(img, i, W, H) {
  const q = i * 132;
  const sx = ((img[q + 44] + img[q + 48]) / 2) * W;
  const sy = ((img[q + 45] + img[q + 49]) / 2) * H;
  const hx = ((img[q + 92] + img[q + 96]) / 2) * W;
  const hy = ((img[q + 93] + img[q + 97]) / 2) * H;
  return Math.hypot(sx - hx, sy - hy);
}

function slicePose(p, keep) {
  const n = keep.length;
  const t_s = new Float64Array(n);
  const img = new Float32Array(n * 132);
  const world = new Float32Array(n * 99);
  keep.forEach((i, m) => {
    t_s[m] = p.t_s[i];
    img.set(p.img.subarray(i * 132, (i + 1) * 132), m * 132);
    world.set(p.world.subarray(i * 99, (i + 1) * 99), m * 99);
  });
  return { ...p, t_s, img, world };
}

/**
 * stressSwing({ seed, view, fps = 60, mode, handedness? }) -> { poseSeq, truth: { events: {name: {t_s}} } (media
 *   time), toReal(t_media) -> s, time_scale (1 | 8), container_fps, duration_s, audioOnset_t (media), swing }
 * fps is the real (capture) rate. Modes:
 *   baseline        synthSwing unchanged
 *   waggle          2.0-2.6 s address hold; hands oscillate ±0.15 torso (image x) at 2 Hz for 1.0 s, ending 0.4 s
 *                   before the takeaway
 *   forward_press   hands drift 0.08 torso along image −x (mirrored for left-handed) over the 0.25 s before the takeaway, released
 *                   over the first 0.2 s of the backswing
 *   short_tail      the clip ends 0.4 s after the finish (no hold: the user stops recording / walks off)
 *   finish_relax    0.3 s after the finish the hands drop 0.5 torso over 0.6 s (the golfer relaxes the pose)
 *   impact_dropout  lead wrist / hand landmarks lost (vis 0.2, ±0.5 % jitter) for ±50 ms around impact
 *   slowmo_x8       iPhone slow motion exported with the 1/8 speed baked in: the capture at fps, the container at
 *                   fps / 8; real time is stretched ×8 from 0.3 s before the takeaway on (the start stays at normal
 *                   speed, as in the Photos speed ramp)
 *   low_visibility  every visibility ×0.6 and +3 px extra position noise (dim bay, baggy clothes)
 */
export function stressSwing({ seed = 1, view = 'face_on', fps = 60, mode = 'baseline', handedness = 'right' } = {}) {
  if (!STRESS_MODES.includes(mode) && !CALIB_EXTRA_MODES.includes(mode)) throw new RangeError(`stressSwing: unknown mode ${mode}`);
  const params = mode === 'waggle' ? { t_address: 2.0 + 0.6 * ((seed * 0.6180339887) % 1) } : undefined;
  const s = synthSwing({ seed, view, fps, handedness, params });
  const W = s.poseSeq.W;
  const H = s.poseSeq.H;
  const p = { ...s.poseSeq, t_s: Float64Array.from(s.poseSeq.t_s), img: Float32Array.from(s.poseSeq.img), world: Float32Array.from(s.poseSeq.world) };
  const tA = s.truth.events.address.t_s;
  const tI = s.truth.events.impact.t_s;
  const tF = s.truth.events.finish.t_s;
  const L = torsoPx(p.img, 0, W, H);
  const N = p.t_s.length;
  const sgn = handedness === 'left' ? -1 : 1;
  let out = p;
  let toReal = (t) => t;
  let toMedia = (t) => t;
  let scale = 1;
  let container = fps;
  switch (mode) {
    case 'waggle':
      for (let i = 0; i < N; i++) {
        const t = p.t_s[i];
        if (t > tA - 1.4 && t < tA - 0.4) {
          const d = (0.15 * L * Math.sin(2 * Math.PI * 2 * (t - (tA - 1.4)))) / W;
          for (const j of HANDS) p.img[i * 132 + j * 4] += d;
        }
      }
      break;
    case 'forward_press':
      for (let i = 0; i < N; i++) {
        const t = p.t_s[i];
        const w = t < tA - 0.25 ? 0 : t < tA ? (t - (tA - 0.25)) / 0.25 : Math.max(0, 1 - (t - tA) / 0.2);
        for (const j of HANDS) p.img[i * 132 + j * 4] -= (sgn * 0.08 * L * w) / W;
      }
      break;
    case 'short_tail': {
      const n = Array.prototype.findIndex.call(p.t_s, (t) => t > tF + 0.4);
      if (n > 0) out = slicePose(p, Array.from({ length: n }, (_, i) => i));
      break;
    }
    case 'finish_relax':
      for (let i = 0; i < N; i++) {
        const t = p.t_s[i];
        const w = t < tF + 0.3 ? 0 : Math.min(1, (t - tF - 0.3) / 0.6);
        for (const j of HANDS) p.img[i * 132 + j * 4 + 1] += (0.5 * L * w) / H;
      }
      break;
    case 'impact_dropout': {
      const lead = handedness === 'left' ? [16, 18, 20, 22] : [15, 17, 19, 21];
      for (let i = 0; i < N; i++) {
        if (Math.abs(p.t_s[i] - tI) > 0.05) continue;
        for (const j of lead) {
          p.img[i * 132 + j * 4 + 3] = 0.2;
          p.img[i * 132 + j * 4] += Math.sin(i * 12.9898) * 0.5 * 0.01;
          p.img[i * 132 + j * 4 + 1] += Math.cos(i * 78.233) * 0.5 * 0.01;
        }
      }
      break;
    }
    case 'low_visibility': {
      const rng = mulberry32(seed * 31337 + 11);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < 33; j++) {
          const q = i * 132 + j * 4;
          p.img[q] += gauss(rng, 0, 3) / W;
          p.img[q + 1] += gauss(rng, 0, 3) / H;
          p.img[q + 3] *= 0.6;
        }
      }
      break;
    }
    case 'late_start': {
      // recording started 0.05–0.35 s before the takeaway: no address hold in the clip
      const lead = 0.05 + 0.3 * ((seed * 0.7548776662) % 1);
      const keep = [];
      for (let i = 0; i < N; i++) if (p.t_s[i] >= tA - lead) keep.push(i);
      out = slicePose(p, keep);
      break;
    }
    case 'early_end': {
      // recording stopped 0.0–0.25 s after the finish (or just before it)
      const tail = -0.1 + 0.35 * ((seed * 0.5698402910) % 1);
      const n = Array.prototype.findIndex.call(p.t_s, (t) => t > tF + tail);
      if (n > 0) out = slicePose(p, Array.from({ length: n }, (_, i) => i));
      break;
    }
    case 'heavy_noise': {
      const rng = mulberry32(seed * 7331 + 5);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < 33; j++) {
          const q = i * 132 + j * 4;
          p.img[q] += gauss(rng, 0, 9) / W;
          p.img[q + 1] += gauss(rng, 0, 9) / H;
          p.img[q + 3] *= 0.45;
        }
      }
      break;
    }
    case 'occluded_hands': {
      // the lead arm hidden behind the body from address to top (vis 0.15, ±1.5 % jitter)
      const lead = handedness === 'left' ? [14, 16, 18, 20, 22] : [13, 15, 17, 19, 21];
      const tT = s.truth.events.top.t_s;
      for (let i = 0; i < N; i++) {
        if (p.t_s[i] < tA - 0.2 || p.t_s[i] > tT + 0.1) continue;
        for (const j of lead) {
          p.img[i * 132 + j * 4 + 3] = 0.15;
          p.img[i * 132 + j * 4] += Math.sin(i * 4.1 + j) * 0.015;
          p.img[i * 132 + j * 4 + 1] += Math.cos(i * 3.3 + j) * 0.015;
        }
      }
      break;
    }
    case 'slowmo_x8': {
      const k = SLOWMO_FACTOR;
      const t0 = tA - 0.3;
      scale = k;
      container = fps / k;
      // before t0 the export runs at normal speed: every k-th capture frame; after t0 every frame, stretched ×k
      const keep = [];
      for (let i = 0; i < N; i++) if (p.t_s[i] > t0 || i % k === 0) keep.push(i);
      out = slicePose(p, keep);
      toMedia = (t) => (t > t0 ? t0 + k * (t - t0) : t);
      toReal = (t) => (t > t0 ? t0 + (t - t0) / k : t);
      for (let m = 0; m < out.t_s.length; m++) out.t_s[m] = toMedia(out.t_s[m]);
      break;
    }
    default: break;
  }
  const events = {};
  for (const name of EVENT_NAMES) {
    const e = s.truth.events[name];
    events[name] = e ? { t_s: toMedia(e.t_s) } : null;
  }
  const ts = out.t_s;
  return {
    poseSeq: out, truth: { events, metrics: s.truth.metrics }, toReal, time_scale: scale, container_fps: container,
    duration_s: ts.length ? ts[ts.length - 1] - ts[0] : 0, audioOnset_t: toMedia(s.audioOnset_t), swing: s, mode,
  };
}

/** §7.3 tolerances in real seconds: 2 frames at 60 Hz for address / top / impact, 4 frames for finish. */
export const STRESS_TOL = Object.freeze({ address: 2 / 60, top: 2 / 60, impact: 2 / 60, finish: 4 / 60, tempo: 0.3 });
const STRESS_KEY = ['address', 'top', 'impact', 'finish'];

/**
 * scoreStress(detect, { views, modes, rates, seeds = 40 }) -> rows [{ view, mode, fps, n, found, address, top,
 *   impact, finish, tempo }] (rates are shares of all seeds; errors in real seconds after toReal()).
 * detect(stress) -> EventSet in media time (the caller adds time-scale handling, audio, ...).
 */
export function scoreStress(detect, { views = ['face_on', 'dtl', 'high_behind'], modes = STRESS_MODES, rates = [60, 240], seeds = 40 } = {}) {
  const rows = [];
  for (const view of views) for (const mode of modes) for (const fps of rates) {
    const ok = { found: 0, address: 0, top: 0, impact: 0, finish: 0, tempo: 0 };
    const err = Object.fromEntries(STRESS_KEY.map((e) => [e, []]));
    for (let seed = 1; seed <= seeds; seed++) {
      const st = stressSwing({ seed, view, fps, mode, handedness: seed % 4 === 0 ? 'left' : 'right' });
      const ev = detect(st);
      if (!ev || !ev.impact || !Number.isFinite(ev.impact.t_s)) continue;
      ok.found++;
      const T = st.truth.events;
      for (const e of STRESS_KEY) {
        const d = st.toReal(ev[e].t_s) - st.toReal(T[e].t_s);
        err[e].push(d);
        if (Math.abs(d) <= STRESS_TOL[e] + 1e-9) ok[e]++;
      }
      const r = (x) => st.toReal(x);
      const tt = (r(T.top.t_s) - r(T.address.t_s)) / (r(T.impact.t_s) - r(T.top.t_s));
      const tp = (r(ev.top.t_s) - r(ev.address.t_s)) / (r(ev.impact.t_s) - r(ev.top.t_s));
      if (Math.abs(tp - tt) <= STRESS_TOL.tempo) ok.tempo++;
    }
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
    const row = { view, mode, fps, n: seeds };
    for (const [k, v] of Object.entries(ok)) row[k] = v / seeds;
    row.median_ms = Object.fromEntries(STRESS_KEY.map((e) => [e, Math.round(1000 * med(err[e]))]));
    rows.push(row);
  }
  return rows;
}

export function formatStressRow(r) {
  const pct = (x) => `${(100 * x).toFixed(0)}%`.padStart(4);
  return `${r.view.padEnd(11)} ${r.mode.padEnd(14)} ${String(r.fps).padStart(3)} Hz  found ${pct(r.found)}  address ${pct(r.address)}  `
    + `top ${pct(r.top)}  impact ${pct(r.impact)}  finish ${pct(r.finish)}  tempo ${pct(r.tempo)}  med ms ${JSON.stringify(r.median_ms)}`;
}
