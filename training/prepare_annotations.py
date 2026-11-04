#!/usr/bin/env python
"""Generate the GolfDB annotation pickles (golfDB.pkl + 4 train/val splits).

Runs the vendored `vendor/golfdb/data/generate_splits.py` unchanged, but in an
isolated way: the script is executed with `python -I` inside a fresh empty
temporary directory that only contains a copy of `golfDB.mat`, so it never
reads or writes inside the vendored checkout. The nine resulting pickles are
copied to `training/data/annotations/` (git-ignored, regenerable).

Usage (from the repository root):
    ~/.local/share/golf-swing-lab-venv/bin/python -I training/prepare_annotations.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDOR_DATA = HERE / "vendor" / "golfdb" / "data"
OUT_DIR = HERE / "data" / "annotations"
EXPECTED = ["golfDB.pkl"] + [f"{kind}_split_{i}.pkl" for i in range(1, 5) for kind in ("train", "val")]


def main() -> int:
    mat = VENDOR_DATA / "golfDB.mat"
    script = VENDOR_DATA / "generate_splits.py"
    for p in (mat, script):
        if not p.is_file():
            print(f"FAIL: missing {p} (clone golfdb into training/vendor/golfdb first)", file=sys.stderr)
            return 2
    with tempfile.TemporaryDirectory(prefix="golfdb-splits-") as tmp:
        tmp_path = Path(tmp)
        shutil.copy2(mat, tmp_path / "golfDB.mat")
        proc = subprocess.run(
            [sys.executable, "-I", str(script)],
            cwd=tmp_path, capture_output=True, text=True, check=False,
        )
        sys.stdout.write(proc.stdout)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr)
            print(f"FAIL: generate_splits.py exited {proc.returncode}", file=sys.stderr)
            return 1
        missing = [n for n in EXPECTED if not (tmp_path / n).is_file()]
        if missing:
            print(f"FAIL: generate_splits.py did not produce {missing}", file=sys.stderr)
            return 1
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for name in EXPECTED:
            shutil.copy2(tmp_path / name, OUT_DIR / name)
        shutil.copy2(mat, OUT_DIR / "golfDB.mat")
    print(f"wrote {len(EXPECTED)} pickles + golfDB.mat to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
