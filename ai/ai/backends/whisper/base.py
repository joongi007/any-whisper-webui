from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass(slots=True)
class TranscribeOptions:
    language: str = "auto"
    task: str = "transcribe"
    word_timestamps: bool = True
    initial_prompt: str | None = None
    beam_size: int = 5
    temperature: float = 0.0
    compute_type: str = "float16"
    # 0 / 1 → sequential. >1 → faster-whisper BatchedInferencePipeline with this
    # batch size (chunks the file by VAD and batches the chunks → higher
    # throughput on GPUs with spare VRAM). Only the faster_whisper backend
    # honours this; others run sequentially.
    batch_size: int = 0

    # Hallucination control — Whisper has a known failure mode where on silence
    # or near-silence it loops on a phrase ("thank you. thank you. ..."). These
    # knobs tame it. Defaults are the conservative preset (Simple mode); the
    # Advanced UI lets users override.
    no_speech_threshold: float = 0.6
    condition_on_previous_text: bool = False
    compression_ratio_threshold: float = 2.4
    log_prob_threshold: float = -1.0
    repetition_penalty: float = 1.0
    hallucination_silence_threshold: float | None = None


@dataclass(slots=True)
class StreamSegment:
    start: float
    end: float
    text: str
    words: list[dict] = field(default_factory=list)


@dataclass(slots=True)
class TranscribeResult:
    language: str | None = None
    duration_sec: float | None = None


class TranscribeBackend(Protocol):
    name: str

    async def load(self, model_size: str, device: str, compute_type: str) -> None: ...
    def transcribe_iter(
        self, audio_path: Path, opts: TranscribeOptions,
    ) -> tuple[AsyncIterator[StreamSegment], TranscribeResult]: ...
    async def unload(self) -> None: ...
