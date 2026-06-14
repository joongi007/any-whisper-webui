from __future__ import annotations

import asyncio
import json

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.db import get_session_factory
from api.repositories.job_repo import JobRepository
from api.services.realtime_service import RealtimeBridge
from api.services.ws_hub import hub

log = structlog.get_logger()
ws_router = APIRouter(tags=["ws"])


async def _safe_send_json(ws: WebSocket, payload: dict) -> bool:
    """Tolerant of clients that close mid-send. Returns False if the socket
    is gone — caller can short-circuit. Mirrors WSHub.send semantics."""
    try:
        await ws.send_json(payload)
        return True
    except (WebSocketDisconnect, RuntimeError):
        return False
    except Exception:  # noqa: BLE001
        log.exception("ws_send_failed")
        return False


@ws_router.websocket("/ws/jobs/{job_id}")
async def ws_job(ws: WebSocket, job_id: str) -> None:
    await ws.accept()
    topic = f"job:{job_id}"
    async with get_session_factory()() as session:
        job = await JobRepository(session).get(job_id)
    if job is None:
        await _safe_send_json(ws, {"type": "error", "code": "job_not_found"})
        try: await ws.close()
        except RuntimeError: pass
        return

    if not await _safe_send_json(ws, {
        "type": "job_status", "status": job.status, "stage": job.stage, "progress": job.progress,
    }):
        return

    if job.status in {"succeeded", "failed", "cancelled"}:
        if job.status == "succeeded" and job.result:
            await _safe_send_json(ws, {
                "type": "job_done",
                "transcript_id": job.result.get("transcript_id", job.id),
                "output_files": job.result.get("output_files", []),
            })
        try: await ws.close()
        except RuntimeError: pass
        return

    await hub.add(topic, ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                if not await _safe_send_json(ws, {"type": "pong"}):
                    break
    except WebSocketDisconnect:
        pass
    finally:
        await hub.remove(topic, ws)
        await asyncio.sleep(0)


@ws_router.websocket("/ws/realtime")
async def ws_realtime(ws: WebSocket) -> None:
    await ws.accept()
    bridge = RealtimeBridge(ws)
    await bridge.run()
