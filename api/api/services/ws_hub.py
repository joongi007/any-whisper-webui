from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class WSHub:
    """In-memory registry of WebSocket subscribers, keyed by topic.

    Topics used:
      - f"job:{job_id}"           — job progress + segments
      - f"realtime:{session_id}"  — realtime STT events
    """

    def __init__(self) -> None:
        self._subs: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def add(self, topic: str, ws: WebSocket) -> None:
        async with self._lock:
            self._subs[topic].add(ws)

    async def remove(self, topic: str, ws: WebSocket) -> None:
        async with self._lock:
            self._subs.get(topic, set()).discard(ws)
            if not self._subs.get(topic):
                self._subs.pop(topic, None)

    async def send(self, topic: str, message: dict) -> None:
        async with self._lock:
            targets = list(self._subs.get(topic, ()))
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001  — let WS lifecycle handle disconnect
                continue


hub = WSHub()
