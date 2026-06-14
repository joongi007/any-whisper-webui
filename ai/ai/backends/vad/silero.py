from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import numpy as np
import structlog

from ai.constants import TARGET_SAMPLE_RATE
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()


@dataclass(slots=True)
class SpeechRange:
    start: float
    end: float


class SileroVAD:
    def __init__(self) -> None:
        self._model: Any = None

    async def load(self) -> None:
        if self._model is not None:
            return
        from silero_vad import load_silero_vad

        async with gpu_lock:
            self._model = await asyncio.to_thread(load_silero_vad, False)
        log.info("vad_loaded")

    async def speech_ranges(self, samples_f32: np.ndarray, threshold: float) -> list[SpeechRange]:
        await self.load()
        import torch
        from silero_vad import get_speech_timestamps

        def _run() -> list[dict]:
            return get_speech_timestamps(
                torch.from_numpy(samples_f32), self._model,
                sampling_rate=TARGET_SAMPLE_RATE, threshold=threshold,
            )

        async with gpu_lock:
            ranges = await asyncio.to_thread(_run)
        return [SpeechRange(start=r["start"] / TARGET_SAMPLE_RATE, end=r["end"] / TARGET_SAMPLE_RATE)
                for r in ranges]

    def predict_chunk(self, chunk_f32: np.ndarray, threshold: float) -> tuple[bool, float]:
        """Returns (is_speech, raw_probability). Caller may log the probability for
        threshold tuning. Note: the model is stateful, so callers handling distinct
        streams should call ``reset_states()`` at stream start."""
        if self._model is None:
            raise RuntimeError("VAD not loaded")
        import torch
        with torch.no_grad():
            prob = float(self._model(torch.from_numpy(chunk_f32), TARGET_SAMPLE_RATE).item())
        return prob >= threshold, prob

    def reset_states(self) -> None:
        if self._model is not None and hasattr(self._model, "reset_states"):
            self._model.reset_states()


vad = SileroVAD()
