#!/usr/bin/env python
"""Check a keypoint cache against the GolfDB annotations; spot-check the wrists around the Impact frame.

Event frames: golfDB.pkl 'events' holds 10 numbers = [clip start, 8 events, clip end] as frame numbers of the
ORIGINAL YouTube video. The 160x160 clips begin at events[0], so clip frame = events[k] - events[0]
(training/vendor/golfdb/dataloader.py does `events -= events[0]`, then labels frame `pos` with the index of
`pos` inside events[1:-1]). Order: Address [1], Toe-up [2], Mid-backswing [3], Top [4], Mid-downswing [5],
Impact [6], Mid-follow-through [7], Finish [8] (so Impact is class 5 of the 8, but events[6] of the 10).

Checks (exit 1 on any failure)
  * the cache holds exactly the annotated ids, complete files, with T equal to the decoded clip length
    (read from the .npz; frame counts of the .mp4 are compared for the sampled clips only);
  * every event frame lies inside [0, T-1] (failure); events that are not non-decreasing are listed as source
    annotation anomalies (warning only: the labels of such a clip are still well defined);
  * Impact +-W frames: reports how often a person was detected and the wrist landmarks (15, 16) are finite.

Usage:
    ~/.local/share/golf-swing-lab-venv/bin/python -I training/check_keypoints.py --model lite [--sample 5] [--window 2]
"""
import argparse
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
IMPACT = 6  # index into the 10-entry events array: [0] clip start, [1..8] the eight events, [9] clip end
WRISTS = (15, 16)


def clip_events(events):
    """Event frames relative to the clip: events[0] is 0, events[1:9] the eight swing events, events[9] clip end."""
    import numpy as np

    e = np.asarray(events, dtype=np.int64)
    return e - e[0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model", choices=["lite", "full"], required=True)
    ap.add_argument("--cache", type=Path, default=None, help="default training/cache/keypoints/<model>/")
    ap.add_argument("--data-dir", type=Path, default=HERE / "data")
    ap.add_argument("--sample", type=int, default=5, help="clips printed in detail (seeded random)")
    ap.add_argument("--window", type=int, default=2, help="Impact +- window, in frames")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    import cv2
    import numpy as np
    import pandas as pd

    cache = (args.cache or HERE / "cache" / "keypoints" / args.model).resolve()
    df = pd.read_pickle(args.data_dir.resolve() / "annotations" / "golfDB.pkl")
    ids = sorted(int(i) for i in df["id"])
    problems, anomalies = [], []
    on_disk = {int(p.stem) for p in cache.glob("*.npz")}
    if on_disk != set(ids):
        problems.append(f"cache ids differ from annotations: missing {sorted(set(ids) - on_disk)[:5]}, "
                        f"extra {sorted(on_disk - set(ids))[:5]}")

    rows = {}
    for _, r in df.iterrows():
        i = int(r["id"])
        f = cache / f"{i}.npz"
        if not f.is_file():
            continue
        ev = clip_events(r["events"])
        with np.load(f, allow_pickle=False) as z:
            det, img, T = z["detected"], z["img"], z["detected"].shape[0]
        lo, hi = max(ev[IMPACT] - args.window, 0), min(ev[IMPACT] + args.window, T - 1)
        win = slice(int(lo), int(hi) + 1)
        wrist_ok = np.isfinite(img[win][:, list(WRISTS), :2]).all(axis=(1, 2))
        vis = img[ev[IMPACT], list(WRISTS), 3] if det[ev[IMPACT]] else np.array([np.nan, np.nan])
        rows[i] = {"T": T, "events": ev, "det_win": det[win].mean(), "wrist_win": wrist_ok.mean(),
                   "impact": int(ev[IMPACT]), "vis_impact": vis, "view": r["view"], "club": r["club"]}
        if ev[-1] >= T or ev.min() < 0:
            problems.append(f"id {i}: events {ev.tolist()} not inside [0,{T - 1}]")
        elif np.any(np.diff(ev[1:9]) < 0):
            anomalies.append(f"id {i}: events not non-decreasing {ev.tolist()}")

    n = len(rows)
    if n:
        print(f"{args.model}: {n} clips in cache")
        print(f"  Impact +-{args.window}: person detected in all window frames for "
              f"{sum(r['det_win'] == 1 for r in rows.values())}/{n} clips; "
              f"both wrists finite in all window frames for {sum(r['wrist_win'] == 1 for r in rows.values())}/{n}")
        v = np.array([r["vis_impact"] for r in rows.values()], dtype=np.float64)
        print(f"  wrist visibility at Impact: mean L={np.nanmean(v[:, 0]):.3f} R={np.nanmean(v[:, 1]):.3f}; "
              f"clips with no detection at the Impact frame: {int(np.isnan(v[:, 0]).sum())}")

    rng = random.Random(args.seed)
    for i in sorted(rng.sample(sorted(rows), min(args.sample, len(rows)))):
        r = rows[i]
        cap = cv2.VideoCapture(str(args.data_dir.resolve() / "videos_160" / f"{i}.mp4"))
        n_mp4 = 0
        while cap.read()[0]:
            n_mp4 += 1
        cap.release()
        if n_mp4 != r["T"]:
            problems.append(f"id {i}: cache T={r['T']} but the mp4 decodes {n_mp4} frames")
        print(f"  id {i:4d} {r['view']:<15} {r['club']:<8} T={r['T']:3d} impact_frame={r['impact']:3d} "
              f"detected_in_window={r['det_win']:.2f} wrists_finite_in_window={r['wrist_win']:.2f} "
              f"wrist_vis_at_impact=({r['vis_impact'][0]:.2f}, {r['vis_impact'][1]:.2f})")

    for a in anomalies:
        print(f"  WARN annotation anomaly (GolfDB source data) {a}")
    if problems:
        print(f"FAIL: {len(problems)} problem(s)", file=sys.stderr)
        for p in problems[:20]:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
