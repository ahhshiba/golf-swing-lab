"""Event features v1 ('evfeat-1'): exact Python port of app/src/events/features.js computeFeatures.

Definition: docs/metrics-by-view.md section 7 "Event features v1". This port follows the JS operation by operation
(not the numpy one-liners of the doc), so it also matches the JS where numpy would differ:
  - torso median: the JS sorts a Float64Array (NaN sorts last) and takes the middle element(s); numpy.median would
    return NaN as soon as one row is NaN;
  - unwrap: the JS keeps the running correction through NaN rows; numpy.unwrap propagates NaN to every later row;
  - gradient: the JS computes ((y[k+1] - y[k-1]) * hz) / 2 and (y[1] - y[0]) * hz, numpy divides by 2*dx;
  - vis_mean: sequential sum of 8 values then / 8 (numpy.mean would use pairwise/unrolled summation).
Ported results are bit-identical to the JS on the golden fixtures (tests check <= 1e-5 as required, and report the
actual max difference).
"""
from __future__ import annotations

import math

import numpy as np

FEATURE_VERSION = "evfeat-1"
FEATURE_HZ = 30.0
FEATURE_NAMES = (
    "wrist_x", "wrist_y", "wrist_vx", "wrist_vy", "wrist_speed", "lead_wrist_h", "trail_wrist_h",
    "shoulder_angle", "hip_angle", "lead_elbow", "trail_elbow", "vis_mean",
)
N_FEATURES = len(FEATURE_NAMES)
N_LANDMARKS = 33
LR_PAIRS = ((1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16), (17, 18), (19, 20), (21, 22),
            (23, 24), (25, 26), (27, 28), (29, 30), (31, 32))
LR_SWAP = list(range(N_LANDMARKS))
for _a, _b in LR_PAIRS:
    LR_SWAP[_a], LR_SWAP[_b] = _b, _a
LR_SWAP = tuple(LR_SWAP)
VIS_SET = (11, 12, 13, 14, 15, 16, 23, 24)


def grid_size(t_s, hz: float = FEATURE_HZ) -> int:
    T = len(t_s)
    if T == 1:
        return 1
    return int(math.floor((float(t_s[T - 1]) - float(t_s[0])) * hz + 1e-9)) + 1


def resample_pose(t_s, img, hz: float = FEATURE_HZ):
    """JS resamplePose. t_s (T,), img (T,33,4) or flat; returns (t (K,), out (K,33,4)) float64."""
    ts = np.asarray(t_s, dtype=np.float64)
    T = len(ts)
    if T < 1:
        raise ValueError("resample_pose: empty PoseSeq")
    src = np.asarray(img, dtype=np.float32).astype(np.float64).reshape(T, N_LANDMARKS, 4)
    K = grid_size(ts, hz)
    t0 = ts[0]
    # JS: tk = t0 + k / hz (division per k, then addition)
    t = t0 + np.arange(K, dtype=np.float64) / hz
    if T == 1:
        return t, src[:1].copy()
    if np.all(np.diff(ts) > 0):
        # Monotone timestamps: the JS pointer loop ends at the number of ts[1..] below tk, capped at T-2.
        idx = np.minimum(np.searchsorted(ts[1:], t, side="left"), T - 2)
    else:
        idx = np.empty(K, dtype=np.int64)
        i = 0
        for k in range(K):
            while i < T - 2 and ts[i + 1] < t[k]:
                i += 1
            idx[k] = i
    ta = ts[idx]
    tb = ts[idx + 1]
    with np.errstate(invalid="ignore", divide="ignore"):
        w = np.where(tb > ta, (t - ta) / np.where(tb > ta, tb - ta, 1.0), 0.0)
    w = np.where(w < 0, 0.0, w)
    w = np.where(w > 1, 1.0, w)
    a = src[idx]
    b = src[idx + 1]
    out = a + w[:, None, None] * (b - a)
    return t, out


def canonical_pixels(res, W, H, handedness: str = "right"):
    """JS canonicalPixels: (K,33,4) normalised -> pixels [u, v, z, vis]; 'left' mirrors u and swaps L/R pairs."""
    left = handedness == "left"
    src = res[:, list(LR_SWAP), :] if left else res
    out = np.empty_like(src)
    xn = src[:, :, 0]
    out[:, :, 0] = ((1 - xn) if left else xn) * W
    out[:, :, 1] = src[:, :, 1] * H
    out[:, :, 2] = src[:, :, 2]
    out[:, :, 3] = src[:, :, 3]
    return out


def js_gradient(y, hz: float):
    y = np.asarray(y, dtype=np.float64)
    n = len(y)
    g = np.zeros(n)
    if n < 2:
        return g
    g[0] = (y[1] - y[0]) * hz
    g[n - 1] = (y[n - 1] - y[n - 2]) * hz
    if n > 2:
        g[1:-1] = ((y[2:] - y[:-2]) * hz) / 2
    return g


def js_unwrap(p):
    p = np.asarray(p, dtype=np.float64)
    n = len(p)
    if n == 0:
        return p.copy()
    two_pi = 2 * math.pi
    dd = np.diff(p)
    with np.errstate(invalid="ignore"):
        ddmod = np.fmod(np.fmod(dd + math.pi, two_pi) + two_pi, two_pi) - math.pi
        ddmod = np.where((ddmod == -math.pi) & (dd > 0), math.pi, ddmod)
        corr_step = np.where(np.abs(dd) >= math.pi, ddmod - dd, 0.0)
    corr = np.concatenate([[0.0], np.cumsum(corr_step)])
    return p + corr


def js_median(arr):
    s = np.sort(np.asarray(arr, dtype=np.float64))  # NaN last, like Float64Array.prototype.sort
    n = len(s)
    if n == 0:
        return math.nan
    return float(s[(n - 1) >> 1]) if n % 2 else float((s[n // 2 - 1] + s[n // 2]) / 2)


def _joint_angle(u, v, a, b, c):
    ax = u[:, a] - u[:, b]
    ay = v[:, a] - v[:, b]
    cx = u[:, c] - u[:, b]
    cy = v[:, c] - v[:, b]
    return np.arctan2(np.abs(ax * cy - ay * cx), ax * cx + ay * cy)


def compute_features(t_s, img, W, H, handedness: str = "right", hz: float = FEATURE_HZ):
    """JS computeFeatures. Returns dict(t_s (K,), data (K,12) float64, torso_px, K)."""
    t, res = resample_pose(t_s, img, hz)
    px = canonical_pixels(res, W, H, handedness)
    u = px[:, :, 0]
    v = px[:, :, 1]
    vis = px[:, :, 3]
    K = len(t)
    du = (u[:, 11] + u[:, 12]) / 2 - (u[:, 23] + u[:, 24]) / 2
    dv = (v[:, 11] + v[:, 12]) / 2 - (v[:, 23] + v[:, 24]) / 2
    torso = np.sqrt(du * du + dv * dv)
    L = js_median(torso)
    if not (L > 1e-6):
        L = 0.25 * H
    hu = (u[:, 23] + u[:, 24]) / 2
    hv = (v[:, 23] + v[:, 24]) / 2
    wu = (u[:, 15] + u[:, 16]) / 2
    wv = (v[:, 15] + v[:, 16]) / 2
    wx = (wu - hu) / L
    wy = -(wv - hv) / L
    vx = js_gradient(wx, hz)
    vy = js_gradient(wy, hz)
    vs = np.zeros(K)
    for j in VIS_SET:
        vs = vs + vis[:, j]
    data = np.empty((K, N_FEATURES))
    data[:, 0] = wx
    data[:, 1] = wy
    data[:, 2] = vx
    data[:, 3] = vy
    data[:, 4] = np.sqrt(vx * vx + vy * vy)
    data[:, 5] = -(v[:, 15] - hv) / L
    data[:, 6] = -(v[:, 16] - hv) / L
    data[:, 7] = js_unwrap(np.arctan2(-(v[:, 11] - v[:, 12]), u[:, 11] - u[:, 12]))
    data[:, 8] = js_unwrap(np.arctan2(-(v[:, 23] - v[:, 24]), u[:, 23] - u[:, 24]))
    data[:, 9] = _joint_angle(u, v, 11, 13, 15)
    data[:, 10] = _joint_angle(u, v, 12, 14, 16)
    data[:, 11] = vs / len(VIS_SET)
    return {"version": FEATURE_VERSION, "hz": hz, "K": K, "t_s": t, "data": data, "torso_px": L}


def js_nearest_index(t, x: float) -> int:
    """app/src/events/signal.js nearestIndex (ties go to the lower index)."""
    t = np.asarray(t, dtype=np.float64)
    n = len(t)
    if n == 0:
        return -1
    if x <= t[0]:
        return 0
    if x >= t[n - 1]:
        return n - 1
    lo, hi = 0, n - 1
    while hi - lo > 1:
        m = (lo + hi) >> 1
        if t[m] <= x:
            lo = m
        else:
            hi = m
    return lo if x - t[lo] <= t[hi] - x else hi
