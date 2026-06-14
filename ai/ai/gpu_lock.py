from __future__ import annotations

import asyncio

import structlog

log = structlog.get_logger()


class GpuLock:
    """Two-tier GPU lock used at every inference site.

    - in-process: ``asyncio.Semaphore(1)`` — serializes coroutines inside one ai worker.
    - cross-process: NATS KV atomic ``create`` on key ``gpu.lock`` — serializes across
      ai workers that share one GPU. The KV bucket carries a TTL so a crashed holder
      doesn't deadlock the GPU.

    Disabled (``attach_kv`` never called) → only the in-process lock applies, which is
    a no-op for the typical single-worker setup. Multi-GPU users pin one worker per
    GPU via ``CUDA_VISIBLE_DEVICES`` and likewise skip ``attach_kv``.
    """

    KEY = "gpu.lock"

    def __init__(self) -> None:
        self._local = asyncio.Semaphore(1)
        self._kv = None
        self._worker_id: str = ""

    def attach_kv(self, kv, worker_id: str) -> None:
        self._kv = kv
        self._worker_id = worker_id
        log.info("gpu_lock_distributed_enabled", worker=worker_id)

    async def __aenter__(self) -> "GpuLock":
        await self._local.acquire()
        if self._kv is None:
            return self
        backoff = 0.02
        while True:
            try:
                await self._kv.create(self.KEY, self._worker_id.encode())
                return self
            except Exception as exc:  # noqa: BLE001 — nats-py raises subclasses we don't pin to
                # KV.create fails if the key exists; any other error is also worth retrying
                # briefly since the alternative is the worker silently freezing.
                msg = str(exc).lower()
                if "exists" in msg or "wrong last sequence" in msg or "10071" in msg or "10042" in msg:
                    await asyncio.sleep(backoff)
                    backoff = min(0.25, backoff * 1.5)
                    continue
                # unknown error — release local lock and propagate
                self._local.release()
                raise

    async def __aexit__(self, *_):
        if self._kv is not None:
            try:
                await self._kv.delete(self.KEY)
            except Exception:  # noqa: BLE001
                pass
        self._local.release()


gpu_lock = GpuLock()
