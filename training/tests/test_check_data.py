"""check_data.py must pass on the real data and fail loudly on each kind of damage.

Damage is applied to a scratch copy (symlinks to the real videos), never to training/data itself.
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

TRAINING = Path(__file__).resolve().parents[1]
REAL = TRAINING / "data"
SCRIPT = TRAINING / "check_data.py"


def run_check(data_dir: Path):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), "--data-dir", str(data_dir)],
                          capture_output=True, text=True, timeout=300)


@pytest.fixture()
def scratch(tmp_path):
    d = tmp_path / "data"
    (d / "videos_160").mkdir(parents=True)
    shutil.copytree(REAL / "annotations", d / "annotations")
    shutil.copy2(REAL / "MANIFEST.sha256", d / "MANIFEST.sha256")
    for v in (REAL / "videos_160").glob("*.mp4"):
        (d / "videos_160" / v.name).symlink_to(v)
    return d


def test_real_data_passes():
    r = run_check(REAL)
    assert r.returncode == 0, r.stderr
    assert "1400 annotations" in r.stdout
    assert "4 splits loaded" in r.stdout


def test_scratch_copy_passes(scratch):
    assert run_check(scratch).returncode == 0


def test_missing_video_fails(scratch):
    (scratch / "videos_160" / "7.mp4").unlink()
    r = run_check(scratch)
    assert r.returncode != 0
    assert "without a video file" in r.stderr


def test_corrupted_video_fails(scratch):
    target = scratch / "videos_160" / "9.mp4"
    data = bytearray((REAL / "videos_160" / "9.mp4").read_bytes())
    data[-1] ^= 0xFF
    target.unlink()
    target.write_bytes(bytes(data))
    r = run_check(scratch)
    assert r.returncode != 0
    assert "wrong sha256" in r.stderr


def test_extra_file_fails(scratch):
    (scratch / "videos_160" / "stray.mp4").write_bytes(b"x")
    r = run_check(scratch)
    assert r.returncode != 0
    assert "not in manifest" in r.stderr
