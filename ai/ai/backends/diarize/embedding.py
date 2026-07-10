"""Speaker embeddings for reference-based re-assignment.

The diarizer (pyannote.py) clusters turns by time. This module does something
different: given a few user-labelled reference spans ("this line is 철수"), it
extracts a voice fingerprint per span so we can match every OTHER line to the
nearest reference voice, even when the auto-diarization split the same person
into several labels or missed them entirely.

Uses the wespeaker embedding model that speaker-diarization-3.1 already pulls
in, so the same HuggingFace token that unlocks diarization works here too."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import structlog

from ai.config import settings
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()

# Below this many seconds the excerpt is too short for a stable embedding; we
# pad it symmetrically up to this length (clamped to the file) before cropping.
_MIN_DUR = 0.6


class SpeakerEmbedder:
    def __init__(self) -> None:
        self._inf: Any = None

    async def load(self) -> None:
        if self._inf is not None:
            return
        if not settings.huggingface_token:
            raise RuntimeError(
                "speaker alignment requires a HuggingFace token. "
                "Set AI_HUGGINGFACE_TOKEN and accept the pyannote model terms."
            )
        import torch
        from pyannote.audio import Inference, Model

        def _load() -> Any:
            model = Model.from_pretrained(
                "pyannote/wespeaker-voxceleb-resnet34-LM",
                token=settings.huggingface_token,
            )
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            # window="whole" → one fixed-size embedding per cropped excerpt.
            return Inference(model, window="whole", device=device)

        async with gpu_lock:
            self._inf = await asyncio.to_thread(_load)
        log.info("embedder_loaded")

    async def embed(
        self, wav_path: Path, spans: list[tuple[float, float]],
    ) -> list[Any]:
        """Return one L2-unnormalized embedding vector (np.ndarray) per span,
        or None for spans that fail (too short, out of range, …)."""
        await self.load()
        import numpy as np
        from pyannote.core import Segment

        # Total duration so we can clamp padded excerpts to the file.
        import soundfile as sf

        from ai.audio.staging import local_copy

        def _run(path: str) -> list[Any]:
            info = sf.info(path)
            total = float(info.frames) / float(info.samplerate or 16000)
            out: list[Any] = []
            for (s, e) in spans:
                lo, hi = float(s), float(e)
                if hi - lo < _MIN_DUR:
                    mid = (lo + hi) / 2.0
                    lo, hi = mid - _MIN_DUR / 2.0, mid + _MIN_DUR / 2.0
                lo = max(0.0, lo)
                hi = min(total, hi)
                if hi - lo <= 0.05:
                    out.append(None)
                    continue
                try:
                    v = self._inf.crop(path, Segment(lo, hi))
                    out.append(np.asarray(v, dtype=np.float32).reshape(-1))
                except Exception as exc:  # noqa: BLE001
                    log.warning("embed_span_failed", start=lo, end=hi, error=str(exc))
                    out.append(None)
            return out

        # torchcodec reader fails on 9p/DrvFs mounts → read from a local copy.
        async with local_copy(wav_path) as local:
            async with gpu_lock:
                return await asyncio.to_thread(_run, str(local))


embedder = SpeakerEmbedder()
