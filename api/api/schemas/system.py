from __future__ import annotations

from pydantic import BaseModel


class GpuInfo(BaseModel):
    available: bool
    name: str | None = None
    vram_total_mb: int | None = None
    cuda: str | None = None


class LoadedModel(BaseModel):
    backend: str
    model: str | None = None
    idle_sec: float | None = None


class SystemInfo(BaseModel):
    gpu: GpuInfo
    ffmpeg_version: str | None
    backends_available: list[str]
    translate_providers: list[str]
    uvr_models: list[str]
    diarize_available: bool
    # True when a token is configured but gated-access may still be missing.
    # Lets the UI say "accept the terms" instead of "set a token".
    diarize_token_present: bool = False
    # Precise blocker for diarization: None | "no_token" | "terms" |
    # "permission" (token lacks gated-repo scope) | "network".
    diarize_reason: str | None = None
    loaded_models: list[LoadedModel] = []
    default_backend: str | None = None
    default_model: str | None = None
    ai_online: bool = True
