from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from api import nats_client
from api.audio.ffmpeg import ffmpeg_version
from api.config import settings
from api.exceptions import BackendUnavailable
from api.schemas.system import GpuInfo, LoadedModel, SystemInfo

v1_system_router = APIRouter(prefix="/api/v1/system", tags=["system"])


@v1_system_router.get("/info")
async def get_info() -> dict:
    ai_info = await nats_client.request("ai.system.info", {}, timeout=2.0)
    ai_online = ai_info is not None
    ai_info = ai_info or {}
    info = SystemInfo(
        gpu=GpuInfo(
            available=bool(ai_info.get("gpu_available", False)),
            name=ai_info.get("gpu_name"),
            vram_total_mb=ai_info.get("vram_total_mb"),
            cuda=ai_info.get("cuda"),
        ),
        ffmpeg_version=await ffmpeg_version(),
        backends_available=ai_info.get("backends", ["faster_whisper", "openai_whisper"]),
        translate_providers=ai_info.get("translate_providers", ["nllb"]) + (["deepl"] if ai_info.get("deepl") else []),
        uvr_models=ai_info.get("uvr_models", ["htdemucs"]),
        diarize_available=bool(ai_info.get("diarize_available", False)),
        diarize_token_present=bool(ai_info.get("diarize_token_present", False)),
        diarize_reason=ai_info.get("diarize_reason"),
        loaded_models=[LoadedModel(**m) for m in ai_info.get("loaded_models", [])],
        default_backend=ai_info.get("default_backend"),
        default_model=ai_info.get("default_model"),
        ai_online=ai_online,
    )
    return {"data": info.model_dump()}


class _ModelRef(BaseModel):
    backend: str
    model: str | None = None


@v1_system_router.post("/models/load")
async def load_model(body: _ModelRef) -> dict:
    """Force ai to load a specific backend/model. Returns updated loaded list."""
    resp = await nats_client.request("ai.system.load", body.model_dump(), timeout=120.0)
    if resp is None:
        raise BackendUnavailable("ai worker offline")
    if not resp.get("ok"):
        raise BackendUnavailable(resp.get("error", "load failed"))
    return {"data": {"loaded": resp.get("loaded", [])}}


@v1_system_router.post("/models/unload")
async def unload_model(body: _ModelRef) -> dict:
    resp = await nats_client.request("ai.system.unload", body.model_dump(), timeout=10.0)
    if resp is None:
        raise BackendUnavailable("ai worker offline")
    return {"data": {"unloaded": bool(resp.get("ok"))}}


def _human(mb: int) -> str:
    return f"{mb} MB" if mb < 1000 else f"{mb / 1000:.1f} GB".replace(".0 GB", " GB")


# Whisper's own weights ship under MIT; that's the default license for a row.
# Only the license *name* lives here — the human-readable summary and the
# commercial-use flag are derived on the client from the name, so this stays the
# single place to state each model's terms.
def _m(id_: str, mb: int, license_: str = "MIT", label: str | None = None) -> dict:
    return {
        "id": id_,
        "label": label or f"{id_} (~{_human(mb)})",
        "size_mb_estimated": mb,
        "license": license_,
    }


# Curated per-backend model catalogue. Single source of truth for the model
# picker — add a row here when a backend gains a model.
_BACKEND_MODELS: dict[str, list[dict]] = {
    "faster_whisper": [
        _m("tiny", 75), _m("base", 150), _m("small", 500), _m("medium", 1500),
        _m("large-v2", 3000), _m("large-v3", 3000), _m("large-v3-turbo", 1600),
        _m("distil-large-v3", 1500),  # English-only distil
        # Verbatim STT (fillers, stutters, disfluencies). CT2 build of
        # CrisperWhisper — drops into faster-whisper as a HF repo id. Weights are
        # CC-BY-NC-4.0 (non-commercial): the label keeps the size like every other
        # row, and the licence rides in its own field so the picker can surface a
        # warning without cluttering the list. Default stays large-v3-turbo. The
        # faster-whisper path keeps verbatim/filler detection but not
        # CrisperWhisper's precise word timestamps.
        _m("nyrahealth/faster_CrisperWhisper", 3000, "CC-BY-NC-4.0", "CrisperWhisper (~3 GB)"),
    ],
    "openai_whisper": [
        _m("tiny", 75), _m("base", 150), _m("small", 500), _m("medium", 1500),
        _m("large-v2", 3000), _m("large-v3", 3000), _m("turbo", 1600),
    ],
    # insanely_fast maps short names → openai/whisper-* HF ids internally; only
    # the large family is wired up there today.
    "insanely_fast_whisper": [
        _m("large-v2", 3000), _m("large-v3", 3000), _m("large-v3-turbo", 1600),
    ],
}


@v1_system_router.get("/models")
async def get_models(backend: str = "faster_whisper") -> dict:
    models = _BACKEND_MODELS.get(backend, _BACKEND_MODELS["faster_whisper"])
    return {"data": {"backend": backend, "models": models}}


class _BenchmarkReq(BaseModel):
    model: str | None = None
    compute_type: str | None = None
    clip_sec: float | None = None
    job_id: str | None = None


@v1_system_router.post("/benchmark")
async def run_benchmark(body: _BenchmarkReq) -> dict:
    """Measure execution strategies (sequential / concurrent / batched) on this
    hardware and return results + a recommendation. Delegated to the ai worker,
    which holds the GPU for the run, so allow a generous timeout."""
    resp = await nats_client.request(
        "ai.bench.run", body.model_dump(exclude_none=True), timeout=300.0,
    )
    if resp is None:
        raise BackendUnavailable("ai worker offline or benchmark timed out")
    # already_running is a normal, expected outcome (not a backend failure) — pass
    # it through so the UI can say "a benchmark is already in progress".
    if "error" in resp and resp["error"] != "already_running":
        raise BackendUnavailable(resp["error"])
    return {"data": resp}


@v1_system_router.post("/benchmark/cancel")
async def cancel_benchmark() -> dict:
    """Cooperatively stop an in-flight benchmark (broadcast to workers)."""
    await nats_client.request("ai.bench.cancel", {}, timeout=5.0)
    return {"data": {"ok": True}}


@v1_system_router.get("/gpu/stats")
async def get_gpu_stats() -> dict:
    """Live GPU utilisation snapshot. Cheap enough for a 2-3s UI poll.
    Returns `{available: false}` on CPU-only hosts so the UI can hide the card."""
    stats = await nats_client.request("ai.system.gpu_stats", {}, timeout=2.5)
    if stats is None:
        return {"data": {"available": False, "ai_online": False}}
    return {"data": {**stats, "ai_online": True}}


def _youtube_cache_dir():
    return settings.output_dir / "youtube_cache"


def _scan_cache() -> tuple[int, int]:
    """Return (total_bytes, file_count) for the youtube cache."""
    d = _youtube_cache_dir()
    if not d.exists():
        return 0, 0
    total, count = 0, 0
    for p in d.iterdir():
        if p.is_file():
            try:
                total += p.stat().st_size
                count += 1
            except OSError:
                pass
    return total, count


@v1_system_router.get("/cache")
async def get_cache() -> dict:
    """Size of the YouTube download cache + the auto-evict ceiling, for the
    Settings cache card."""
    total, count = _scan_cache()
    return {"data": {
        "size_bytes": total,
        "file_count": count,
        "max_gb": settings.youtube_cache_max_gb,
    }}


@v1_system_router.delete("/cache")
async def clear_cache() -> dict:
    """Wipe the YouTube download cache. Next playback of those videos
    re-downloads them."""
    d = _youtube_cache_dir()
    freed, deleted = 0, 0
    if d.exists():
        for p in list(d.iterdir()):
            if p.is_file():
                try:
                    sz = p.stat().st_size
                    p.unlink()
                    freed += sz
                    deleted += 1
                except OSError:
                    pass
    return {"data": {"deleted": deleted, "freed_bytes": freed}}


@v1_system_router.get("/health")
async def health() -> dict:
    return {"data": {"ok": True}}


@v1_system_router.get("/defaults")
async def defaults() -> dict:
    return {"data": {
        "backend": settings.default_backend,
        "model": settings.default_model,
        "compute_type": settings.default_compute_type,
    }}
