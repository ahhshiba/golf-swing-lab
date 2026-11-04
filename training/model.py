"""Event TCN (CAFCR R2): 4 dilated Conv1d layers, 64 channels, centred ('same') zero padding, residual blocks.

    x (B, 12, T)  normalised evfeat-1 ((x - mean) / std, non-finite -> 0)
    h0 = relu(conv0(x))                      conv0: 12 -> 64, k, dilation d0
    h_l = h_{l-1} + relu(conv_l(h_{l-1}))    conv_l: 64 -> 64, k, dilation d_l   (l = 1..3)
    logits = head(h3)                        head: 1x1, 64 -> 9 (classes 0..7 = events, 8 = background)
    probs = softmax over the 9 classes, per frame

Padding is torch's Conv1d(padding = d * (k - 1) // 2) with zeros, so the output has the input length. Batches of
unequal length are padded and every hidden activation is multiplied by the validity mask, which makes a padded
batch compute exactly what a single unpadded sequence computes (the JS port, app/src/events/tcn.js, runs one
sequence with the same zero padding).
"""
from __future__ import annotations

import numpy as np
import torch
from torch import nn

from features import N_FEATURES
from pce import golfdb_correct, golfdb_labels, decode_ordered


class EventTCN(nn.Module):
    def __init__(self, in_ch: int = N_FEATURES, ch: int = 64, k: int = 5, dilations=(1, 2, 4, 8),
                 n_classes: int = 9, dropout: float = 0.1):
        super().__init__()
        assert k % 2 == 1, "centred padding needs an odd kernel"
        self.k, self.dilations, self.ch, self.in_ch, self.n_classes = k, tuple(dilations), ch, in_ch, n_classes
        convs = []
        for i, d in enumerate(dilations):
            convs.append(nn.Conv1d(in_ch if i == 0 else ch, ch, k, dilation=d, padding=d * (k - 1) // 2))
        self.convs = nn.ModuleList(convs)
        self.head = nn.Conv1d(ch, n_classes, 1)
        self.drop = nn.Dropout(dropout)

    def forward(self, x, mask=None):
        m = None if mask is None else mask[:, None, :].to(x.dtype)
        h = x if m is None else x * m
        for i, conv in enumerate(self.convs):
            y = torch.relu(conv(h))
            if m is not None:
                y = y * m
            y = self.drop(y)
            h = y if i == 0 else h + y
        return self.head(h)  # (B, 9, T)


def n_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def normalise(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """(K, 12) features -> float32 normalised, non-finite -> 0 (tcn.js does the same, in float32)."""
    x32 = np.asarray(x, dtype=np.float32)
    z = (x32 - mean.astype(np.float32)) / std.astype(np.float32)
    return np.where(np.isfinite(z), z, np.float32(0)).astype(np.float32)


@torch.no_grad()
def predict_probs(model: EventTCN, xn: np.ndarray, device="cpu") -> np.ndarray:
    """xn (K, 12) normalised -> probs (K, 9) float32."""
    model.eval()
    t = torch.from_numpy(np.ascontiguousarray(xn.T[None])).to(device)
    logits = model(t)
    return torch.softmax(logits, dim=1)[0].T.float().cpu().numpy()


def evaluate_ids(model, ids, mean, std, device="cpu", model_kind: str = "full", with_argmax: bool = False):
    """Ordered-decode PCE rows on the original frame grid for clips `ids`. Returns list of dicts."""
    import dataset as D

    out = []
    for cid in ids:
        a = D.annotation(cid)
        clip = D.load_clip(cid, model_kind)
        T = len(clip["t_s"])
        labels = golfdb_labels(a["events"], T)
        ex = D.build_example(cid, model_kind)
        if ex is None:
            out.append({"id": cid, "frames": None, "correct": np.zeros(8, np.uint8)})
            continue
        probs = predict_probs(model, normalise(ex["x"], mean, std), device)
        ks, _ = decode_ordered(probs)
        frames = D.grid_to_frames(ex["t_grid"], ks, clip["t_s"])
        _, deltas, tol, correct = golfdb_correct(frames, labels)
        row = {"id": cid, "frames": frames, "correct": correct, "tol": tol, "deltas": deltas}
        if with_argmax:
            ka = probs[:, :8].argmax(axis=0)
            fa = D.grid_to_frames(ex["t_grid"], ka, clip["t_s"])
            row["correct_argmax"] = golfdb_correct(fa, labels)[3]
        out.append(row)
    return out
