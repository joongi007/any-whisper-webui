from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
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

_SENT_END = (".", "?", "!", "。", "？", "！", "…")


def _resegment(segments, cancel_event, *, max_gap=0.8, max_dur=8.0, max_chars=84):
    """Regroup batched word timestamps into natural subtitle segments so batched
    output reads like sequential output.

    Batched inference chunks audio by VAD and decodes chunks independently, so
    its segment boundaries differ from sequential. We flatten the word-level
    timestamps and re-cut on a silence gap, sentence-ending punctuation, or a
    max length/duration — the same intuition a human uses to split subtitles.
    Returns a list of segment-like objects (.start/.end/.text/.words)."""
    words = []
    for s in segments:
        if cancel_event.is_set():
            break
        for w in (s.words or []):
            words.append(w)
    if not words:
        return []
    groups: list[list] = []
    cur: list = []
    for w in words:
        if cur:
            gap = float(w.start) - float(cur[-1].end)
            dur = float(w.end) - float(cur[0].start)
            text = "".join(x.word for x in cur)
            ends = cur[-1].word.strip().endswith(_SENT_END)
            if gap > max_gap or dur > max_dur or len(text) >= max_chars or ends:
                groups.append(cur)
                cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return [
        SimpleNamespace(
            start=g[0].start, end=g[-1].end,
            text="".join(x.word for x in g), words=g,
        )
        for g in groups
    ]


class FasterWhisperBackend(TranscribeBackend):
    name = "faster_whisper"

    def __init__(self) -> None:
        self._model: Any = None
        self._key: tuple[str, str, str] | None = None

    async def load(self, model_size: str, device: str, compute_type: str) -> None:
        key = (model_size, device, compute_type)
        if self._model is not None and self._key == key:
            return
        from faster_whisper import WhisperModel

        def _load():
            return WhisperModel(
                model_size, device=device, compute_type=compute_type,
                download_root=str(settings.model_cache_dir),
            )

        async with gpu_lock:
            self._model = await asyncio.to_thread(_load)
            self._key = key
        log.info("model_loaded", backend=self.name, model=model_size, device=device, compute=compute_type)

    def transcribe_iter(
        self, audio_path: Path, opts: TranscribeOptions,
    ) -> tuple[AsyncIterator[StreamSegment], TranscribeResult]:
        if self._model is None:
            raise RuntimeError("faster_whisper not loaded")
        language = None if opts.language == "auto" else opts.language
        result = TranscribeResult()
        info_holder: dict[str, Any] = {}

        queue: asyncio.Queue = asyncio.Queue(maxsize=64)
        loop = asyncio.get_running_loop()
        # Cooperative cancellation. faster-whisper runs in a worker thread that
        # can't be force-killed; instead we set this and the thread checks it at
        # every segment boundary, so cancel takes effect within one segment
        # (~seconds) instead of waiting for the whole file to transcribe.
        cancel_event = threading.Event()

        def _runner() -> None:
            try:
                if opts.batch_size and opts.batch_size > 1:
                    # Batched path: the pipeline chunks by VAD and runs the chunks
                    # as a batch. It requires vad_filter=True and accepts a smaller
                    # kwarg set than the sequential model (no per-call hallucination
                    # guards), so keep this list minimal.
                    from faster_whisper import BatchedInferencePipeline
                    pipe = BatchedInferencePipeline(model=self._model)
                    # Place chunk boundaries on low-speech regions so words don't
                    # get cut mid-utterance — the WhisperX "cut & merge" insight
                    # that keeps batched WER on par with sequential.
                    segments, info = pipe.transcribe(
                        str(audio_path), batch_size=opts.batch_size,
                        language=language, task=opts.task,
                        word_timestamps=opts.word_timestamps,
                        beam_size=opts.beam_size, temperature=opts.temperature,
                        vad_filter=True,
                        vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 400},
                    )
                else:
                    tx_kwargs = dict(
                        language=language, task=opts.task,
                        word_timestamps=opts.word_timestamps,
                        beam_size=opts.beam_size, temperature=opts.temperature,
                        initial_prompt=opts.initial_prompt, vad_filter=False,
                        # Hallucination guards (see base.TranscribeOptions).
                        no_speech_threshold=opts.no_speech_threshold,
                        condition_on_previous_text=opts.condition_on_previous_text,
                        compression_ratio_threshold=opts.compression_ratio_threshold,
                        log_prob_threshold=opts.log_prob_threshold,
                        repetition_penalty=opts.repetition_penalty,
                    )
                    if opts.hallucination_silence_threshold is not None:
                        tx_kwargs["hallucination_silence_threshold"] = opts.hallucination_silence_threshold
                    segments, info = self._model.transcribe(str(audio_path), **tx_kwargs)
                info_holder["language"] = info.language
                info_holder["duration"] = info.duration
                # Batched output is re-segmented from word timestamps so its
                # subtitle boundaries match sequential output (see _resegment).
                seg_source = segments
                if opts.batch_size and opts.batch_size > 1 and opts.word_timestamps:
                    seg_source = _resegment(segments, cancel_event)
                # `segments` is a lazy generator — each `next()` runs the next
                # chunk of inference. Checking the flag here means cancel stops
                # further inference, not just consumption.
                for seg in seg_source:
                    if cancel_event.is_set():
                        break
                    words = [{"start": float(w.start), "end": float(w.end), "word": w.word}
                             for w in (seg.words or [])]
                    out = StreamSegment(
                        start=float(seg.start), end=float(seg.end),
                        text=seg.text, words=words,
                    )
                    asyncio.run_coroutine_threadsafe(queue.put(out), loop).result()
                asyncio.run_coroutine_threadsafe(queue.put(None), loop).result()
            except BaseException as exc:  # noqa: BLE001
                try:
                    asyncio.run_coroutine_threadsafe(queue.put(exc), loop).result()
                except Exception:  # noqa: BLE001 — loop/queue may be gone on teardown
                    pass

        async def _drain_until_done(fut: asyncio.Task) -> None:
            # Keep emptying the queue so the worker's blocking put() can return
            # and the thread reaches its `break`, then exits. Without this the
            # thread could deadlock on a full queue after we stop consuming.
            while not fut.done():
                try:
                    await asyncio.wait_for(queue.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    pass
                except Exception:  # noqa: BLE001
                    break

        async def _iter() -> AsyncIterator[StreamSegment]:
            async with gpu_lock:
                fut = asyncio.create_task(asyncio.to_thread(_runner))
                try:
                    while True:
                        item = await queue.get()
                        if item is None:
                            break
                        if isinstance(item, BaseException):
                            raise item
                        yield item
                finally:
                    # Tell the worker to stop at the next boundary, then wind it
                    # down. Shielded so an in-flight cancel can't abandon the
                    # worker mid-GPU-op (which would corrupt the next job).
                    cancel_event.set()
                    if not fut.done():
                        await asyncio.shield(_drain_until_done(fut))
            result.language = info_holder.get("language")
            result.duration_sec = info_holder.get("duration")

        return _iter(), result

    async def unload(self) -> None:
        self._model = None
        self._key = None
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass
