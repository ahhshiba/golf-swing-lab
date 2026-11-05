"""Owner labels (golf-swing-lab-labels/1, docs/training.md) -> evfeat-1 training examples (PRODUCT-SPEC §7.4).

No GolfDB data: the swings come from the owner's teach-mode export; the session-wise split uses the same FNV-1a
session order as scripts/eval_owner_set.mjs (splitBySession).
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

from features import FEATURE_HZ, compute_features

LABELS_FORMAT = "golf-swing-lab-labels/1"
EVENTS = ("address", "toe_up", "mid_backswing", "top", "mid_downswing", "impact", "mid_follow_through", "finish")


def fnv1a(s: str) -> int:
    """32-bit FNV-1a over the code points of s (scripts/eval_owner_set.mjs fnv1a)."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def decode_pose(p: dict):
    """(t_s (T,), img (T, 33, 4) float32, W, H) of a labels/1 swing pose."""
    t_s = np.asarray(p["t_s"], dtype=np.float64)
    if isinstance(p.get("img_f32"), str):
        img = np.frombuffer(base64.b64decode(p["img_f32"]), dtype="<f4").astype(np.float32)
    elif isinstance(p.get("img_u16"), str):
        lo, hi = p["q"]
        u = np.frombuffer(base64.b64decode(p["img_u16"]), dtype="<u2").astype(np.float64)
        img = (lo + u / 65535.0 * (hi - lo)).astype(np.float32)
    else:
        raise ValueError("pose has neither img_f32 nor img_u16")
    if img.size != len(t_s) * 132:
        raise ValueError("pose size mismatch")
    return t_s, img.reshape(len(t_s), 33, 4), p["W"], p["H"]


def load_labels(paths):
    """All swings of one or more labels/1 files (later files win on a repeated shot_id)."""
    swings = {}
    for path in paths:
        d = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        if d.get("format") != LABELS_FORMAT:
            raise ValueError(f"{path}: not a {LABELS_FORMAT} file")
        for sw in d.get("swings", []):
            swings[sw["shot_id"]] = sw
    return list(swings.values())


def split_sessions(swings, holdout_frac: float = 0.5):
    """(train_ids, holdout_ids): sessions in FNV-1a order; the first ones train while they stay within
    1 - holdout_frac of the swings, the rest is the holdout (never seen in training)."""
    by = {}
    for sw in swings:
        by.setdefault(sw.get("session_id", "unknown"), []).append(sw["shot_id"])
    order = sorted(by, key=lambda s: (fnv1a(s), s))
    train, hold, n = [], [], 0
    for s in order:
        ids = by[s]
        if not hold and n + len(ids) <= (1 - holdout_frac) * len(swings):
            train += ids
            n += len(ids)
        else:
            hold += ids
    return train, hold


def example(sw: dict):
    """Features + labels of one swing on its real time line (time_scale corrected)."""
    t_s, img, W, H = decode_pose(sw["pose"])
    k = float(sw.get("time_scale", 1) or 1)
    t_s = t_s / k
    f = compute_features(t_s, img, W, H, sw.get("handedness", "right"))
    t_ev = np.array([sw["label"]["events"][e]["t_s"] / k for e in EVENTS])
    t_grid = f["t_s"]
    ev_idx = np.clip(np.round((t_ev - t_grid[0]) * FEATURE_HZ).astype(np.int64), 0, len(t_grid) - 1)
    return {"id": sw["shot_id"], "session_id": sw.get("session_id"), "view": sw.get("view"),
            "x": f["data"].astype(np.float32), "t_grid": t_grid, "t_events": t_ev, "ev_idx": ev_idx}
