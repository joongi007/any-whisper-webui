from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import structlog
from nats.aio.subscription import Subscription

from ai import nats_client
from ai.audio.peaks import write_peaks_json
from ai.audio.resample import pcm_s16le_to_float32, rms_dbfs
from ai.backends.vad.silero import vad
from ai.backends.whisper.base import TranscribeOptions
from ai.backends.whisper.registry import registry
from ai.config import settings
from ai.constants import TARGET_SAMPLE_RATE
from ai.pipelines.translate import translate_text

log = structlog.get_logger()

# All active sessions on this worker, keyed by sid. Owned by __main__ once the
# session has been claimed via queue-group req-reply.
sessions: dict[str, "Streamer"] = {}


class Streamer:
    SILENCE_END_MS = 700
    PARTIAL_MIN_BUFFER_MS = 600
    PARTIAL_INTERVAL_MS = 600

    # 1 hour @ 16kHz mono PCM_16 = ~115MB. Single-user local app, so we accept
    # holding the whole session in RAM. Hard ceiling guards against runaway
    # sessions (e.g. forgotten tab) — past this we stop appending so the
    # process doesn't OOM. The user still gets transcript + whatever fit.
    MAX_PERSISTED_BYTES = 256 * 1024 * 1024  # ~22 min at 16kHz mono PCM_16

    def __init__(self, sid: str, cfg: dict[str, Any]) -> None:
        self.sid = sid
        self.cfg = cfg
        self._buf = bytearray()
        # Full-session PCM accumulator. The per-utterance `_buf` above gets
        # cleared after each final flush; this one keeps everything so the
        # History page can play back what the model heard.
        self._full_pcm = bytearray()
        self._full_truncated = False
        self._speech_active = False
        self._last_speech_ms: float | None = None
        self._utt_start_ms: float | None = None
        self._last_partial_ms = 0.0
        self._t0 = time.monotonic()
        self._stopped = False
        self._subs: list[Subscription] = []
        self._chunk_count = 0
        self._vad_calls = 0
        self._last_meter_ms = 0.0
        self._last_level_ms = 0.0

    @property
    def _now_ms(self) -> float:
        return (time.monotonic() - self._t0) * 1000.0

    async def setup(self) -> None:
        await registry.get(self.cfg["backend"], model=self.cfg["model"])
        if (self.cfg.get("vad") or {}).get("enabled", True):
            await vad.load()
            # silero is stateful — reset between sessions so leftover LSTM state
            # from a prior speaker doesn't bias the first second of speech to
            # appear non-speech.
            vad.reset_states()

    async def start(self) -> None:
        # Worker-scoped subjects: only THIS ai instance receives chunks for this sid.
        # api obtained our worker_id via the req-reply on `realtime.start`.
        base = f"realtime.worker.{settings.worker_id}.{self.sid}"
        self._subs.append(await nats_client.nc().subscribe(f"{base}.chunk",  cb=self._on_chunk))
        self._subs.append(await nats_client.nc().subscribe(f"{base}.flush",  cb=self._on_flush))
        self._subs.append(await nats_client.nc().subscribe(f"{base}.stop",   cb=self._on_stop))
        self._subs.append(await nats_client.nc().subscribe(f"{base}.config", cb=self._on_config))

        # Outbound responses stay session-scoped (one publisher per sid → no conflict).
        await nats_client.publish_plain(
            f"realtime.{self.sid}.ready",
            {"session_id": self.sid, "worker_id": settings.worker_id},
        )

    async def _on_chunk(self, msg) -> None:
        # NATS callback — uncaught exceptions here are silently swallowed by the
        # client. Wrap to surface them in the log.
        try:
            await self._handle_pcm(msg.data)
        except Exception:  # noqa: BLE001
            log.exception("rt_chunk_handler_failed", sid=self.sid, bytes=len(msg.data) if msg.data else 0)

    async def _on_flush(self, _msg) -> None:
        if self._speech_active:
            await self._flush_final()

    async def _on_stop(self, _msg) -> None:
        await self.cleanup()

    async def _on_config(self, msg) -> None:
        """Live config tweak from the UI (VAD threshold, etc.). Shallow-merge
        into self.cfg so subsequent _handle_pcm calls pick the new values up."""
        import json
        try:
            patch = json.loads(msg.data.decode()) if msg.data else {}
        except json.JSONDecodeError:
            return
        for k, v in patch.items():
            if isinstance(v, dict) and isinstance(self.cfg.get(k), dict):
                self.cfg[k] = {**self.cfg[k], **v}
            else:
                self.cfg[k] = v
        log.info("rt_config_updated", sid=self.sid, keys=list(patch.keys()))

    @property
    def _record_enabled(self) -> bool:
        # Default ON (user preference) — only skip when explicitly disabled.
        return self.cfg.get("record", True) is not False

    async def _handle_pcm(self, data: bytes) -> None:
        if self._stopped:
            return
        self._chunk_count += 1
        if self._chunk_count == 1:
            log.info("rt_first_chunk", sid=self.sid, bytes=len(data))
        # Capture EVERY chunk (speech or not) for playback. VAD-gated buffer
        # below is for transcription; this one is for the History audio player.
        # Skipped entirely when recording is off (privacy / disk preference).
        if self._record_enabled and not self._full_truncated:
            if len(self._full_pcm) + len(data) <= self.MAX_PERSISTED_BYTES:
                self._full_pcm.extend(data)
            else:
                self._full_truncated = True
                log.warning("rt_audio_truncated",
                            sid=self.sid, bytes=len(self._full_pcm))
        samples = pcm_s16le_to_float32(data)
        # Throttle level meter to ~10Hz — chunks arrive every ~10ms, and the
        # UI bar can't usefully animate faster than that anyway.
        if self._now_ms - self._last_level_ms > 100:
            await nats_client.publish_plain(
                f"realtime.{self.sid}.level", {"rms_db": rms_dbfs(samples)},
            )
            self._last_level_ms = self._now_ms

        is_speech = True
        if (self.cfg.get("vad") or {}).get("enabled", True):
            is_speech = await self._vad_decide(samples, float((self.cfg.get("vad") or {}).get("threshold", 0.5)))

        if is_speech:
            self._buf.extend(data)
            if not self._speech_active:
                self._speech_active = True
                self._utt_start_ms = self._now_ms
                self._last_partial_ms = self._now_ms
                log.info("rt_speech_start", sid=self.sid)
                await nats_client.publish_plain(
                    f"realtime.{self.sid}.vad", {"speech": True},
                )
            self._last_speech_ms = self._now_ms
            await self._maybe_partial()
        elif self._speech_active and self._last_speech_ms is not None:
            if self._now_ms - self._last_speech_ms > self.SILENCE_END_MS:
                log.info("rt_speech_end_flush", sid=self.sid, buf_ms=len(self._buf) / 32.0)
                await self._flush_final()

    async def _vad_decide(self, samples_f32, threshold: float) -> bool:
        window = 512
        max_prob = 0.0
        if samples_f32.size < window:
            chunk = np.pad(samples_f32, (0, window - samples_f32.size)).astype(np.float32)
            ok, prob = vad.predict_chunk(chunk, threshold)
            max_prob = prob
        else:
            ok = False
            for i in range(0, samples_f32.size - window + 1, window):
                ok_i, prob_i = vad.predict_chunk(samples_f32[i:i + window].astype(np.float32), threshold)
                max_prob = max(max_prob, prob_i)
                if ok_i:
                    ok = True
                    break
        self._vad_calls += 1
        # First 5 decisions: log raw probability so a misconfigured threshold or
        # silent stream surfaces immediately. After that, only on state change.
        if self._vad_calls <= 5:
            log.info("rt_vad_decide", sid=self.sid, call=self._vad_calls,
                     speech=ok, prob=round(max_prob, 3), threshold=threshold)
        # Throttled meter for the UI — every ~150ms is plenty for a live bar.
        if self._now_ms - self._last_meter_ms > 150:
            await nats_client.publish_plain(
                f"realtime.{self.sid}.vad_meter",
                {"prob": round(max_prob, 4), "threshold": threshold, "speech": ok},
            )
            self._last_meter_ms = self._now_ms
        return ok

    async def _maybe_partial(self) -> None:
        if self._now_ms - self._last_partial_ms < self.PARTIAL_INTERVAL_MS:
            return
        bytes_per_ms = (TARGET_SAMPLE_RATE * 1 * 2) / 1000.0
        if len(self._buf) / bytes_per_ms < self.PARTIAL_MIN_BUFFER_MS:
            return
        text = await self._transcribe(self._buf)
        if text:
            await nats_client.publish_plain(f"realtime.{self.sid}.partial", {
                "start": (self._utt_start_ms or 0) / 1000.0,
                "end": self._now_ms / 1000.0,
                "text": text,
            })
        self._last_partial_ms = self._now_ms

    async def _flush_final(self) -> None:
        text = await self._transcribe(self._buf)
        log.info("rt_final_transcribed", sid=self.sid, text_len=len(text), text_preview=text[:40])
        translation = None
        tr_cfg = self.cfg.get("translate_text") or {}
        if text and tr_cfg.get("enabled"):
            try:
                translation = await translate_text(
                    text,
                    source_lang=self.cfg.get("language", "auto"),
                    target_lang=tr_cfg.get("target_lang", "en"),
                    provider=tr_cfg.get("provider", "nllb"),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("realtime_translate_failed", error=str(exc))

        if text:
            await nats_client.publish_plain(f"realtime.{self.sid}.final", {
                "start": (self._utt_start_ms or 0) / 1000.0,
                "end": (self._last_speech_ms or self._now_ms) / 1000.0,
                "text": text, "speaker": None,
                "translation": (
                    {"provider": (tr_cfg.get("provider", "nllb")),
                     "target_lang": tr_cfg.get("target_lang", "en"),
                     "text": translation}
                    if translation is not None else None
                ),
            })
        await nats_client.publish_plain(f"realtime.{self.sid}.vad", {"speech": False})
        self._speech_active = False
        self._buf = bytearray()
        self._utt_start_ms = None
        self._last_speech_ms = None

    async def _transcribe(self, buf: bytearray) -> str:
        if not buf:
            return ""
        backend = await registry.get(self.cfg["backend"], model=self.cfg["model"])
        tmp = settings.output_dir / "realtime" / f"chunk-{int(time.time()*1000)}.wav"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        samples = pcm_s16le_to_float32(bytes(buf))

        def _write() -> None:
            sf.write(str(tmp), samples, TARGET_SAMPLE_RATE, subtype="PCM_16")

        await asyncio.to_thread(_write)
        try:
            # Realtime hallucinates badly with `condition_on_previous_text=True`
            # because each utterance is fed independently — the model loops on
            # the last phrase it saw. Force-disable here regardless of cfg.
            opts_in = self.cfg.get("options") or {}
            seg_iter, _ = backend.transcribe_iter(Path(tmp), TranscribeOptions(
                language=self.cfg.get("language", "auto"),
                task=self.cfg.get("task", "transcribe"),
                word_timestamps=False, beam_size=1, temperature=0.0,
                no_speech_threshold=float(opts_in.get("no_speech_threshold", 0.6)),
                condition_on_previous_text=False,
                compression_ratio_threshold=float(opts_in.get("compression_ratio_threshold", 2.4)),
                log_prob_threshold=float(opts_in.get("log_prob_threshold", -1.0)),
                repetition_penalty=float(opts_in.get("repetition_penalty", 1.0)),
            ))
            parts: list[str] = []
            async for seg in seg_iter:
                parts.append(seg.text)
            return "".join(parts).strip()
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass

    async def cleanup(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        try:
            if self._speech_active:
                await self._flush_final()
        except Exception:  # noqa: BLE001
            pass
        for s in self._subs:
            try:
                await s.unsubscribe()
            except Exception:  # noqa: BLE001
                pass
        # Persist the full PCM as input_16k.wav — same path the file/youtube
        # pipelines write to, so /api/v1/transcripts/{sid}/audio Just Works
        # against the History detail page's WaveformPlayer.
        if self._full_pcm:
            try:
                await self._persist_audio()
            except Exception:  # noqa: BLE001
                log.exception("rt_persist_audio_failed", sid=self.sid)
        await nats_client.publish_plain(f"realtime.{self.sid}.stopped", {})
        sessions.pop(self.sid, None)

    async def _persist_audio(self) -> None:
        out_dir = settings.output_dir / self.sid
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / "input_16k.wav"
        samples = pcm_s16le_to_float32(bytes(self._full_pcm))

        def _write() -> None:
            sf.write(str(out), samples, TARGET_SAMPLE_RATE, subtype="PCM_16")

        await asyncio.to_thread(_write)
        log.info("rt_audio_persisted", sid=self.sid,
                 bytes=len(self._full_pcm),
                 seconds=round(len(self._full_pcm) / (TARGET_SAMPLE_RATE * 2), 1),
                 truncated=self._full_truncated, path=str(out))
        try:
            await asyncio.to_thread(write_peaks_json, out)
        except Exception:  # noqa: BLE001
            log.warning("rt_peaks_write_failed", sid=self.sid)
