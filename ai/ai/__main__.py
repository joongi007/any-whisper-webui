from __future__ import annotations

import asyncio
import json
import signal
from typing import Any

import structlog

from ai import nats_client
from ai.backends.translate.deepl import deepl_translator
from ai.backends.whisper.registry import registry
from ai.config import settings
from ai.gpu_lock import gpu_lock
from ai.logging_setup import setup_logging
from ai.pipelines.transcribe import run_transcribe
from ai.pipelines.translate import translate_text
from ai.realtime.streamer import Streamer, sessions

log = structlog.get_logger()


# ─── Job consumer (WorkQueue — already multi-instance safe) ───────────────────

# job_id → asyncio.Task. Lets the cancel subject look up the running task and
# call .cancel() on it. The pipeline already catches CancelledError and
# publishes a `failed/cancelled` event, so this just lights the wire.
_running_jobs: dict[str, asyncio.Task[None]] = {}


async def _on_job(msg) -> None:
    try:
        payload: dict[str, Any] = json.loads(msg.data.decode())
    except json.JSONDecodeError:
        await msg.ack()
        return
    job_id = payload.get("job_id", "")

    # Long-running transcribe jobs (60-min files take ~5–10 min) blow past
    # JetStream's default 30s ack_wait. Without periodic msg.in_progress(),
    # the message gets marked redeliverable — fine for single worker
    # (serial fetch loop) but in a scale=2+ setup another worker grabs the
    # same job, runs in parallel, and we get duplicate segments in the DB.
    # 10s tick is conservative against the 30s default.
    heartbeat_stop = asyncio.Event()

    async def _heartbeat() -> None:
        try:
            while not heartbeat_stop.is_set():
                try:
                    await asyncio.wait_for(heartbeat_stop.wait(), timeout=10.0)
                    return  # event fired — exit
                except asyncio.TimeoutError:
                    try:
                        await msg.in_progress()
                    except Exception:  # noqa: BLE001
                        log.warning("in_progress_failed", job_id=job_id)
        except asyncio.CancelledError:
            pass

    hb_task = asyncio.create_task(_heartbeat())

    try:
        if msg.subject == "jobs.transcribe":
            task = asyncio.create_task(run_transcribe(payload))
            if job_id:
                _running_jobs[job_id] = task
            try:
                await task
            except asyncio.CancelledError:
                # Pipeline already published the cancelled-failed event; here
                # we just consume the propagation so the NATS callback exits
                # cleanly.
                log.info("job_cancelled_from_signal", job_id=job_id)
        else:
            log.warning("unsupported_job_kind", subject=msg.subject)
    except Exception:  # noqa: BLE001
        log.exception("job_handler_crashed", subject=msg.subject)
    finally:
        heartbeat_stop.set()
        hb_task.cancel()
        try:
            await hb_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        if job_id:
            _running_jobs.pop(job_id, None)
        await msg.ack()


async def _on_job_cancel(msg) -> None:
    """`jobs.{job_id}.cancel` — request the running task stop ASAP. No-op if
    the job isn't on this worker (multi-worker setups: api fans out via plain
    subject so every worker checks). Ack via reply if the requester is
    awaiting acknowledgement; otherwise it's pure fire-and-forget."""
    # Subject shape: "jobs.{job_id}.cancel"
    parts = msg.subject.split(".")
    if len(parts) != 3 or parts[0] != "jobs" or parts[2] != "cancel":
        return
    job_id = parts[1]
    task = _running_jobs.get(job_id)
    if task is None:
        return  # Not ours, or already finished. Silent.
    log.info("job_cancel_signal_received", job_id=job_id)
    task.cancel()


# ─── Req-reply handlers (queue group → one worker answers) ────────────────────

async def _on_system_info(msg) -> None:
    try:
        import torch
        gpu_avail = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_properties(0).name if gpu_avail else None
        vram = int(torch.cuda.get_device_properties(0).total_memory / 1024 / 1024) if gpu_avail else None
        cuda = torch.version.cuda if gpu_avail else None
    except Exception:  # noqa: BLE001
        gpu_avail, gpu_name, vram, cuda = False, None, None, None

    backends = ["faster_whisper", "openai_whisper"]
    if gpu_avail:
        backends.append("insanely_fast_whisper")

    # Real gated-access probe (cached) — distinguishes "token present" from
    # "token can actually pull the pyannote repos". Without this the card said
    # Ready even when diarization would 403.
    from ai.backends.diarize.access import diarize_access, diarize_reason
    diarize_ok = await diarize_access()

    await nats_client.reply(msg, {
        "gpu_available": gpu_avail,
        "gpu_name": gpu_name,
        "vram_total_mb": vram,
        "cuda": cuda,
        "backends": backends,
        "translate_providers": ["nllb"],
        "deepl": bool(settings.deepl_api_key),
        "uvr_models": ["htdemucs"],
        "diarize_available": diarize_ok,
        # `token_present` lets the UI tell apart the two failure modes:
        # no token at all vs. token set but terms not accepted.
        "diarize_token_present": bool(settings.huggingface_token),
        # Precise blocker: None | "no_token" | "terms" | "permission" | "network".
        "diarize_reason": diarize_reason(),
        # Lets the UI show "model warming" vs "model ready" — fixes the
        # silent-first-click case where the user thinks realtime is broken
        # while it's actually waiting on the first load.
        "loaded_models": registry.loaded(),
        "default_backend": settings.prewarm_backend,
        "default_model": settings.prewarm_model,
    })


async def _on_gpu_stats(msg) -> None:
    """Live GPU sampling for the Dashboard. nvidia-smi is preinstalled in the
    container, ~50ms per call, fast enough for a 2-3 second poll interval.
    Falls back to torch counters if nvidia-smi isn't available (CPU-only host)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "nvidia-smi",
            "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
            "--format=csv,noheader,nounits",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=2.0)
        line = out.decode().strip().splitlines()[0]
        parts = [p.strip() for p in line.split(",")]
        # power.draw can be "[N/A]" on some cards
        try:
            power_w: float | None = float(parts[4])
        except (ValueError, IndexError):
            power_w = None
        await nats_client.reply(msg, {
            "available": True,
            "util_pct": int(float(parts[0])),
            "mem_used_mb": int(float(parts[1])),
            "mem_total_mb": int(float(parts[2])),
            "temp_c": int(float(parts[3])),
            "power_w": power_w,
        })
    except Exception as exc:  # noqa: BLE001
        log.warning("gpu_stats_failed", error=str(exc))
        await nats_client.reply(msg, {"available": False})


async def _on_unload_model(msg) -> None:
    try:
        body = json.loads(msg.data.decode()) if msg.data else {}
        ok = await registry.unload(body.get("backend", ""))
        await nats_client.reply(msg, {"ok": ok})
    except Exception as exc:  # noqa: BLE001
        await nats_client.reply(msg, {"ok": False, "error": str(exc)})


async def _on_load_model(msg) -> None:
    try:
        body = json.loads(msg.data.decode()) if msg.data else {}
        await registry.get(body["backend"], model=body["model"])
        await nats_client.reply(msg, {"ok": True, "loaded": registry.loaded()})
    except Exception as exc:  # noqa: BLE001
        await nats_client.reply(msg, {"ok": False, "error": str(exc)})


async def _on_retranscribe(msg) -> None:
    """`ai.retranscribe.run` — slice [t_start, t_end] of an existing job's
    audio, rerun Whisper on just that span, reply with the new segments.

    Synchronous request-reply (no event stream, no DB) so the api can do the
    DB swap atomically once we hand back the result. Sized for selections of
    a few seconds to a few minutes; bigger ranges should kick off a normal
    transcribe job instead."""
    from ai.pipelines.retranscribe import retranscribe_range
    try:
        body = json.loads(msg.data.decode()) if msg.data else {}
    except json.JSONDecodeError:
        await nats_client.reply(msg, {"error": "bad_json"})
        return
    try:
        result = await retranscribe_range(body)
    except Exception as exc:  # noqa: BLE001
        log.exception("retranscribe_handler_failed")
        result = {"error": str(exc)}
    await nats_client.reply(msg, result)


async def _on_benchmark(msg) -> None:
    """`ai.bench.run` — measure sequential / concurrent / batched strategies on
    this hardware and reply with results + a recommendation. Holds the GPU for
    the duration, so it's a deliberate, exclusive operation (can take minutes)."""
    from ai.bench import run_benchmark
    try:
        body = json.loads(msg.data.decode()) if msg.data else {}
    except json.JSONDecodeError:
        await nats_client.reply(msg, {"error": "bad_json"})
        return
    try:
        result = await run_benchmark(body)
    except Exception as exc:  # noqa: BLE001
        log.exception("benchmark_handler_failed")
        result = {"error": str(exc)}
    await nats_client.reply(msg, result)


async def _on_benchmark_cancel(msg) -> None:
    """`ai.bench.cancel` — cooperatively stop an in-flight benchmark at the next
    strategy boundary. Broadcast (no queue group) so whichever worker is running
    it sees the flag."""
    from ai.bench import cancel_benchmark
    cancel_benchmark()
    await nats_client.reply(msg, {"ok": True})


async def _on_align_speakers(msg) -> None:
    """`ai.diarize.align` — voice-fingerprint the user's reference lines and
    assign every target line to the nearest reference speaker. Synchronous
    request-reply; the api applies the DB swap from the returned assignments."""
    from ai.pipelines.align_speakers import align_speakers
    try:
        body = json.loads(msg.data.decode()) if msg.data else {}
    except json.JSONDecodeError:
        await nats_client.reply(msg, {"error": "bad_json"})
        return
    try:
        result = await align_speakers(body)
    except Exception as exc:  # noqa: BLE001
        log.exception("align_handler_failed")
        result = {"error": str(exc)}
    await nats_client.reply(msg, result)


async def _on_translate_text(msg) -> None:
    try:
        body = json.loads(msg.data.decode()) if msg.data else {}
        text = await translate_text(
            body["text"],
            source_lang=body.get("source_lang", "auto"),
            target_lang=body.get("target_lang", "en"),
            provider=body.get("provider", "nllb"),
        )
        await nats_client.reply(msg, {
            "text": text,
            "provider": body.get("provider", "nllb"),
            "source_lang": body.get("source_lang", "auto"),
            "target_lang": body.get("target_lang", "en"),
        })
    except Exception as exc:  # noqa: BLE001
        log.exception("translate_text_failed")
        await nats_client.reply(msg, {"text": "", "error": str(exc)})


# ─── Realtime session start (queue group → exactly one worker claims session) ─

async def _on_realtime_start(msg) -> None:
    try:
        cfg = json.loads(msg.data.decode()) if msg.data else {}
    except json.JSONDecodeError:
        await nats_client.reply(msg, {"ok": False, "error": "bad_json"})
        return
    sid = cfg.get("session_id")
    if not sid:
        await nats_client.reply(msg, {"ok": False, "error": "missing_session_id"})
        return
    if sid in sessions:
        await nats_client.reply(msg, {
            "ok": True, "worker_id": settings.worker_id, "session_id": sid, "reused": True,
        })
        return
    log.info("realtime_start_received", sid=sid, backend=cfg.get("backend"), model=cfg.get("model"))
    streamer = Streamer(sid, cfg)
    sessions[sid] = streamer
    try:
        await streamer.setup()
        await streamer.start()
        log.info("realtime_start_ready", sid=sid, worker_id=settings.worker_id)
        await nats_client.reply(msg, {
            "ok": True, "worker_id": settings.worker_id, "session_id": sid,
        })
    except Exception as exc:  # noqa: BLE001
        log.exception("realtime_start_failed", sid=sid)
        sessions.pop(sid, None)
        await nats_client.reply(msg, {"ok": False, "error": str(exc)})


# ─── Main loop ───────────────────────────────────────────────────────────────

async def _amain() -> None:
    setup_logging()
    for d in (settings.data_dir, settings.upload_dir, settings.output_dir, settings.model_cache_dir):
        d.mkdir(parents=True, exist_ok=True)

    await nats_client.connect()

    # Distributed GPU lock — KV bucket created by api on startup, but open is idempotent.
    try:
        kv = await nats_client.open_kv("gpu_locks")
        gpu_lock.attach_kv(kv, settings.worker_id)
    except Exception:  # noqa: BLE001
        log.warning("gpu_lock_kv_unavailable_falling_back_to_local")

    # JOBS pull consumer (WorkQueue — built-in load balance across workers)
    psub = await nats_client.js().pull_subscribe("jobs.transcribe", durable="ai-workers")

    # Req-reply with queue group — one worker answers each request.
    qopts = {"queue": "ai-workers"}
    await nats_client.nc().subscribe("ai.system.info",      cb=_on_system_info,    **qopts)
    await nats_client.nc().subscribe("ai.system.gpu_stats", cb=_on_gpu_stats,      **qopts)
    await nats_client.nc().subscribe("ai.system.load",      cb=_on_load_model,     **qopts)
    await nats_client.nc().subscribe("ai.system.unload",    cb=_on_unload_model,   **qopts)
    await nats_client.nc().subscribe("ai.translate.text", cb=_on_translate_text, **qopts)
    await nats_client.nc().subscribe("ai.retranscribe.run", cb=_on_retranscribe,  **qopts)
    await nats_client.nc().subscribe("ai.diarize.align",    cb=_on_align_speakers, **qopts)
    await nats_client.nc().subscribe("ai.bench.run",        cb=_on_benchmark,      **qopts)
    await nats_client.nc().subscribe("ai.bench.cancel",     cb=_on_benchmark_cancel, **qopts)
    await nats_client.nc().subscribe("realtime.start",    cb=_on_realtime_start, **qopts)
    # Cancel is broadcast (no queue group) so every worker checks its local
    # _running_jobs — the one that owns the task cancels, the others no-op.
    await nats_client.nc().subscribe("jobs.*.cancel",     cb=_on_job_cancel)

    await registry.start_sweeper()
    log.info("ai_started", worker=settings.worker_id)

    if settings.prewarm_enabled:
        async def _prewarm():
            try:
                log.info("prewarm_begin", backend=settings.prewarm_backend, model=settings.prewarm_model)
                await registry.get(settings.prewarm_backend, model=settings.prewarm_model)
                log.info("prewarm_done")
            except Exception:  # noqa: BLE001
                log.exception("prewarm_failed")
        asyncio.create_task(_prewarm())

    stop_event = asyncio.Event()

    def _shutdown(*_):
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _shutdown)
        except NotImplementedError:
            pass

    async def _pull_loop():
        while not stop_event.is_set():
            try:
                msgs = await psub.fetch(batch=1, timeout=2.0)
                for m in msgs:
                    await _on_job(m)
            except asyncio.TimeoutError:
                continue
            except Exception:  # noqa: BLE001
                log.exception("pull_loop_error")
                await asyncio.sleep(1.0)

    pull_task = asyncio.create_task(_pull_loop())
    _ = deepl_translator  # touch to surface missing-key error eagerly
    await stop_event.wait()

    pull_task.cancel()
    try:
        await pull_task
    except asyncio.CancelledError:
        pass
    await registry.stop_sweeper()
    await nats_client.close()
    log.info("ai_stopped")


def main() -> None:
    asyncio.run(_amain())


if __name__ == "__main__":
    main()
