from __future__ import annotations

import json
from typing import Any

import nats
import structlog
from nats.aio.client import Client as NATSClient
from nats.js import JetStreamContext
from nats.js.api import (
    ConsumerConfig,
    DeliverPolicy,
    RetentionPolicy,
    StorageType,
    StreamConfig,
)

from api.config import settings

log = structlog.get_logger()


_nc: NATSClient | None = None
_js: JetStreamContext | None = None


async def _ensure_stream(cfg: StreamConfig) -> None:
    """Create the stream if missing; update in place if its subjects/policy changed."""
    try:
        await js().add_stream(cfg)
    except Exception:  # noqa: BLE001 — nats-py raises various error types; fall through to update
        await js().update_stream(cfg)


async def connect() -> None:
    """Connect to NATS and ensure JetStream streams exist."""
    global _nc, _js
    _nc = await nats.connect(servers=[settings.nats_url], name="api")
    _js = _nc.jetstream()
    # add_or_update — survive schema changes between runs without manual stream wipe.
    await _ensure_stream(StreamConfig(
        name="JOBS",
        subjects=["jobs.transcribe", "jobs.translate", "jobs.uvr", "jobs.diarize"],
        retention=RetentionPolicy.WORK_QUEUE,
        storage=StorageType.FILE,
    ))
    await _ensure_stream(StreamConfig(
        name="EVENTS",
        subjects=["jobs.*.progress", "jobs.*.done", "jobs.*.failed", "jobs.*.segment.*"],
        retention=RetentionPolicy.LIMITS,
        storage=StorageType.FILE,
    ))
    await _ensure_gpu_lock_kv()
    log.info("nats_connected", url=settings.nats_url)


async def _ensure_gpu_lock_kv() -> None:
    """Create the KV bucket ai workers use as a distributed GPU lock (TTL-protected).

    nats-py expects ttl as int seconds here, not timedelta — passing timedelta
    triggers a TypeError deep in the comparison code.
    """
    from nats.js.api import KeyValueConfig

    try:
        await js().key_value(bucket="gpu_locks")
        return
    except Exception:  # noqa: BLE001 — bucket not found
        pass
    try:
        await js().create_key_value(config=KeyValueConfig(bucket="gpu_locks", ttl=60))
    except Exception:  # noqa: BLE001 — race with ai worker creating it
        pass


async def close() -> None:
    global _nc, _js
    if _nc is None:
        return
    # drain() raises ConnectionReconnectingError if the server already went
    # away — common during `docker compose down` where nats stops first.
    # Fall back to plain close() so lifespan shutdown can complete cleanly.
    try:
        await _nc.drain()
    except Exception:  # noqa: BLE001
        try:
            await _nc.close()
        except Exception:  # noqa: BLE001
            pass
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


async def publish_job(subject: str, payload: dict[str, Any]) -> None:
    await js().publish(subject, json.dumps(payload).encode())


async def request(subject: str, payload: dict[str, Any], *, timeout: float = 5.0) -> dict[str, Any] | None:
    try:
        msg = await nc().request(subject, json.dumps(payload).encode(), timeout=timeout)
    except Exception as exc:  # noqa: BLE001
        log.warning("nats_request_failed", subject=subject, error=str(exc))
        return None
    try:
        return json.loads(msg.data.decode())
    except json.JSONDecodeError:
        return None


async def publish_plain(subject: str, data: bytes, *, headers: dict[str, str] | None = None) -> None:
    await nc().publish(subject, data, headers=headers)


async def subscribe_events_push(callback) -> None:
    """Subscribe to the EVENTS stream as durable push consumer."""
    await js().subscribe(
        "jobs.*.>",
        durable="api-events",
        cb=callback,
        config=ConsumerConfig(deliver_policy=DeliverPolicy.NEW),
        manual_ack=False,
    )
