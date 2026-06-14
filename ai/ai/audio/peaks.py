"""Pre-computed waveform peaks for the History audio player.

Why: wavesurfer.js decodes the entire audio file in the browser to extract
peaks — for a 60-min recording that's ~5s of jank before the waveform appears.
By writing a tiny JSON next to `input_16k.wav` at pipeline time, the UI can
hand wavesurfer pre-computed peaks and skip the decode entirely.

Format: a single channel of normalised abs-max values, one per bucket, in
[0, 1]. Wavesurfer accepts this directly via the `peaks` constructor option.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

# 2048 buckets is enough resolution for any waveform the UI renders (it
# downsamples to viewport width anyway), and keeps the JSON ~25 KB even for
# multi-hour files. Increasing past 4096 starts to bloat without visible gain.
DEFAULT_BUCKETS = 2048
PEAKS_VERSION = 1


def compute_peaks(samples: np.ndarray, n_buckets: int = DEFAULT_BUCKETS) -> list[float]:
    if samples.size == 0:
        return []
    # Mix any multi-channel input down to mono first — wavesurfer renders a
    # single track and we don't carry channel info into the UI.
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    bucket_size = max(1, samples.size // n_buckets)
    trimmed = samples[: bucket_size * n_buckets]
    peaks = np.max(np.abs(trimmed.reshape(-1, bucket_size)), axis=1)
    # Round to 4 decimals — 14-bit precision is more than the eye can resolve
    # and shaves ~30% off the JSON payload.
    return [round(float(p), 4) for p in peaks]


def write_peaks_json(wav_path: Path, n_buckets: int = DEFAULT_BUCKETS) -> Path | None:
    """Reads `wav_path`, writes `peaks.json` alongside it, returns the path
    written (or None if the wav couldn't be read — caller decides whether to
    log/surface; we don't raise because peaks are an optimisation, not a
    correctness gate)."""
    try:
        samples, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)
    except Exception:  # noqa: BLE001
        return None
    duration = float(len(samples)) / float(sr) if sr else 0.0
    peaks = compute_peaks(samples, n_buckets=n_buckets)
    out = wav_path.with_name("peaks.json")
    payload = {
        "version": PEAKS_VERSION,
        "n_peaks": len(peaks),
        "duration_sec": round(duration, 3),
        "peaks": peaks,
    }
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    return out
