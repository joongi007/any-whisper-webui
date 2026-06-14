"""Range re-transcribe — run Whisper on a [start, end] slice of an existing
job's audio so the user can fix a single hallucinated span without rerunning
the whole pipeline.

Synchronous: API uses NATS request-reply, blocks ~seconds. No new job row,
no event stream — the operation is small enough that a spinner in the UI is
the right affordance."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Any

import structlog

from ai.backends.whisper.base import TranscribeOptions
from ai.backends.whisper.registry import registry
from ai.config import settings

log = structlog.get_logger()


async def retranscribe_range(payload: dict[str, Any]) -> dict[str, Any]:
    """Slice the original 16k mono wav at [t_start, t_end], rerun Whisper on
    just that slice, return new segments with timestamps offset back into the
    original timeline. Returns `{segments: [...]}` on success or
    `{error: str}` on failure."""
    job_id = str(payload["job_id"])
    t_start = float(payload["t_start"])
    t_end = float(payload["t_end"])
    if t_end <= t_start:
        return {"error": "t_end must be > t_start"}

    wav = settings.output_dir / job_id / "input_16k.wav"
    if not wav.exists():
        return {"error": f"audio not found: {wav}"}

    opts_in: dict[str, Any] = payload.get("options") or {}
    backend_name = payload.get("backend") or "faster_whisper"
    model = payload.get("model") or "large-v3-turbo"
    language = payload.get("language") or "auto"
    uvr_cfg = opts_in.get("uvr") or {}
    vad_cfg = opts_in.get("vad") or {}

    # Pad the slice so the model has lead-in/out context and demucs doesn't
    # clip a word at the boundary (design Q1). We transcribe the padded span,
    # then drop anything that falls outside the real [t_start, t_end].
    pad = 0.5
    slice_t0 = max(0.0, t_start - pad)

    cleanup_files: list[Path] = []
    cleanup_dirs: list[Path] = []
    try:
        slice_path = await asyncio.to_thread(_slice_wav, wav, slice_t0, t_end + pad)
        cleanup_files.append(slice_path)
    except Exception as exc:  # noqa: BLE001
        log.exception("retranscribe_slice_failed", job_id=job_id)
        return {"error": f"slice_failed: {exc}"}

    asr_input = slice_path
    try:
        # Region UVR — vocal isolation on just this span. The big win for songs:
        # strip the backing track so whisper hears only the vocal. Demucs writes
        # a nested tree (dst/model/stem/vocals.wav); rmtree the whole temp dir
        # afterwards so these don't accumulate on disk.
        if uvr_cfg.get("enabled"):
            from ai.backends.uvr.demucs import separate_vocals
            # Unique per slice so concurrent/successive calls never collide.
            uvr_dir = settings.output_dir / job_id / f"retranscribe_uvr_{slice_path.stem}"
            cleanup_dirs.append(uvr_dir)
            asr_input = await separate_vocals(
                slice_path, uvr_dir, model=uvr_cfg.get("model", "htdemucs"),
            )

        # Region VAD — compute speech ranges so we can drop segments the model
        # invents over silence/music gaps inside the span.
        speech_ranges = None
        if vad_cfg.get("enabled"):
            speech_ranges = await _vad_ranges(asr_input, float(vad_cfg.get("threshold", 0.5)))
            # Same safety net as the main pipeline: if VAD found NO speech (very
            # common on sung vocals — silero is tuned for speech, not melody),
            # filtering by it would drop everything → empty result. Fall back to
            # no filtering so the retry actually returns text.
            if not speech_ranges:
                log.warning("retranscribe_vad_no_speech_disabling_filter", job_id=job_id)
                speech_ranges = None

        backend = await registry.get(
            backend_name, model=model,
            compute_type=opts_in.get("compute_type", "float16"),
        )
        opts = TranscribeOptions(
            language=language, task="transcribe",
            word_timestamps=bool(opts_in.get("word_timestamps", True)),
            compute_type=opts_in.get("compute_type", "float16"),
            beam_size=int(opts_in.get("beam_size", 5)),
            temperature=float(opts_in.get("temperature", 0.0)),
            initial_prompt=opts_in.get("initial_prompt") or None,
            no_speech_threshold=float(opts_in.get("no_speech_threshold", 0.6)),
            condition_on_previous_text=bool(opts_in.get("condition_on_previous_text", False)),
            compression_ratio_threshold=float(opts_in.get("compression_ratio_threshold", 2.2)),
            log_prob_threshold=float(opts_in.get("log_prob_threshold", -1.0)),
            repetition_penalty=float(opts_in.get("repetition_penalty", 1.0)),
            hallucination_silence_threshold=opts_in.get("hallucination_silence_threshold"),
        )
        seg_iter, _meta = backend.transcribe_iter(asr_input, opts)
        out: list[dict[str, Any]] = []
        async for seg in seg_iter:
            # Slice-local timestamps → parent-transcript timeline.
            abs_start = float(seg.start) + slice_t0
            abs_end = float(seg.end) + slice_t0
            # Drop the padding overhang: keep only segments that overlap the
            # real selection. Then clamp to the selection edges.
            if abs_end <= t_start or abs_start >= t_end:
                continue
            if speech_ranges is not None and not _overlaps_any(
                float(seg.start), float(seg.end), speech_ranges,
            ):
                continue
            abs_start = max(abs_start, t_start)
            abs_end = min(abs_end, t_end)
            out.append({
                "start": abs_start,
                "end": abs_end,
                "text": seg.text,
                "words": _shift_words(seg.words, slice_t0),
            })
        return {"segments": out}
    except Exception as exc:  # noqa: BLE001
        log.exception("retranscribe_failed", job_id=job_id)
        return {"error": str(exc)}
    finally:
        import shutil
        for p in cleanup_files:
            try:
                p.unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass
        for d in cleanup_dirs:
            try:
                shutil.rmtree(d, ignore_errors=True)
            except Exception:  # noqa: BLE001
                pass


def _overlaps_any(start: float, end: float, ranges) -> bool:
    return any(max(start, r.start) < min(end, r.end) for r in ranges)


async def _vad_ranges(wav_path: Path, threshold: float):
    import soundfile as sf

    from ai.backends.vad.silero import vad

    def _read():
        return sf.read(str(wav_path), dtype="float32", always_2d=False)

    samples, _ = await asyncio.to_thread(_read)
    return await vad.speech_ranges(samples, threshold)


def _slice_wav(src: Path, t_start: float, t_end: float) -> Path:
    """Write [t_start, t_end] of `src` to a temp 16k mono wav and return its
    path. Caller is responsible for unlinking."""
    import soundfile as sf

    samples, sr = sf.read(str(src), dtype="float32", always_2d=False)
    if sr <= 0:
        raise RuntimeError("invalid sample rate")
    i0 = max(0, int(t_start * sr))
    i1 = min(len(samples), int(t_end * sr))
    if i1 <= i0:
        raise RuntimeError("empty slice")
    sliced = samples[i0:i1]
    tmp = Path(tempfile.mkstemp(prefix="retranscribe_", suffix=".wav")[1])
    sf.write(str(tmp), sliced, sr)
    return tmp


def _shift_words(words: list[dict] | None, offset: float) -> list[dict] | None:
    if not words:
        return words
    out = []
    for w in words:
        nw = dict(w)
        if "start" in nw:
            nw["start"] = float(nw["start"]) + offset
        if "end" in nw:
            nw["end"] = float(nw["end"]) + offset
        out.append(nw)
    return out
