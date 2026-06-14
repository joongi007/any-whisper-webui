from __future__ import annotations

import numpy as np


def pcm_s16le_to_float32(buf: bytes) -> np.ndarray:
    arr = np.frombuffer(buf, dtype=np.int16).astype(np.float32)
    arr /= 32768.0
    return arr


def rms_dbfs(samples: np.ndarray) -> float:
    if samples.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    if rms <= 1e-9:
        return -120.0
    return 20.0 * float(np.log10(rms))
