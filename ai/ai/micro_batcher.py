from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Generic, TypeVar

T = TypeVar("T")
R = TypeVar("R")


class MicroBatcher(Generic[T, R]):
    """Coalesce concurrent enqueue(x) calls into batches, then call processor([x...]).

    Trigger: either `max_size` items in queue or `max_wait_ms` elapsed since first item.
    Returns the per-item result, in order matching the inputs.

    Use cases: NLLB batched translation, batched ASR inference where backend supports it.
    """

    def __init__(
        self,
        processor: Callable[[list[T]], Awaitable[list[R]]],
        *,
        max_size: int = 8,
        max_wait_ms: int = 50,
    ) -> None:
        self._processor = processor
        self._max_size = max_size
        self._max_wait = max_wait_ms / 1000.0
        self._pending: list[tuple[T, asyncio.Future[R]]] = []
        self._lock = asyncio.Lock()
        self._flusher_task: asyncio.Task | None = None

    async def submit(self, item: T) -> R:
        fut: asyncio.Future[R] = asyncio.get_running_loop().create_future()
        async with self._lock:
            self._pending.append((item, fut))
            if len(self._pending) >= self._max_size:
                batch = self._pending
                self._pending = []
                asyncio.create_task(self._dispatch(batch))
            elif self._flusher_task is None or self._flusher_task.done():
                self._flusher_task = asyncio.create_task(self._wait_and_flush())
        return await fut

    async def _wait_and_flush(self) -> None:
        await asyncio.sleep(self._max_wait)
        async with self._lock:
            if not self._pending:
                return
            batch = self._pending
            self._pending = []
        await self._dispatch(batch)

    async def _dispatch(self, batch: list[tuple[T, asyncio.Future[R]]]) -> None:
        items = [b[0] for b in batch]
        try:
            results = await self._processor(items)
        except BaseException as exc:  # noqa: BLE001
            for _, fut in batch:
                if not fut.done():
                    fut.set_exception(exc)
            return
        for (_, fut), r in zip(batch, results, strict=False):
            if not fut.done():
                fut.set_result(r)
