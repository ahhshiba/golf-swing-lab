#!/usr/bin/env python
"""Extract MediaPipe PoseLandmarker keypoints for every GolfDB videos_160 clip (one .npz per clip).

The app runs the same MediaPipe release (1.2.2) with the lite model (live) and the full model (import), so the
event model is trained on features from both. Output per clip <id>.npz:
    img       float32 (T,33,4)  x_norm, y_norm, z, visibility   (interfaces.md section 4, MediaPipe order)
    world     float32 (T,33,3)  metres
    detected  bool    (T,)      False -> img/world rows are NaN
    t_s       float64 (T,)      frame / fps
    fps float64, W int, H int, model str, model_sha256 str, mediapipe_version str
plus <out>/INDEX.json (per clip: T, detection rate, seconds; overall statistics).

Choices that matter for reproducibility
  * VIDEO running mode keeps tracking state between frames, so every clip gets a fresh PoseLandmarker; the result of
    a clip then does not depend on which worker ran it or on what ran before it.
  * Timestamps passed to the detector are round(frame * 1000 / fps) ms, forced strictly increasing.
  * CPU delegate, num_poses=1, default confidence thresholds (0.5), frames decoded by OpenCV and fed as RGB.
  * Model files are checked against app/vendor/manifest.json before anything is processed.

Resumable: an existing .npz that loads, is internally consistent and carries the same model sha256 and
mediapipe version is skipped. Files are written to a temporary name and renamed.

Usage (any cwd except training/data or training/vendor):
    ~/.local/share/golf-swing-lab-venv/bin/python -I training/extract_keypoints.py --model lite --workers 8
"""
import argparse
import hashlib
import json
import math
import multiprocessing as mp
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEFAULT_VIDEOS = HERE / "data" / "videos_160"
DEFAULT_MODELS = REPO / "app" / "models"
MANIFEST = REPO / "app" / "vendor" / "manifest.json"
N_LM = 33
REQUIRED_KEYS = ("img", "world", "detected", "t_s", "fps", "W", "H", "model", "model_sha256", "mediapipe_version")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest_sha(model: str) -> str:
    entries = json.loads(MANIFEST.read_text())["entries"]
    for e in entries:
        if e.get("name") == f"pose_landmarker_{model}":
            return e["files"][0]["sha256"]
    raise SystemExit(f"pose_landmarker_{model} not in {MANIFEST}")


def list_videos(videos_dir: Path, limit):
    vids = sorted((p for p in videos_dir.glob("*.mp4") if p.stem.isdigit()), key=lambda p: int(p.stem))
    return vids[:limit] if limit else vids


def is_complete(path: Path, model_sha: str, mp_version: str):
    """Return the npz summary dict if `path` is a complete, consistent file for this model, else None."""
    import numpy as np

    try:
        with np.load(path, allow_pickle=False) as z:
            if any(k not in z.files for k in REQUIRED_KEYS):
                return None
            det, t_s = z["detected"], z["t_s"]
            T = det.shape[0]
            if T == 0 or z["img"].shape != (T, N_LM, 4) or z["world"].shape != (T, N_LM, 3) or t_s.shape != (T,):
                return None
            if str(z["model_sha256"]) != model_sha or str(z["mediapipe_version"]) != mp_version:
                return None
            return {"T": int(T), "detected_frames": int(det.sum())}
    except Exception:
        return None


def extract_one(video: Path, model_path: Path, model: str, model_sha: str, out_path: Path):
    """Run the landmarker over one clip and write <out_path> atomically. Returns the summary dict."""
    import cv2
    import mediapipe as mp_
    import numpy as np
    from mediapipe.tasks.python import BaseOptions, vision

    t0 = time.time()
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video}")
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    if not (math.isfinite(fps) and fps > 0):
        raise RuntimeError(f"bad fps {fps} in {video}")

    opts = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path), delegate=BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )
    img_rows, world_rows, det_rows = [], [], []
    W = H = None
    last_ts = -1
    landmarker = vision.PoseLandmarker.create_from_options(opts)
    try:
        i = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            if W is None:
                H, W = bgr.shape[:2]
            elif bgr.shape[:2] != (H, W):
                raise RuntimeError(f"frame size changed at frame {i} in {video}")
            rgb = np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            ts = max(int(round(i * 1000.0 / fps)), last_ts + 1)
            last_ts = ts
            res = landmarker.detect_for_video(mp_.Image(image_format=mp_.ImageFormat.SRGB, data=rgb), ts)
            if res.pose_landmarks and res.pose_world_landmarks:
                lm, wl = res.pose_landmarks[0], res.pose_world_landmarks[0]
                if len(lm) != N_LM or len(wl) != N_LM:
                    raise RuntimeError(f"{len(lm)} landmarks at frame {i} in {video}")
                img_rows.append([(p.x, p.y, p.z, p.visibility) for p in lm])
                world_rows.append([(p.x, p.y, p.z) for p in wl])
                det_rows.append(True)
            else:
                img_rows.append(None)
                world_rows.append(None)
                det_rows.append(False)
            i += 1
    finally:
        landmarker.close()
        cap.release()
    T = len(det_rows)
    if T == 0:
        raise RuntimeError(f"no frames decoded from {video}")

    img = np.full((T, N_LM, 4), np.nan, dtype=np.float32)
    world = np.full((T, N_LM, 3), np.nan, dtype=np.float32)
    for k in range(T):
        if det_rows[k]:
            img[k] = img_rows[k]
            world[k] = world_rows[k]
    detected = np.array(det_rows, dtype=bool)
    t_s = np.arange(T, dtype=np.float64) / fps

    tmp = out_path.with_name(out_path.name + f".tmp{os.getpid()}")
    try:
        with open(tmp, "wb") as f:
            np.savez(
                f, img=img, world=world, detected=detected, t_s=t_s,
                fps=np.float64(fps), W=np.int64(W), H=np.int64(H),
                model=np.str_(model), model_sha256=np.str_(model_sha), mediapipe_version=np.str_(mp_.__version__),
            )
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, out_path)
    finally:
        if tmp.exists():
            tmp.unlink()
    return {"T": T, "detected_frames": int(detected.sum()), "seconds": round(time.time() - t0, 3)}


def worker_init(log_path):
    # The native TFLite/glog layer prints a few warnings on every landmarker creation (once per clip). Send fd 2 of
    # the workers to a log file so the console stays readable; Python errors travel back through work()'s result.
    fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 2)
    os.close(fd)


def work(job):
    video, model_path, model, model_sha, out_path, mp_version = job
    vid_id = int(Path(video).stem)
    try:
        done = is_complete(Path(out_path), model_sha, mp_version)
        if done:
            return {"id": vid_id, "skipped": True, **done}
        return {"id": vid_id, "skipped": False,
                **extract_one(Path(video), Path(model_path), model, model_sha, Path(out_path))}
    except Exception as e:  # reported by the parent; never kills the pool
        return {"id": vid_id, "error": f"{type(e).__name__}: {e}"}


def atomic_write_json(path: Path, obj):
    tmp = path.with_name(path.name + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(obj, indent=1) + "\n")
    os.replace(tmp, path)


def build_index(out_dir: Path, vids, model, model_sha, mp_version, fresh, old_index, run_info):
    """Index over the requested clips, read back from the .npz files (the files are the source of truth)."""
    old_clips = {c["id"]: c for c in old_index.get("clips", [])} if old_index else {}
    clips = []
    for v in vids:
        vid_id = int(v.stem)
        s = is_complete(out_dir / f"{vid_id}.npz", model_sha, mp_version)
        if s is None:
            continue
        sec = fresh.get(vid_id, {}).get("seconds")
        if sec is None:
            o = old_clips.get(vid_id)
            sec = o.get("seconds") if o and o.get("T") == s["T"] else None
        clips.append({"id": vid_id, "T": s["T"], "detected_frames": s["detected_frames"],
                      "detection_rate": round(s["detected_frames"] / s["T"], 6), "seconds": sec})
    total_T = sum(c["T"] for c in clips)
    total_det = sum(c["detected_frames"] for c in clips)
    secs = [c["seconds"] for c in clips if c["seconds"] is not None]
    runs = (old_index.get("runs", []) if old_index else []) + [run_info]
    return {
        "schema": "gsl-keypoints-index/1",
        "model": model, "model_sha256": model_sha, "mediapipe_version": mp_version,
        "count": len(clips),
        "total_frames": total_T,
        "detected_frames": total_det,
        "detection_rate": round(total_det / total_T, 6) if total_T else None,
        "clips_with_zero_detection": sum(1 for c in clips if c["detected_frames"] == 0),
        "min_clip_detection_rate": min((c["detection_rate"] for c in clips), default=None),
        "sum_clip_seconds": round(sum(secs), 2),
        "clips_with_timing": len(secs),
        "runs": runs,
        "clips": clips,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model", choices=["lite", "full"], required=True)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0, help="only the first N clips by id (testing)")
    ap.add_argument("--out", type=Path, default=None, help="default training/cache/keypoints/<model>/")
    ap.add_argument("--videos-dir", type=Path, default=DEFAULT_VIDEOS)
    ap.add_argument("--models-dir", type=Path, default=DEFAULT_MODELS)
    args = ap.parse_args()
    if args.workers < 1:
        ap.error("--workers must be >= 1")

    import mediapipe

    out_dir = (args.out or HERE / "cache" / "keypoints" / args.model).resolve()
    videos_dir = args.videos_dir.resolve()
    model_path = (args.models_dir / f"pose_landmarker_{args.model}.task").resolve()
    model_sha = sha256_file(model_path)
    if model_sha != manifest_sha(args.model):
        print(f"FAIL: {model_path} sha256 {model_sha} != app/vendor/manifest.json", file=sys.stderr)
        return 2
    vids = list_videos(videos_dir, args.limit)
    if not vids:
        print(f"FAIL: no videos in {videos_dir}", file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.tmp*"):  # leftovers of an interrupted run
        stale.unlink()
    mp_version = mediapipe.__version__
    index_path = out_dir / "INDEX.json"
    old_index = None
    if index_path.is_file():
        try:
            old_index = json.loads(index_path.read_text())
        except Exception:
            old_index = None

    jobs = [(str(v), str(model_path), args.model, model_sha, str(out_dir / f"{v.stem}.npz"), mp_version) for v in vids]
    print(f"model={args.model} sha256={model_sha[:12]} mediapipe={mp_version} clips={len(jobs)} "
          f"workers={args.workers} out={out_dir}", flush=True)

    t0 = time.time()
    fresh, errors = {}, []
    n_skipped = n_done = 0
    ctx = mp.get_context("spawn")
    with ctx.Pool(args.workers, initializer=worker_init, initargs=(str(out_dir / "worker_stderr.log"),)) as pool:
        for r in pool.imap_unordered(work, jobs, chunksize=1):
            if "error" in r:
                errors.append(r)
                print(f"ERROR id={r['id']}: {r['error']}", file=sys.stderr, flush=True)
                continue
            if r["skipped"]:
                n_skipped += 1
            else:
                n_done += 1
                fresh[r["id"]] = r
            seen = n_skipped + n_done
            if seen % 50 == 0 or seen == len(jobs):
                el = time.time() - t0
                eta = el / max(n_done, 1) * (len(jobs) - seen) if n_done else 0
                print(f"[{seen}/{len(jobs)}] extracted={n_done} skipped={n_skipped} errors={len(errors)} "
                      f"elapsed={el:.0f}s eta~{eta:.0f}s", flush=True)
    wall = time.time() - t0

    run_info = {"started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)), "wall_s": round(wall, 2),
                "workers": args.workers, "limit": args.limit or None, "extracted": n_done, "skipped": n_skipped,
                "errors": len(errors)}
    index = build_index(out_dir, vids, args.model, model_sha, mp_version, fresh, old_index, run_info)
    atomic_write_json(index_path, index)
    print(f"INDEX.json: count={index['count']} frames={index['total_frames']} "
          f"detection_rate={index['detection_rate']} wall={wall:.1f}s", flush=True)
    if errors or index["count"] != len(vids):
        print(f"FAIL: {len(errors)} error(s), {index['count']}/{len(vids)} clips complete", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
