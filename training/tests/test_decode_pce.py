"""Ordered decode (port of detect.js decodeOrdered) and GolfDB PCE (port of vendor util.correct_preds / eval.py)."""
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

from pce import (check_gates, decode_ordered, golfdb_correct, golfdb_correct_argmax, golfdb_labels, pce_table)

HERE = Path(__file__).resolve().parent
VENDOR_UTIL = HERE.parents[0] / "vendor" / "golfdb" / "util.py"


@pytest.mark.parametrize("case", json.loads((HERE / "fixtures" / "decode-ordered.json").read_text())["cases"],
                         ids=lambda c: f"T{c['T']}")
def test_decode_matches_js(case):
    frames, score = decode_ordered(np.asarray(case["probs"]), 9)
    assert list(frames) == case["frames"]
    assert abs(score - case["score"]) <= 1e-9 * max(1, abs(case["score"]))
    assert np.all(np.diff(frames) >= 0)


def test_decode_monotone_and_obvious():
    T = 50
    p = np.full((T, 9), 0.01)
    want = [3, 8, 12, 20, 24, 28, 33, 45]
    for e, f in enumerate(want):
        p[f, e] = 0.9
    assert list(decode_ordered(p)[0]) == want
    # reversed preference is forced into order
    p = np.full((T, 9), 0.01)
    for e in range(8):
        p[40 - 5 * e, e] = 0.9
    f = decode_ordered(p)[0]
    assert np.all(np.diff(f) >= 0)


def test_pce_hand_computed():
    # events at 10, 40, 50, 60, 70, 80 (impact), 90, 120 -> tol = round((80 - 10) / 30) = 2
    events_abs = np.array([100, 110, 140, 150, 160, 170, 180, 190, 220, 230])  # events[0] = clip offset 100
    labels = golfdb_labels(events_abs, 131)
    assert list(np.where(labels < 8)[0]) == [10, 40, 50, 60, 70, 80, 90, 120]
    preds = [10, 43, 52, 58, 70, 81, 95, 118]  # deltas 0 3 2 2 0 1 5 2 -> correct 1 0 1 1 1 1 0 1
    ev, deltas, tol, correct = golfdb_correct(preds, labels)
    assert tol == 2
    assert list(correct) == [1, 0, 1, 1, 1, 1, 0, 1]
    tab = pce_table([correct, np.ones(8, np.uint8)])
    assert tab["overall"] == pytest.approx((6 + 8) / 16)
    assert tab["excl_address_finish"] == pytest.approx((4 + 6) / 12)
    assert tab["per_event"]["toe_up"] == 0.5
    # tolerance floor is 1 frame; np.round is banker's rounding (2.5 -> 2), as in GolfDB
    lab2 = golfdb_labels(np.array([0, 0, 2, 4, 6, 8, 10, 12, 14, 16]), 17)
    assert golfdb_correct(np.zeros(8), lab2)[2] == 1
    lab3 = golfdb_labels(np.array([0, 0, 1, 2, 3, 4, 75, 80, 90, 100]), 101)
    assert golfdb_correct(np.zeros(8), lab3)[2] == 2


def _vendor_util():
    spec = importlib.util.spec_from_file_location("golfdb_util_vendor", VENDOR_UTIL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_matches_vendor_correct_preds():
    util = _vendor_util()
    rng = np.random.default_rng(5)
    for _ in range(50):
        T = int(rng.integers(60, 400))
        ev = np.sort(rng.choice(np.arange(1, T - 1), 8, replace=False))
        events_abs = np.concatenate([[0], ev, [T - 1]]) + 37
        labels = golfdb_labels(events_abs, T)
        probs = rng.random((T, 9))
        want = util.correct_preds(probs, labels)
        got = golfdb_correct_argmax(probs, labels)
        for a, b in zip(want, got):
            assert np.array_equal(np.asarray(a), np.asarray(b))
        # given-preds variant == vendor when the preds are the vendor argmax
        g2 = golfdb_correct(want[1], labels)
        assert np.array_equal(g2[3], want[4]) and g2[2] == want[3]


def test_nonmonotonic_labels_like_dataloader():
    # id 677: impact 168 > mid_follow_through 167; the dataloader labels 167 -> 6, 168 -> 5 and correct_preds
    # compares event i with the i-th sorted position
    events_abs = np.array([0, 92, 114, 131, 146, 158, 168, 167, 242, 277]) + 500
    labels = golfdb_labels(events_abs, 278)
    assert labels[167] == 6 and labels[168] == 5
    ev = golfdb_correct(np.zeros(8), labels)[0]
    assert list(ev) == [92, 114, 131, 146, 158, 167, 168, 242]


def test_gates():
    tcn = {"overall": 0.75, "excl_address_finish": 0.9, "per_event": {"impact": 0.96, "top": 0.85}}
    g = check_gates(tcn, {"overall": 0.69})
    assert all(p for *_, p in g)
    g = check_gates(tcn, {"overall": 0.71})
    assert not g[-1][3]
