"""Secondary-structure predictors.

`ChouFasmanBaseline` is a transparent, propensity-based baseline (not a trained ML model).
To use a trained network, implement the `Predictor` protocol and set `PREDICTOR` in main.py.
"""
import math
from typing import Protocol

LABELS = ("H", "E", "C")  # helix, beta-strand, coil

# Chou-Fasman propensities: (P_alpha, P_beta, P_turn)
PROPENSITY = {
    "A": (1.42, 0.83, 0.66), "R": (0.98, 0.93, 0.95), "N": (0.67, 0.89, 1.56),
    "D": (1.01, 0.54, 1.46), "C": (0.70, 1.19, 1.19), "E": (1.51, 0.37, 0.74),
    "Q": (1.11, 1.10, 0.98), "G": (0.57, 0.75, 1.56), "H": (1.00, 0.87, 0.95),
    "I": (1.08, 1.60, 0.47), "L": (1.21, 1.30, 0.59), "K": (1.16, 0.74, 1.01),
    "M": (1.45, 1.05, 0.60), "F": (1.13, 1.38, 0.60), "P": (0.57, 0.55, 1.52),
    "S": (0.77, 0.75, 1.43), "T": (0.83, 1.19, 0.96), "W": (1.08, 1.37, 0.96),
    "Y": (0.69, 1.47, 1.14), "V": (1.06, 1.70, 0.50),
}
NEUTRAL = (1.0, 1.0, 1.0)  # used for X (unknown)
MIN_SEGMENT = {"H": 4, "E": 3}


class Predictor(Protocol):
    name: str

    def predict_proba(self, seq: str) -> list[tuple[float, float, float]]:
        """Return (P_H, P_E, P_C) for every residue."""


def _window_mean(vals: list[float], w: int) -> list[float]:
    half, out = w // 2, []
    for i in range(len(vals)):
        chunk = vals[max(0, i - half): i + half + 1]
        out.append(sum(chunk) / len(chunk))
    return out


def _softmax(z: list[float]) -> tuple[float, float, float]:
    m = max(z)
    e = [math.exp(v - m) for v in z]
    s = sum(e)
    return (e[0] / s, e[1] / s, e[2] / s)


class ChouFasmanBaseline:
    name = "Chou-Fasman propensity baseline (windowed)"

    def predict_proba(self, seq: str) -> list[tuple[float, float, float]]:
        p = [PROPENSITY.get(a, NEUTRAL) for a in seq]
        pa = _window_mean([x[0] for x in p], 7)
        pb = _window_mean([x[1] for x in p], 5)
        pt = _window_mean([x[2] for x in p], 5)
        k = 5.0
        return [
            _softmax([k * (a - 1.0), k * (b - 1.0), k * (t - 1.0) + 0.15])
            for a, b, t in zip(pa, pb, pt)
        ]


def smooth_labels(labels: list[str]) -> list[str]:
    """Turn helix/strand runs shorter than their minimum length into coil."""
    out, i = list(labels), 0
    while i < len(out):
        j = i
        while j < len(out) and out[j] == out[i]:
            j += 1
        if out[i] in MIN_SEGMENT and (j - i) < MIN_SEGMENT[out[i]]:
            out[i:j] = ["C"] * (j - i)
        i = j
    return out


def predict(seq: str, model: Predictor) -> list[dict]:
    probs = model.predict_proba(seq)
    raw = [LABELS[max(range(3), key=lambda k: pr[k])] for pr in probs]
    labels = smooth_labels(raw)
    return [
        {
            "index": i,
            "aa": seq[i],
            "label": lab,
            "confidence": round(pr[LABELS.index(lab)], 4),
            "probs": {"H": round(pr[0], 4), "E": round(pr[1], 4), "C": round(pr[2], 4)},
        }
        for i, (lab, pr) in enumerate(zip(labels, probs))
    ]
