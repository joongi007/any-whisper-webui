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
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()

_HF = {
    "tiny": "openai/whisper-tiny",
    "base": "openai/whisper-base",
    "small": "openai/whisper-small",
    "medium": "openai/whisper-medium",
    "large-v2": "openai/whisper-large-v2",
    "large-v3": "openai/whisper-large-v3",
    "large-v3-turbo": "openai/whisper-large-v3-turbo",
}


class InsanelyFastBackend(TranscribeBackend):
    name = "insanely_fast_whisper"

    def __init__(self) -> None:
        self._pipe: Any = None
        self._key: tuple[str, str] | None = None

    async def load(self, model_size: str, device: str, compute_type: str) -> None:
        key = (model_size, device)
        if self._pipe is not None and self._key == key:
            return
        if device != "cuda":
            raise RuntimeError("insanely-fast-whisper requires CUDA")
        import torch
        from transformers import pipeline

        hf = _HF.get(model_size, model_size)
        dtype = torch.float16 if compute_type in ("float16", "fp16") else torch.float32

        def _load() -> Any:
            try:
                return pipeline(
                    "automatic-speech-recognition", model=hf, torch_dtype=dtype, device="cuda:0",
                    model_kwargs={"attn_implementation": "flash_attention_2"},
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("flash_attention_unavailable", error=str(exc))
                return pipeline("automatic-speech-recognition", model=hf, torch_dtype=dtype, device="cuda:0")

        async with gpu_lock:
            self._pipe = await asyncio.to_thread(_load)
            self._key = key
        log.info("model_loaded", backend=self.name, model=hf, device=device)

    def transcribe_iter(
        self, audio_path: Path, opts: TranscribeOptions,
    ) -> tuple[AsyncIterator[StreamSegment], TranscribeResult]:
        if self._pipe is None:
            raise RuntimeError("insanely_fast not loaded")
        result = TranscribeResult()

        async def _iter() -> AsyncIterator[StreamSegment]:
            async with gpu_lock:
                def _run() -> dict:
                    gen_kwargs: dict = {"task": opts.task}
                    if opts.language != "auto":
                        gen_kwargs["language"] = opts.language
                    # Hallucination guards available through HF transformers generate().
                    if opts.repetition_penalty != 1.0:
                        gen_kwargs["repetition_penalty"] = opts.repetition_penalty
                    # no_repeat_ngram_size is the closest analog to repetition_penalty for
                    # the loop-on-silence failure mode; enable when the user dialed it up.
                    if opts.repetition_penalty > 1.0:
                        gen_kwargs["no_repeat_ngram_size"] = 3
                    return self._pipe(
                        str(audio_path), chunk_length_s=30, batch_size=24,
                        return_timestamps="word" if opts.word_timestamps else True,
                        generate_kwargs=gen_kwargs,
                    )
                data = await asyncio.to_thread(_run)

            seg_start: float | None = None
            seg_end: float | None = None
            seg_text = ""
            words: list[dict] = []
            for c in data.get("chunks", []) or []:
                ts = c.get("timestamp") or (None, None)
                start, end = ts
                if start is None or end is None:
                    continue
                if seg_start is None:
                    seg_start = float(start)
                seg_end = float(end)
                seg_text += c.get("text", "")
                words.append({"start": float(start), "end": float(end), "word": c.get("text", "")})
                if seg_end - seg_start >= 5.0:
                    yield StreamSegment(start=seg_start, end=seg_end, text=seg_text.strip(), words=list(words))
                    seg_start = None; seg_end = None; seg_text = ""; words = []
            if seg_start is not None and seg_end is not None and seg_text.strip():
                yield StreamSegment(start=seg_start, end=seg_end, text=seg_text.strip(), words=list(words))

        return _iter(), result

    async def unload(self) -> None:
        self._pipe = None
        self._key = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass
