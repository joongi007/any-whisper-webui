from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import structlog

from ai import nats_client
from ai.audio.ffmpeg import probe_duration, to_wav_16k_mono
from ai.audio.peaks import write_peaks_json
from ai.backends.diarize.pyannote import assign_speakers, diarizer
from ai.backends.uvr.demucs import separate_vocals
from ai.backends.whisper.base import TranscribeOptions
from ai.backends.whisper.registry import registry
from ai.config import settings
from ai.constants import (
    STAGE_DIARIZE,
    STAGE_DOWNLOAD,
    STAGE_EXPORT,
    STAGE_PRE_UVR,
    STAGE_PRE_VAD,
    STAGE_TRANSCRIBE,
    STAGE_TRANSLATE,
)
from ai.pipelines.translate import translate_text

log = structlog.get_logger()


async def _publish(job_id: str, leaf: str, body: dict) -> None:
    await nats_client.publish_event(f"jobs.{job_id}.{leaf}", body)


async def _progress(job_id: str, stage: str, progress: float) -> None:
    await _publish(job_id, "progress", {"stage": stage, "progress": progress})


def _overlaps_any(start: float, end: float, ranges) -> bool:
    return any(max(start, r.start) < min(end, r.end) for r in ranges)


def _looks_degraded(rows: list[dict], duration: float, speech_ranges) -> bool:
    """Heuristic: did batched inference produce obviously broken output?

    BatchedInferencePipeline is fast and usually fine, but on some audio it
    fails hard (repetition loops, near-empty output, dropped segments). We catch
    those cases so the pipeline can fall back to sequential. Tuned conservatively
    — only flags clear breakage, not the normal minor wording differences."""
    if not rows:
        # Speech was detected but batch produced nothing → broken.
        return bool(speech_ranges)
    texts = [(r.get("text") or "").strip() for r in rows]
    # 1) Repetition loop: many consecutive identical segments.
    if len(texts) >= 5:
        dups = sum(1 for i in range(1, len(texts)) if texts[i] and texts[i] == texts[i - 1])
        if dups / len(texts) > 0.3:
            return True
    # 2) Near-empty despite audio: extremely low character rate over speech.
    total_chars = sum(len(t) for t in texts)
    if duration > 1.0 and speech_ranges and total_chars / duration < 0.3:
        return True
    return False


async def _vad_ranges(wav_path: Path, threshold: float):
    import soundfile as sf

    from ai.backends.vad.silero import vad

    def _read():
        return sf.read(str(wav_path), dtype="float32", always_2d=False)

    samples, _ = await asyncio.to_thread(_read)
    return await vad.speech_ranges(samples, threshold)


async def _resolve_source(job_id: str, source: dict) -> Path:
    kind = source["kind"]
    if kind == "file":
        orig = Path(source["storage_path"])
    elif kind == "youtube":
        from ai.pipelines.youtube import download_audio
        orig, _ = await download_audio(source["url"], settings.output_dir / job_id / "youtube")
    else:
        raise RuntimeError(f"unknown source kind: {kind}")

    wav = settings.output_dir / job_id / "input_16k.wav"
    await to_wav_16k_mono(orig, wav)
    # Pre-compute waveform peaks so the History audio player renders instantly
    # instead of waiting on a 5s in-browser decode. Failure is non-fatal — the
    # UI just falls back to client-side decode.
    try:
        await asyncio.to_thread(write_peaks_json, wav)
    except Exception:  # noqa: BLE001
        log.warning("peaks_write_failed", job_id=job_id)
    return wav


def _classify_error(exc: BaseException) -> str:
    msg = str(exc).lower()
    if "out of memory" in msg or "cuda oom" in msg:
        return "oom"
    if "huggingface" in msg or "gated" in msg or "use_auth_token" in msg or "fine-grained" in msg:
        return "gated_model"
    # YouTube download failures — yt-dlp 403 (bot wall / outdated yt-dlp),
    # private/age-gated, or removed videos. The UI shows a tailored fix.
    if ("unable to download" in msg or "downloaderror" in msg
            or "http error 403" in msg or "yt_dlp" in msg
            or "video unavailable" in msg or "private video" in msg
            or "sign in to confirm" in msg):
        return "youtube_blocked"
    return "internal_error"


async def run_transcribe(msg: dict[str, Any]) -> None:
    job_id = msg["job_id"]
    log.info("job_received", job_id=job_id, kind="transcribe")
    try:
        await _progress(job_id, STAGE_DOWNLOAD, 0.02)
        wav = await _resolve_source(job_id, msg["source"])
        duration = await probe_duration(wav) or 0.0

        pre = msg.get("preprocess", {}) or {}
        post = msg.get("postprocess", {}) or {}
        opts_in = msg.get("options", {}) or {}

        asr_input = wav
        uvr_cfg = pre.get("uvr") or {}
        if uvr_cfg.get("enabled"):
            await _progress(job_id, STAGE_PRE_UVR, 0.10)
            asr_input = await separate_vocals(wav, settings.output_dir / job_id / "uvr",
                                              model=uvr_cfg.get("model", "htdemucs"))

        speech_ranges = None
        vad_cfg = pre.get("vad") or {}
        if vad_cfg.get("enabled"):
            await _progress(job_id, STAGE_PRE_VAD, 0.18)
            speech_ranges = await _vad_ranges(asr_input, float(vad_cfg.get("threshold", 0.5)))
            # Safety: if VAD found NO speech (bad threshold, music, quiet mic),
            # filtering by it would drop every segment → empty transcript. Fall
            # back to no filtering so the user gets *something* rather than a
            # blank result they have to manually retry. This is the root cause
            # of "first run empty, retry works".
            if not speech_ranges:
                log.warning("vad_found_no_speech_disabling_filter", job_id=job_id)
                speech_ranges = None

        await _progress(job_id, STAGE_TRANSCRIBE, 0.20)
        backend = await registry.get(
            msg["backend"], model=msg["model"],
            compute_type=opts_in.get("compute_type", "float16"),
        )
        opts = TranscribeOptions(
            language=msg["language"], task=msg.get("task", "transcribe"),
            word_timestamps=bool(opts_in.get("word_timestamps", True)),
            compute_type=opts_in.get("compute_type", "float16"),
            beam_size=int(opts_in.get("beam_size", 5)),
            temperature=float(opts_in.get("temperature", 0.0)),
            batch_size=int(opts_in.get("batch_size", 0)),
            initial_prompt=opts_in.get("initial_prompt") or None,
            # Hallucination guards — UI's Advanced mode forwards these.
            no_speech_threshold=float(opts_in.get("no_speech_threshold", 0.6)),
            condition_on_previous_text=bool(opts_in.get("condition_on_previous_text", False)),
            compression_ratio_threshold=float(opts_in.get("compression_ratio_threshold", 2.4)),
            log_prob_threshold=float(opts_in.get("log_prob_threshold", -1.0)),
            repetition_penalty=float(opts_in.get("repetition_penalty", 1.0)),
            hallucination_silence_threshold=opts_in.get("hallucination_silence_threshold"),
        )
        # Collect one pass without publishing (used for the batch QA gate).
        async def _collect(o) -> tuple[list[dict], Any]:
            it, meta = backend.transcribe_iter(asr_input, o)
            out: list[dict] = []
            async for seg in it:
                if speech_ranges is not None and not _overlaps_any(seg.start, seg.end, speech_ranges):
                    continue
                out.append({
                    "start": seg.start, "end": seg.end, "text": seg.text,
                    "words": seg.words, "speaker": None, "translation": None,
                })
            return out, meta

        collected: list[dict] = []
        result_meta = None
        used_batch = bool(opts.batch_size and opts.batch_size > 1)

        if used_batch:
            # Batch: run quietly, QA the result, fall back to sequential if broken.
            collected, result_meta = await _collect(opts)
            if _looks_degraded(collected, duration, speech_ranges):
                log.warning("batch_output_degraded_fallback_sequential", job_id=job_id)
                opts.batch_size = 0
                used_batch = False
                collected, result_meta = [], None

        if used_batch:
            # Batch passed QA → emit its rows at once (inference already done).
            for row in collected:
                await _publish(job_id, "segment.partial", {
                    "start": row["start"], "end": row["end"], "text": row["text"], "speaker": None,
                })
            await _progress(job_id, STAGE_TRANSCRIBE, 0.74)
        else:
            # Sequential streaming (also the fallback path) — live partials.
            seg_iter, result_meta = backend.transcribe_iter(asr_input, opts)
            async for seg in seg_iter:
                if speech_ranges is not None and not _overlaps_any(seg.start, seg.end, speech_ranges):
                    continue
                row = {
                    "start": seg.start, "end": seg.end, "text": seg.text,
                    "words": seg.words, "speaker": None, "translation": None,
                }
                collected.append(row)
                await _publish(job_id, "segment.partial", {
                    "start": seg.start, "end": seg.end, "text": seg.text, "speaker": None,
                })
                if duration > 0:
                    await _progress(job_id, STAGE_TRANSCRIBE, min(0.74, 0.20 + 0.55 * (seg.end / duration)))

        diar_cfg = post.get("diarize") or {}
        if diar_cfg.get("enabled"):
            await _progress(job_id, STAGE_DIARIZE, 0.78)
            turns = await diarizer.diarize(
                asr_input,
                min_speakers=diar_cfg.get("min_speakers"),
                max_speakers=diar_cfg.get("max_speakers"),
            )
            assign_speakers(collected, turns)

        tr_cfg = post.get("translate_text") or {}
        if tr_cfg.get("enabled"):
            await _progress(job_id, STAGE_TRANSLATE, 0.85)
            tgt = tr_cfg.get("target_lang", "en")
            provider = tr_cfg.get("provider", "nllb")
            src_lang = result_meta.language or "en"
            for row in collected:
                try:
                    row["translation"] = await translate_text(
                        row["text"], source_lang=src_lang, target_lang=tgt, provider=provider,
                    )
                except Exception as exc:  # noqa: BLE001
                    log.warning("translate_failed", error=str(exc))

        await _progress(job_id, STAGE_EXPORT, 0.92)
        for i, row in enumerate(collected, start=1):
            await _publish(job_id, "segment.final", {
                "seq": i, **row,
            })

        # ai writes raw subtitle artifacts to the shared volume for api export.
        out_dir = settings.output_dir / job_id
        out_dir.mkdir(parents=True, exist_ok=True)
        await _publish(job_id, "done", {
            "transcript_id": job_id,
            "language": result_meta.language,
            "duration_sec": result_meta.duration_sec or duration,
            "output_files": [
                {"format": "srt", "path": str(out_dir / "transcript.srt")},
                {"format": "vtt", "path": str(out_dir / "transcript.vtt")},
                {"format": "txt", "path": str(out_dir / "transcript.txt")},
            ],
        })
        log.info("job_done", job_id=job_id, segments=len(collected))

    except asyncio.CancelledError:
        await _publish(job_id, "failed", {"code": "cancelled", "message": "Cancelled"})
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("job_failed", job_id=job_id)
        await _publish(job_id, "failed", {"code": _classify_error(exc), "message": str(exc)})
