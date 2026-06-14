from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import structlog

from ai.config import settings
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()


@dataclass(slots=True)
class SpeakerTurn:
    start: float
    end: float
    speaker: str


class PyannoteDiarizer:
    def __init__(self) -> None:
        self._pipe: Any = None

    async def load(self) -> None:
        if self._pipe is not None:
            return
        if not settings.huggingface_token:
            raise RuntimeError(
                "pyannote requires HuggingFace token. "
                "Set AI_HUGGINGFACE_TOKEN and accept model terms."
            )
        import torch
        from pyannote.audio import Pipeline

        def _load() -> Any:
            # pyannote.audio 3.x dropped `use_auth_token` in favour of `token`.
            # Pin is `>=3.3` in pyproject — old kwarg raises TypeError surfaced
            # to the user as a confusing "unexpected keyword argument".
            p = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                token=settings.huggingface_token,
            )
            if torch.cuda.is_available():
                p.to(torch.device("cuda"))
            return p

        async with gpu_lock:
            self._pipe = await asyncio.to_thread(_load)
        log.info("diarize_loaded")

    async def diarize(
        self, wav_path: Path, *,
        min_speakers: int | None = None, max_speakers: int | None = None,
    ) -> list[SpeakerTurn]:
        await self.load()

        def _run() -> Any:
            kw: dict[str, Any] = {}
            if min_speakers:
                kw["min_speakers"] = min_speakers
            if max_speakers:
                kw["max_speakers"] = max_speakers
            return self._pipe(str(wav_path), **kw)

        async with gpu_lock:
            diar = await asyncio.to_thread(_run)

        # pyannote.audio 4.x wraps the result in a DiarizeOutput dataclass; the
        # Annotation (with itertracks) lives on `.speaker_diarization`. 3.x
        # returned the Annotation directly. Support both.
        annotation = getattr(diar, "speaker_diarization", diar)

        turns: list[SpeakerTurn] = []
        for turn, _, label in annotation.itertracks(yield_label=True):
            turns.append(SpeakerTurn(start=float(turn.start), end=float(turn.end), speaker=str(label)))
        return turns


diarizer = PyannoteDiarizer()


def assign_speakers(segments: list[dict], turns: list[SpeakerTurn]) -> None:
    if not turns:
        return
    for seg in segments:
        s_start, s_end = float(seg["start"]), float(seg["end"])
        best, best_ov = None, 0.0
        for t in turns:
            ov = max(0.0, min(s_end, t.end) - max(s_start, t.start))
            if ov > best_ov:
                best_ov, best = ov, t.speaker
        if best:
            seg["speaker"] = best
