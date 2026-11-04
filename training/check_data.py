#!/usr/bin/env python
"""Verify the local GolfDB data set. Exit 0 only if everything is consistent.

Checks
  1. annotation pickles load and hold exactly 1400 annotations with unique ids;
  2. the pickles agree with the vendored golfDB.mat (ids and split column);
  3. there are 4 splits, each train/val pair partitions the annotation ids;
  4. every annotation id has a non-empty videos_160/<id>.mp4;
  5. MANIFEST.sha256 matches every video byte-for-byte, lists exactly the
     files that are on disk, and nothing else is in videos_160/.

Usage (from anywhere; paths are resolved from this file):
    ~/.local/share/golf-swing-lab-venv/bin/python -I training/check_data.py [--data-dir DIR]
"""
import argparse
import hashlib
import sys
from pathlib import Path

EXPECTED_ANNOTATIONS = 1400
EXPECTED_SPLITS = 4
HERE = Path(__file__).resolve().parent


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(path: Path, problems: list) -> dict:
    entries = {}
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split(None, 1)
        if len(parts) != 2 or len(parts[0]) != 64:
            problems.append(f"MANIFEST.sha256 line {n}: malformed")
            continue
        name = parts[1].lstrip("*").strip()
        if name in entries:
            problems.append(f"MANIFEST.sha256 line {n}: duplicate entry {name}")
        entries[name] = parts[0]
    return entries


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, default=HERE / "data")
    args = ap.parse_args()
    data = args.data_dir.resolve()
    ann_dir = data / "annotations"
    vid_dir = data / "videos_160"
    problems: list = []

    try:
        import pandas as pd
        from scipy.io import loadmat
    except ImportError as e:  # wrong interpreter
        print(f"FAIL: {e} (use the golf-swing-lab venv python)", file=sys.stderr)
        return 2

    # 1. annotations
    df = None
    try:
        df = pd.read_pickle(ann_dir / "golfDB.pkl")
    except Exception as e:
        problems.append(f"cannot load {ann_dir / 'golfDB.pkl'}: {e}")
    ids: set = set()
    if df is not None:
        n_ann = len(df)
        print(f"{n_ann} annotations (expected {EXPECTED_ANNOTATIONS})")
        if n_ann != EXPECTED_ANNOTATIONS:
            problems.append(f"annotation count {n_ann} != {EXPECTED_ANNOTATIONS}")
        ids = {int(i) for i in df["id"]}
        if len(ids) != n_ann:
            problems.append("annotation ids are not unique")
        bad_events = [int(r["id"]) for _, r in df.iterrows() if len(r["events"]) != 10]
        if bad_events:
            problems.append(f"{len(bad_events)} annotations without 10 event entries, e.g. {bad_events[:5]}")

        # 2. cross-check against the .mat (no pickle involved)
        try:
            mat = loadmat(str(ann_dir / "golfDB.mat"))["golfDB"][0]
            mat_ids = [int(r[0][0][0]) for r in mat]
            mat_split = {int(r[0][0][0]): int(r[9][0][0]) for r in mat}
            if set(mat_ids) != ids:
                problems.append("ids in golfDB.pkl differ from golfDB.mat")
            else:
                diff = [int(r["id"]) for _, r in df.iterrows() if int(r["split"]) != mat_split[int(r["id"])]]
                if diff:
                    problems.append(f"split column differs from golfDB.mat for {len(diff)} ids")
        except Exception as e:
            problems.append(f"cannot cross-check golfDB.mat: {e}")

        # 3. splits
        found_splits = 0
        print(f"{EXPECTED_SPLITS} splits expected:")
        for i in range(1, EXPECTED_SPLITS + 1):
            try:
                tr = pd.read_pickle(ann_dir / f"train_split_{i}.pkl")
                va = pd.read_pickle(ann_dir / f"val_split_{i}.pkl")
            except Exception as e:
                problems.append(f"split {i}: cannot load pickles: {e}")
                continue
            found_splits += 1
            tr_ids, va_ids = {int(x) for x in tr["id"]}, {int(x) for x in va["id"]}
            print(f"  split {i}: train={len(tr)} val={len(va)}")
            if tr_ids & va_ids:
                problems.append(f"split {i}: train and val overlap")
            if (tr_ids | va_ids) != ids or len(tr) + len(va) != len(ids):
                problems.append(f"split {i}: train+val is not a partition of all annotation ids")
        print(f"{found_splits} splits loaded")
        if found_splits != EXPECTED_SPLITS:
            problems.append(f"loaded {found_splits} splits, expected {EXPECTED_SPLITS}")

    # 4. every id has a video
    if not vid_dir.is_dir():
        problems.append(f"missing directory {vid_dir}")
    else:
        on_disk = {p.name: p for p in vid_dir.iterdir()}
        missing = [i for i in sorted(ids) if f"{i}.mp4" not in on_disk]
        empty = [i for i in sorted(ids) if f"{i}.mp4" in on_disk and on_disk[f"{i}.mp4"].stat().st_size == 0]
        if missing:
            problems.append(f"{len(missing)} annotation ids without a video file, e.g. {missing[:5]}")
        if empty:
            problems.append(f"{len(empty)} empty video files, e.g. {empty[:5]}")
        if not missing and not empty and ids:
            print(f"videos: all {len(ids)} annotation ids have a video file")

        # 5. manifest
        manifest_path = data / "MANIFEST.sha256"
        if not manifest_path.is_file():
            problems.append(f"missing {manifest_path}")
        else:
            entries = load_manifest(manifest_path, problems)
            want = {f"videos_160/{n}" for n in on_disk}
            extra_on_disk = sorted(want - set(entries))
            missing_on_disk = sorted(set(entries) - want)
            if extra_on_disk:
                problems.append(f"{len(extra_on_disk)} files in videos_160 not in manifest, e.g. {extra_on_disk[:3]}")
            if missing_on_disk:
                problems.append(f"{len(missing_on_disk)} manifest entries without file, e.g. {missing_on_disk[:3]}")
            mismatched = []
            checked = 0
            for name, digest in entries.items():
                p = data / name
                if p.is_file():
                    checked += 1
                    if sha256_file(p) != digest:
                        mismatched.append(name)
            if mismatched:
                problems.append(f"{len(mismatched)} files with wrong sha256, e.g. {mismatched[:3]}")
            print(f"manifest: {checked} files hashed, {len(mismatched)} mismatches")

    if problems:
        print(f"FAIL: {len(problems)} problem(s)", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print("OK: GolfDB data consistent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
