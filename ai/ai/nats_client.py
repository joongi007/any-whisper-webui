from __future__ import annotations

import json
from typing import Any

import nats
import structlog
from nats.aio.client import Client as NATSClient
from nats.js import JetStreamContext

from ai.config import settings

log = structlog.get_logger()

_nc: NATSClient | None = None
_js: JetStreamContext | None = None


async def connect() -> None:
    global _nc, _js
    _nc = await nats.connect(servers=[settings.nats_url], name=settings.worker_id)
    _js = _nc.jetstream()
    log.info("nats_connected", url=settings.nats_url, worker=settings.worker_id)


async def close() -> None:
    global _nc, _js
    if _nc is not None:
        await _nc.drain()
        _nc = None
        _js = None


def nc() -> NATSClient:
    if _nc is None:
        raise RuntimeError("NATS not connected")
    return _nc


def js() -> JetStreamContext:
    if _js is None:
        raise RuntimeError("JetStream not initialized")
    return _js


async def publish_event(subject: str, payload: dict[str, Any]) -> None:
    await js().publish(subject, json.dumps(payload).encode())


async def publish_plain(subject: str, payload: dict[str, Any]) -> None:
    await nc().publish(subject, json.dumps(payload).encode())


async def reply(msg, payload: dict[str, Any]) -> None:
    if msg.reply:
        await nc().publish(msg.reply, json.dumps(payload).encode())


async def open_kv(bucket: str):
    """Open an existing KV bucket; create it if missing (idempotent across workers).

    Note: nats-py expects ttl as int seconds here, not timedelta.
    """
    from nats.js.api import KeyValueConfig

    try:
        return await js().key_value(bucket=bucket)
    except Exception:  # noqa: BLE001 — bucket not found / not initialized
        try:
            return await js().create_key_value(config=KeyValueConfig(bucket=bucket, ttl=60))
        except Exception:  # noqa: BLE001 — race with another worker creating it
            return await js().key_value(bucket=bucket)
