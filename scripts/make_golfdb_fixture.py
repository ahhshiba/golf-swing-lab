#!/usr/bin/env python
"""Build the local-only GolfDB fixture for the browser e2e gate "real-pose" (tests/e2e/realpose.mjs).

GolfDB (McNally et al. 2019) is CC BY-NC 4.0: everything written here stays under the git-ignored
tests/fixtures/generated/golfdb/ and is never published or deployed.

Selection (fixed rule, not tuned on results): GolfDB split 1 (the split the shipped event-tcn-v1 was NOT trained
on, docs/training.md), real-time clips only (slow == 0: the app records real-time or high-speed swings, not
broadcast replays), view face-on and down-the-line, the N lowest ids of each view whose 8 events are
non-decreasing.

Per clip <id> (source: training/data/videos_160/<id>.mp4, 160x160, ~29.97 fps NTSC):
  <id>.mp4        H.264 (libx264, yuv420p, high profile), upscaled to 720x720 (bicubic, square like the source: evfeat-1
                  normalises u and v separately, so padding to 16:9 would distort the features), every frame kept and
                  re-timed to exactly --fps (default 30). Why: the metric registry's minFps 30 is a strict
                  `fps >= 30`, so a 29.97 fps clip nulls every tempo row (FPS_TOO_LOW); iPhone "30 fps" is exactly
                  30. Event frames are unchanged; times scale by 1001/1000 (tempo ratios unchanged).
  <id>_vp9.mp4    VP9 in MP4 (libvpx-vp9): what Playwright's Chromium (no H.264 decoder) imports
  <id>.webm       VP9 in WebM (the app's demuxer is mp4box, so this one is for reference / other players)
  <id>.truth.json {id, view, app_view, club, player, slow, split, fps, frame_count, events: {name: {frame, t_s}}}
Event semantics (training/check_keypoints.py clip_events): GolfDB 'events' = [clip start, 8 events, clip end]
in frames of the original video; the 160 px clip starts at events[0], so clip frame = events[k] - events[0]
(Impact = events[6]); t_s = clip frame / fps.
Plus index.json listing the clips. Deterministic for a given ffmpeg build.

Usage:  ~/.local/share/golf-swing-lab-venv/bin/python -I scripts/make_golfdb_fixture.py [--per-view 3] [--force]
Exit: 0 written (or already up to date), 2 GolfDB data absent (training/data), 1 any other failure.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "training" / "data"
OUT = ROOT / "tests" / "fixtures" / "generated" / "golfdb"
EVENT_NAMES = ["address", "toe_up", "mid_backswing", "top", "mid_downswing", "impact", "mid_follow_through", "finish"]
VIEWS = {"face-on": "face_on", "down-the-line": "dtl"}
SIZE = 720
VERSION = "golfdb-fixture/1"


def ffmpeg_exe():
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])} ... exited {r.returncode}: {r.stderr[-800:]}")
    return r


def frame_pts(ff, path):
    """pts_time of every decoded frame (ffmpeg showinfo)."""
    r = run([ff, "-hide_banner", "-i", str(path), "-vf", "showinfo", "-f", "null", "-"])
    return [float(m) for m in re.findall(r"pts_time:\s*([0-9.]+)", r.stderr)]


def encode(ff, src, dst, codec_args, fps):
    tmp = dst.with_name(dst.stem + ".tmp" + dst.suffix)
    # input -r re-times every source frame to N / fps (no frame dropped or duplicated)
    run([ff, "-hide_banner", "-loglevel", "error", "-y", *(["-r", str(fps)] if fps else []), "-i", str(src),
         "-vf", f"scale={SIZE}:{SIZE}:flags=bicubic,format=yuv420p", "-fps_mode", "passthrough",
         *codec_args, "-an", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", str(tmp)])
    tmp.replace(dst)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--per-view", type=int, default=3)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--fps", type=int, default=30, help="re-time every frame to exactly this rate (0 = keep source)")
    args = ap.parse_args()
    pkl = DATA / "annotations" / "golfDB.pkl"
    vids = DATA / "videos_160"
    if not pkl.is_file() or not vids.is_dir():
        print(f"GolfDB data absent ({pkl} / {vids}); real-pose fixture not built", file=sys.stderr)
        return 2
    import numpy as np
    import pandas as pd

    ff = ffmpeg_exe()
    enc = run([ff, "-hide_banner", "-encoders"]).stdout
    if "libx264" not in enc or "libvpx-vp9" not in enc:
        print(f"{ff} lacks libx264 or libvpx-vp9", file=sys.stderr)
        return 1
    df = pd.read_pickle(pkl)
    sel = df[(df["split"] == 1) & (df["slow"] == 0) & (df["view"].isin(list(VIEWS)))].sort_values("id")
    OUT.mkdir(parents=True, exist_ok=True)
    index = {"format": VERSION, "licence": "GolfDB CC BY-NC 4.0 - local test fixture, never publish",
             "rule": "split 1, slow 0, lowest ids per view with non-decreasing events", "size": SIZE, "clips": []}
    for gview, app_view in VIEWS.items():
        picked = 0
        for _, r in sel[sel["view"] == gview].iterrows():
            if picked >= args.per_view:
                break
            ev = np.asarray(r["events"], dtype=np.int64)
            ev = ev - ev[0]
            if np.any(np.diff(ev[1:9]) < 0):
                continue
            cid = int(r["id"])
            src = vids / f"{cid}.mp4"
            if not src.is_file():
                continue
            picked += 1
            truth_f = OUT / f"{cid}.truth.json"
            outs = {"h264": OUT / f"{cid}.mp4", "vp9_mp4": OUT / f"{cid}_vp9.mp4", "webm": OUT / f"{cid}.webm"}
            if args.force or not truth_f.is_file() or not all(p.is_file() for p in outs.values()):
                rt = ["-video_track_timescale", str(args.fps * 1000)] if args.fps else []
                encode(ff, src, outs["h264"], ["-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18",
                                               "-threads", "1", *rt, "-movflags", "+faststart"], args.fps)
                encode(ff, src, outs["vp9_mp4"], ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24", "-row-mt", "0",
                                                  "-threads", "1", *rt, "-movflags", "+faststart"], args.fps)
                encode(ff, src, outs["webm"], ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24", "-row-mt", "0", "-threads", "1"],
                       args.fps)
                pts = frame_pts(ff, outs["h264"])
                if len(pts) < 2:
                    raise RuntimeError(f"id {cid}: encoded clip has {len(pts)} frames")
                fps = (len(pts) - 1) / (pts[-1] - pts[0])
                if ev[9] >= len(pts) + 1:
                    raise RuntimeError(f"id {cid}: events {ev.tolist()} beyond {len(pts)} frames")
                truth = {
                    "format": VERSION, "id": cid, "view": gview, "app_view": app_view, "club": r["club"],
                    "player": r["player"], "slow": int(r["slow"]), "split": int(r["split"]),
                    "width": SIZE, "height": SIZE, "fps": fps, "retimed_fps": args.fps or None, "frame_count": len(pts),
                    "files": {k: p.name for k, p in outs.items()},
                    "events": {n: {"frame": int(ev[k + 1]), "t_s": round(pts[int(ev[k + 1])] - pts[0], 6)}
                               for k, n in enumerate(EVENT_NAMES)},
                    "golfdb_events_raw": [int(x) for x in r["events"]],
                    "licence": "GolfDB CC BY-NC 4.0 - local test fixture, never publish",
                }
                truth_f.write_text(json.dumps(truth, indent=1) + "\n")
                print(f"id {cid:4d} {app_view:<8} {len(pts)} frames @ {fps:.3f} fps impact frame {truth['events']['impact']['frame']}")
            index["clips"].append({"id": cid, "app_view": app_view, "truth": truth_f.name})
        if picked < args.per_view:
            print(f"only {picked} usable {gview} clips", file=sys.stderr)
            return 1
    (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    print(f"golfdb fixture: {len(index['clips'])} clips in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
