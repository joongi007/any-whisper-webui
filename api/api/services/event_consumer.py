from __future__ import annotations

import asyncio
import json

import structlog
from nats.aio.msg import Msg

from api import nats_client
from api.db import get_session_factory
from api.repositories.job_repo import JobRepository
from api.services.ws_hub import hub

log = structlog.get_logger()


async def _handle(msg: Msg) -> None:
    """jobs.{job_id}.* — translate NATS event into DB write + WS fan-out."""
    parts = msg.subject.split(".")
    if len(parts) < 3:
        return
    job_id = parts[1]
    leaf = ".".join(parts[2:])
    try:
        body = json.loads(msg.data.decode()) if msg.data else {}
    except json.JSONDecodeError:
        return

    factory = get_session_factory()
    async with factory() as session:
        repo = JobRepository(session)
        topic = f"job:{job_id}"

        if leaf == "progress":
            await repo.update_progress(job_id, stage=body.get("stage", ""), progress=float(body.get("progress", 0)))
            await hub.send(
                topic,
                {"type": "job_status", "status": "running", "stage": body.get("stage", ""), "progress": float(body.get("progress", 0))},
            )

        elif leaf == "segment.partial":
            await hub.send(topic, {
                "type": "segment_partial",
                "start": body.get("start"), "end": body.get("end"),
                "text": body.get("text"), "speaker": body.get("speaker"),
            })

        elif leaf == "segment.final":
            seq = int(body.get("seq", 0))
            await repo.add_segment(
                job_id=job_id, seq=seq,
                start=float(body.get("start", 0.0)),
                end=float(body.get("end", 0.0)),
                text=str(body.get("text", "")),
                speaker=body.get("speaker"),
                translation=body.get("translation"),
                words=body.get("words"),
            )
            await hub.send(topic, {
                "type": "segment_final",
                "start": body.get("start"), "end": body.get("end"),
                "text": body.get("text"), "speaker": body.get("speaker"),
                "translation": body.get("translation"),
            })

        elif leaf == "done":
            await repo.mark_succeeded(job_id, result=body)
            await hub.send(topic, {
                "type": "job_done",
                "transcript_id": body.get("transcript_id", job_id),
                "output_files": body.get("output_files", []),
            })

        elif leaf == "failed":
            # User-initiated cancel arrives as `failed` with code="cancelled"
            # because that's how the pipeline catches asyncio.CancelledError.
            # Route it to mark_cancelled so the UI shows a calm gray chip
            # instead of a red error.
            if body.get("code") == "cancelled":
                await repo.mark_cancelled(job_id, reason=body.get("message") or "Cancelled by user")
                await hub.send(topic, {"type": "job_cancelled", "error": body})
            else:
                await repo.mark_failed(job_id, error=body)
                await hub.send(topic, {"type": "job_failed", "error": body})


async def start() -> None:
    """Register the durable push consumer."""
    await nats_client.subscribe_events_push(_handle)
    log.info("event_consumer_started")


async def stop() -> None:
    # nats client teardown handled by nats_client.close()
    await asyncio.sleep(0)
