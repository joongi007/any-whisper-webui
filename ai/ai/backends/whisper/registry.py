from __future__ import annotations

import asyncio
import time

import structlog

from ai.backends.whisper.base import TranscribeBackend
from ai.backends.whisper.faster_whisper import FasterWhisperBackend
from ai.backends.whisper.insanely_fast import InsanelyFastBackend
from ai.backends.whisper.openai_whisper import OpenAIWhisperBackend
from ai.config import settings

log = structlog.get_logger()


def _best_device() -> str:
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        return "cpu"


class WhisperRegistry:
    def __init__(self) -> None:
        self._instances: dict[str, TranscribeBackend] = {}
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()
        self._sweep_task: asyncio.Task | None = None

    def _build(self, name: str) -> TranscribeBackend:
        if name == "faster_whisper":
            return FasterWhisperBackend()
        if name == "openai_whisper":
            return OpenAIWhisperBackend()
        if name == "insanely_fast_whisper":
            return InsanelyFastBackend()
        raise RuntimeError(f"unknown backend: {name}")

    async def get(self, name: str, *, model: str, device: str | None = None, compute_type: str | None = None) -> TranscribeBackend:
        async with self._lock:
            be = self._instances.get(name)
            if be is None:
                be = self._build(name)
                self._instances[name] = be
        await be.load(model, device or _best_device(), compute_type or "float16")
        self._last[name] = time.monotonic()
        return be

    def loaded(self) -> list[dict]:
        """Snapshot of currently-resident backends — model + last-used age.
        Probe several attribute names since adapters disagree (_loaded_key,
        _key) and store either a string or a (model, device, compute) tuple."""
        now = time.monotonic()
        out: list[dict] = []
        for name, be in self._instances.items():
            raw = (
                getattr(be, "_loaded_model", None)
                or getattr(be, "_loaded_key", None)
                or getattr(be, "_key", None)
            )
            if isinstance(raw, tuple):
                model = raw[0] if raw else None
            elif isinstance(raw, str):
                model = raw
            else:
                model = None
            idle = now - self._last.get(name, now)
            out.append({"backend": name, "model": model, "idle_sec": round(idle, 1)})
        return out

    async def unload(self, name: str) -> bool:
        async with self._lock:
            be = self._instances.pop(name, None)
            self._last.pop(name, None)
        if be is None:
            return False
        await be.unload()
        return True

    async def start_sweeper(self) -> None:
        if self._sweep_task is None or self._sweep_task.done():
            self._sweep_task = asyncio.create_task(self._sweep())

    async def stop_sweeper(self) -> None:
        if self._sweep_task and not self._sweep_task.done():
            self._sweep_task.cancel()
            try:
                await self._sweep_task
            except asyncio.CancelledError:
                pass

    async def _sweep(self) -> None:
        while True:
            try:
                await asyncio.sleep(30)
                now = time.monotonic()
                for n, ts in list(self._last.items()):
                    if now - ts > settings.model_idle_unload_sec:
                        be = self._instances.get(n)
                        if be:
                            await be.unload()
                        self._last.pop(n, None)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("sweeper_error", error=str(exc))


registry = WhisperRegistry()
