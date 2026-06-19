"""Execution-strategy benchmark.

Answers "which way of running inference is fastest on THIS hardware?" by
measuring three strategies on a real audio sample, back to back, while the
benchmark holds the GPU exclusively:

- **sequential**  : one transcribe at a time (the current default).
- **concurrent_N**: N transcribes in flight against a model loaded with
  CTranslate2 `num_workers=N`. This is the honest proxy for "multiple ai
  processes" — running real extra processes just hits the cross-process GPU
  lock and serializes anyway, so we measure whether the GPU itself gains from
  parallel inference. More VRAM (the model is replicated per worker).
- **batched_B**   : faster-whisper `BatchedInferencePipeline`, batch_size=B —
  chunks one file and runs the chunks as a batch. Higher throughput when VRAM
  allows; needs faster-whisper >= 1.0.

Throughput is reported as ×RT (audio-seconds processed per wall-second). Peak
VRAM is sampled from nvidia-smi during each run (CTranslate2 allocates outside
torch, so torch counters don't see it)."""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any

import structlog

from ai.config import settings
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()

# Fixed decode config so strategies are compared apples-to-apples (and fast).
_BEAM = 1

# Single-run guard + cooperative cancel. Only one benchmark runs at a time (it
# holds the GPU); a second request is rejected so a double-click / refresh-retry
# can't queue a duplicate. Cancel is checked at strategy boundaries.
_bench_running = False
_bench_cancel: asyncio.Event | None = None


def cancel_benchmark() -> None:
    if _bench_cancel is not None:
        _bench_cancel.set()


def _hardware() -> dict[str, Any]:
    info: dict[str, Any] = {
        "gpu_available": False, "gpu_name": None, "vram_total_mb": None,
        "cuda": None, "gpu_count": 0, "unified_memory": False,
        "cpu_count": os.cpu_count(),
    }
    try:
        import torch
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            name = p.name or ""
            info.update(
                gpu_available=True, gpu_name=name,
                vram_total_mb=int(p.total_memory / 1024 / 1024),
                cuda=torch.version.cuda, gpu_count=torch.cuda.device_count(),
            )
            # Jetson/Tegra/Orin share system RAM with the GPU (unified memory),
            # which changes the VRAM math — flag it for the recommendation.
            if any(k in name.lower() for k in ("tegra", "jetson", "orin", "integrated")):
                info["unified_memory"] = True
    except Exception:  # noqa: BLE001
        pass
    return info


async def _gpu_mem_used_mb() -> float | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=2.0)
        return float(out.decode().strip().splitlines()[0])
    except Exception:  # noqa: BLE001
        return None


def _resolve_audio(job_id: str | None) -> Path | None:
    """Use the given job's 16k wav, else the most recently produced one."""
    if job_id:
        p = settings.output_dir / job_id / "input_16k.wav"
        return p if p.exists() else None
    candidates = list(settings.output_dir.glob("*/input_16k.wav"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _wav_duration(path: Path) -> float:
    import soundfile as sf
    info = sf.info(str(path))
    return float(info.frames) / float(info.samplerate or 16000)


def _clip_wav(src: Path, max_sec: float) -> tuple[Path, float]:
    """Write the first `max_sec` of `src` to a temp wav for benchmarking. Using a
    short, fixed clip keeps the run fast while still giving a valid relative
    comparison. Returns (path, clip_seconds). Caller unlinks the path."""
    import tempfile
    import soundfile as sf
    samples, sr = sf.read(str(src), dtype="float32", always_2d=False)
    n = min(len(samples), int(max_sec * sr))
    clip = samples[:n]
    tmp = Path(tempfile.mkstemp(prefix="bench_", suffix=".wav")[1])
    sf.write(str(tmp), clip, sr)
    return tmp, float(n) / float(sr or 16000)


async def _measure(
    *, run_once, audio_sec: float, processed: int,
) -> dict[str, Any]:
    """Run `run_once` (a thread-blocking transcribe) `processed` times with the
    concurrency baked into the caller, timing the whole batch and sampling VRAM."""
    peak = {"mb": 0.0}
    stop = asyncio.Event()

    async def poll() -> None:
        while not stop.is_set():
            m = await _gpu_mem_used_mb()
            if m:
                peak["mb"] = max(peak["mb"], m)
            await asyncio.sleep(0.2)

    pt = asyncio.create_task(poll())
    t0 = time.perf_counter()
    try:
        await run_once()
    finally:
        wall = time.perf_counter() - t0
        stop.set()
        await pt
    throughput = (audio_sec * processed) / wall if wall > 0 else 0.0
    return {
        "wall_sec": round(wall, 2),
        "runs": processed,
        "throughput_xrt": round(throughput, 2),
        "peak_vram_mb": round(peak["mb"]) if peak["mb"] else None,
    }


def _load_model(model_size: str, device: str, compute_type: str, num_workers: int):
    from faster_whisper import WhisperModel
    return WhisperModel(
        model_size, device=device, compute_type=compute_type,
        num_workers=num_workers, download_root=str(settings.model_cache_dir),
    )


def _drain_transcribe(model, audio_path: Path) -> None:
    segments, _ = model.transcribe(str(audio_path), beam_size=_BEAM, vad_filter=False)
    for _ in segments:  # generator → consume to force full inference
        pass


def _free(model) -> None:
    try:
        del model
        import torch
        torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


async def run_benchmark(payload: dict[str, Any]) -> dict[str, Any]:
    global _bench_running, _bench_cancel
    # Reject a concurrent request so a double-click / refresh-retry can't queue
    # a duplicate run behind the GPU lock.
    if _bench_running:
        return {"error": "already_running"}
    _bench_running = True
    _bench_cancel = asyncio.Event()
    cancel = _bench_cancel
    wav = None
    try:
        model_size = payload.get("model") or settings.prewarm_model
        compute_type = payload.get("compute_type") or "float16"
        clip_sec = float(payload.get("clip_sec") or 30.0)
        src = _resolve_audio(payload.get("job_id"))
        if src is None:
            return {"error": "no_audio: 먼저 파일이나 YouTube를 한 번 변환해 주세요"}
        wav, audio_sec = await asyncio.to_thread(_clip_wav, src, clip_sec)

        hw = _hardware()
        device = "cuda" if hw["gpu_available"] else "cpu"
        if device == "cpu" and compute_type in ("float16", "int8_float16"):
            compute_type = "int8"

        # Concurrency levels to probe (skip on CPU — extra workers rarely help).
        conc_levels = [2, 4] if device == "cuda" else []
        results: list[dict[str, Any]] = []

        log.info("benchmark_begin", model=model_size, compute=compute_type,
                 device=device, clip_sec=round(audio_sec, 1))

        # Hold the GPU for the whole run so normal jobs don't interleave/skew it.
        async with gpu_lock:
            # 1) sequential + 2) batched (share one model)
            if not cancel.is_set():
                m = await asyncio.to_thread(_load_model, model_size, device, compute_type, 1)
                try:
                    async def seq():
                        for _ in range(3):
                            await asyncio.to_thread(_drain_transcribe, m, wav)
                    results.append({"strategy": "sequential",
                                    **await _measure(run_once=seq, audio_sec=audio_sec, processed=3)})

                    if not cancel.is_set():
                        try:
                            from faster_whisper import BatchedInferencePipeline
                            pipe = BatchedInferencePipeline(model=m)

                            def _batched() -> None:
                                # Batched pipeline chunks by VAD then batches the
                                # chunks, so it needs vad_filter=True (no chunks → error).
                                segs, _ = pipe.transcribe(str(wav), batch_size=8, beam_size=_BEAM, vad_filter=True)
                                for _ in segs:
                                    pass

                            async def batched():
                                for _ in range(2):
                                    await asyncio.to_thread(_batched)
                            results.append({"strategy": "batched_8",
                                            **await _measure(run_once=batched, audio_sec=audio_sec, processed=2)})
                        except Exception as exc:  # noqa: BLE001
                            results.append({"strategy": "batched_8", "error": str(exc)})
                finally:
                    _free(m)

            # 3) concurrency sweep (model replicated via num_workers)
            for n in conc_levels:
                if cancel.is_set():
                    break
                try:
                    mn = await asyncio.to_thread(_load_model, model_size, device, compute_type, n)
                    try:
                        async def conc(n=n, mn=mn):
                            sem = asyncio.Semaphore(n)
                            async def one():
                                async with sem:
                                    await asyncio.to_thread(_drain_transcribe, mn, wav)
                            await asyncio.gather(*[one() for _ in range(n * 2)])
                        results.append({"strategy": f"concurrent_{n}",
                                        **await _measure(run_once=conc, audio_sec=audio_sec, processed=n * 2)})
                    finally:
                        _free(mn)
                except Exception as exc:  # noqa: BLE001
                    results.append({"strategy": f"concurrent_{n}", "error": str(exc)})

        cancelled = cancel.is_set()
        rec = _recommend(results, hw)
        log.info("benchmark_done", results=results, recommendation=rec, cancelled=cancelled)
        return {
            "hardware": hw, "audio_sec": round(audio_sec, 1),
            "model": model_size, "compute_type": compute_type,
            "results": results, "recommendation": rec, "cancelled": cancelled,
        }
    finally:
        _bench_running = False
        if wav is not None:
            try:
                wav.unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass


def _recommend(results: list[dict[str, Any]], hw: dict[str, Any]) -> dict[str, Any]:
    ok = [r for r in results if "error" not in r and r.get("throughput_xrt")]
    if not ok:
        return {"error": "no_valid_results"}
    best = max(ok, key=lambda r: r["throughput_xrt"])
    seq = next((r for r in ok if r["strategy"] == "sequential"), None)
    # "balanced" avoids model replication (no concurrent_*), so VRAM stays flat.
    flat = [r for r in ok if not r["strategy"].startswith("concurrent")]
    balanced = max(flat, key=lambda r: r["throughput_xrt"]) if flat else best

    notes: list[str] = []
    if hw.get("gpu_count", 0) > 1:
        notes.append(f"gpu_count={hw['gpu_count']}: 워커를 GPU당 1개로 띄우면(--scale ai={hw['gpu_count']}) 진짜 병렬이 됩니다.")
    elif hw.get("gpu_available"):
        notes.append("단일 GPU: 멀티 프로세스는 GPU 락으로 직렬화됩니다. 동시성 이득은 아래 concurrent 결과로 판단하세요.")
    else:
        notes.append("CPU 모드: 동시성·배치 이득이 작습니다. int8 + 작은 모델을 권장합니다.")
    if hw.get("unified_memory"):
        notes.append("통합 메모리: VRAM과 시스템 RAM을 공유하므로 배치·동시성 시 메모리 한도에 유의하세요.")
    # Did concurrency actually beat sequential?
    if seq:
        conc = [r for r in ok if r["strategy"].startswith("concurrent")]
        if conc and max(c["throughput_xrt"] for c in conc) > seq["throughput_xrt"] * 1.1:
            notes.append("이 GPU는 동시 추론으로 처리량이 올라갑니다(>10%). 동시성을 늘릴 가치가 있습니다.")
        elif conc:
            notes.append("동시 추론이 순차보다 빠르지 않습니다. 프로세스 1 + 순차/배치를 권장합니다.")

    return {
        "max_performance": best["strategy"],
        "balanced": balanced["strategy"],
        "safe": "sequential",
        "notes": notes,
    }
