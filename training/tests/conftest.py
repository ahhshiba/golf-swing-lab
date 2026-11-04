"""Puts training/ on sys.path (python -I does not add the script or working directory)."""
import sys
from pathlib import Path

TRAINING = Path(__file__).resolve().parents[1]
if str(TRAINING) not in sys.path:
    sys.path.insert(0, str(TRAINING))
