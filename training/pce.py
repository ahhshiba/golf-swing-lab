"""Ordered event decoding (port of app/src/events/detect.js decodeOrdered) and GolfDB PCE.

PCE follows training/vendor/golfdb/util.py correct_preds + eval.py exactly, on the ORIGINAL clip frame grid:
  labels  = per-frame labels built like vendor dataloader.py (frame events[1:-1][c] -> class c, first match wins,
            all other frames 8), with events = annotation events - events[0];
  events  = np.where(labels < 8)[0]  (sorted frame positions; event i is compared with the i-th sorted position);
  tol     = int(max(np.round((events[5] - events[0]) / 30), 1));
  correct = |events - preds| <= tol, PCE = mean over clips of the per-clip mean (np.mean of the (N, 8) array).
The only difference to eval.py is where `preds` come from: eval.py takes the per-class argmax of the SwingNet
probabilities; here preds are given (ordered decode of the TCN, or the rules), mapped back to original frames.
"""
from __future__ import annotations

import math

import numpy as np

EVENTS = ("address", "toe_up", "mid_backswing", "top", "mid_downswing", "impact", "mid_follow_through", "finish")
N_EVENTS = 8
BACKGROUND = 8


def decode_ordered(probs, C: int = 9, eps: float = 1e-9):
    """JS decodeOrdered: maximise sum_e log(p[f_e][e] + eps) with f_0 <= ... <= f_7. probs (T, >=8) or flat."""
    p = np.asarray(probs, dtype=np.float64)
    if p.ndim == 1:
        p = p.reshape(-1, C)
    T = p.shape[0]
    if T < 1:
        raise ValueError("decode_ordered: no frames")
    lp = np.log(np.maximum(0.0, p[:, :N_EVENTS]) + eps)
    prev = lp[:, 0].copy()
    back = np.zeros((N_EVENTS, T), dtype=np.int64)
    for e in range(1, N_EVENTS):
        # prefix maximum with the earliest index on ties (JS uses a strict '>')
        best_v = -math.inf
        best_t = 0
        score = np.empty(T)
        bt = back[e]
        col = lp[:, e]
        for t in range(T):
            if prev[t] > best_v:
                best_v = prev[t]
                best_t = t
            score[t] = best_v + col[t]
            bt[t] = best_t
        prev = score
    t_end = 0
    for t in range(1, T):
        if prev[t] > prev[t_end]:
            t_end = t
    frames = np.zeros(N_EVENTS, dtype=np.int64)
    frames[-1] = t_end
    for e in range(N_EVENTS - 1, 0, -1):
        frames[e - 1] = back[e][frames[e]]
    return frames, float(prev[t_end])


def golfdb_labels(events_abs, T: int):
    """Per-frame labels exactly as vendor dataloader.py (train=False branch)."""
    ev = np.asarray(events_abs, dtype=np.int64)
    ev = ev - ev[0]
    mid = ev[1:-1]
    labels = np.full(T, BACKGROUND, dtype=np.int64)
    for pos in range(T):
        hit = np.where(mid == pos)[0]
        if len(hit):
            labels[pos] = hit[0]
    return labels


def golfdb_correct(preds, labels, tol: int = -1):
    """util.correct_preds with the predicted frames given instead of argmax(probs). Returns (events, deltas, tol,
    correct uint8 (8,))."""
    events = np.where(np.asarray(labels) < 8)[0]
    preds = np.asarray(preds, dtype=np.float64)
    if tol == -1:
        tol = int(max(np.round((events[5] - events[0]) / 30), 1))
    deltas = np.abs(events - preds)
    correct = (deltas <= tol).astype(np.uint8)
    return events, deltas, tol, correct


def golfdb_correct_argmax(probs, labels, tol: int = -1):
    """Literal port of vendor util.correct_preds (argmax per event class over the clip)."""
    events = np.where(np.asarray(labels) < 8)[0]
    preds = np.zeros(len(events))
    if tol == -1:
        tol = int(max(np.round((events[5] - events[0]) / 30), 1))
    for i in range(len(events)):
        preds[i] = np.argsort(probs[:, i])[-1]
    deltas = np.abs(events - preds)
    correct = (deltas <= tol).astype(np.uint8)
    return events, preds, deltas, tol, correct


def pce_table(correct_rows):
    """correct_rows: list of (8,) 0/1 arrays. Returns dict with per-event PCE, overall, excl. Address/Finish."""
    c = np.asarray(correct_rows, dtype=np.float64)
    if c.size == 0:
        return {"n": 0}
    per = c.mean(axis=0)
    return {
        "n": int(c.shape[0]),
        "per_event": {EVENTS[i]: float(per[i]) for i in range(N_EVENTS)},
        "overall": float(np.mean(c)),
        "excl_address_finish": float(np.mean(c[:, 1:7])),
    }


# M3 gates (CAFCR R2 / R6 M3)
GATES = (
    ("overall", 0.70),
    ("excl_address_finish", 0.88),
    ("impact", 0.95),
    ("top", 0.80),
)
BEAT_RULES_MARGIN = 0.05


def check_gates(tcn: dict, rules: dict | None):
    out = []
    for key, thr in GATES:
        v = tcn[key] if key in tcn else tcn["per_event"][key]
        out.append((key, v, thr, v >= thr))
    if rules is not None:
        d = tcn["overall"] - rules["overall"]
        out.append(("beats_rules_overall", d, BEAT_RULES_MARGIN, d >= BEAT_RULES_MARGIN))
    return out
