from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import structlog

from ai.backends.whisper.base import (
    StreamSegment,
    TranscribeBackend,
    TranscribeOptions,
    TranscribeResult,
)
from ai.config import settings
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()


class OpenAIWhisperBackend(TranscribeBackend):
    name = "openai_whisper"

    def __init__(self) -> None:
        self._model: Any = None
        self._device: str = "cpu"
        self._key: tuple[str, str] | None = None

    async def load(self, model_size: str, device: str, compute_type: str) -> None:
        key = (model_size, device)
        if self._model is not None and self._key == key:
            return
        import whisper

        def _load():
            return whisper.load_model(model_size, device=device, download_root=str(settings.model_cache_dir))

        async with gpu_lock:
            self._model = await asyncio.to_thread(_load)
            self._device = device
            self._key = key
        log.info("model_loaded", backend=self.name, model=model_size, device=device)

    def transcribe_iter(
        self, audio_path: Path, opts: TranscribeOptions,
    ) -> tuple[AsyncIterator[StreamSegment], TranscribeResult]:
        if self._model is None:
            raise RuntimeError("openai_whisper not loaded")
        language = None if opts.language == "auto" else opts.language
        result = TranscribeResult()

        async def _iter() -> AsyncIterator[StreamSegment]:
            async with gpu_lock:
                def _run() -> dict:
                    return self._model.transcribe(
                        str(audio_path),
                        language=language, task=opts.task,
                        word_timestamps=opts.word_timestamps,
                        verbose=None, fp16=(self._device == "cuda"),
                        initial_prompt=opts.initial_prompt,
                        # Hallucination guards (openai-whisper API names).
                        no_speech_threshold=opts.no_speech_threshold,
                        condition_on_previous_text=opts.condition_on_previous_text,
                        compression_ratio_threshold=opts.compression_ratio_threshold,
                        logprob_threshold=opts.log_prob_threshold,
                        # repetition_penalty unsupported by openai-whisper
                    )
                data = await asyncio.to_thread(_run)
            result.language = data.get("language")
            for seg in data.get("segments", []):
                words = []
                for w in seg.get("words") or []:
                    words.append({
                        "start": float(w.get("start", seg["start"])),
                        "end": float(w.get("end", seg["end"])),
                        "word": str(w.get("word", "")),
                    })
                yield StreamSegment(
                    start=float(seg["start"]), end=float(seg["end"]),
                    text=str(seg["text"]), words=words,
                )

        return _iter(), result

    async def unload(self) -> None:
        self._model = None
        self._key = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass
