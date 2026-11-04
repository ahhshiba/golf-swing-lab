"""M0 environment checks for the golf-swing-lab training venv.

Run from the repository root:
    ~/.local/share/golf-swing-lab-venv/bin/python -I -m pytest -q training/tests
"""
import subprocess
from pathlib import Path

TRAINING = Path(__file__).resolve().parents[1]
VIDEOS = TRAINING / "data" / "videos_160"


def test_torch_cuda_available():
    import torch

    assert torch.__version__ == "2.14.0+cu130"
    assert torch.cuda.is_available(), "CUDA not available (cu130 wheel needed for Blackwell)"
    assert torch.version.cuda and torch.version.cuda.startswith("13")


def test_cuda_matmul_matches_cpu():
    import torch

    g = torch.Generator().manual_seed(0)
    a = torch.randn(64, 64, generator=g)
    b = torch.randn(64, 64, generator=g)
    got = (a.cuda() @ b.cuda()).cpu()
    torch.cuda.synchronize()
    assert got.shape == (64, 64)
    assert torch.allclose(got, a @ b, atol=1e-3, rtol=1e-3)


def test_mediapipe_version():
    import mediapipe

    assert mediapipe.__version__ == "1.2.2"


def test_onnx_stack_imports():
    import onnx
    import onnxruntime as ort

    assert "CPUExecutionProvider" in ort.get_available_providers()
    assert onnx.__version__


def test_cv2_reads_golfdb_video_160x160():
    import cv2

    first = sorted(VIDEOS.glob("*.mp4"), key=lambda p: int(p.stem))
    assert first, f"no GolfDB videos in {VIDEOS} (run the M0 data download)"
    cap = cv2.VideoCapture(str(first[0]))
    try:
        assert cap.isOpened(), f"cv2 cannot open {first[0]}"
        n = 0
        while n < 5:
            ok, frame = cap.read()
            assert ok, f"frame {n} unreadable"
            assert frame.shape == (160, 160, 3), frame.shape
            n += 1
    finally:
        cap.release()


def test_imageio_ffmpeg_makes_h264_clip_readable_by_cv2(tmp_path):
    import cv2
    import imageio_ffmpeg

    exe = imageio_ffmpeg.get_ffmpeg_exe()
    out = tmp_path / "clip.mp4"
    cmd = [exe, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=0.5",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    cap = cv2.VideoCapture(str(out))
    try:
        ok, frame = cap.read()
        assert ok and frame.shape == (240, 320, 3)
        assert int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) == 15
    finally:
        cap.release()
