from __future__ import annotations

import structlog
from fastapi import APIRouter, Query

from api import nats_client
from api.constants import KIND_TRANSCRIBE
from api.db import SessionDep
from api.exceptions import JobNotFound, ValidationFailed
from api.repositories.job_repo import JobRepository
from api.schemas.job import JobView, TranscribeRequest
from api.services.job_service import submit_transcribe

log = structlog.get_logger()

v1_jobs_router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


def _source_summary(req: dict, file_asset) -> tuple[str | None, str | None]:
    """Return (kind, human-friendly label) for the job's source."""
    src = (req or {}).get("source") or {}
    kind = src.get("kind")
    if kind == "file":
        if file_asset is not None:
            return "file", file_asset.filename
        return "file", src.get("file_id")
    if kind == "youtube":
        url = src.get("url", "")
        # Prefer "youtu.be/<id>" — pull the video id from either the `v` query
        # param (standard watch URL) or the path tail (short URL / embed).
        try:
            from urllib.parse import parse_qs, urlparse
            p = urlparse(url)
            vid = parse_qs(p.query).get("v", [None])[0]
            if not vid and p.netloc.endswith("youtu.be"):
                vid = p.path.lstrip("/").split("/")[0] or None
            if not vid and "/embed/" in p.path:
                vid = p.path.split("/embed/", 1)[1].split("/")[0] or None
            if not vid and "/live/" in p.path:
                vid = p.path.split("/live/", 1)[1].split("/")[0] or None
            if not vid and "/shorts/" in p.path:
                vid = p.path.split("/shorts/", 1)[1].split("/")[0] or None
            return "youtube", f"youtu.be/{vid}" if vid else (p.netloc + p.path) or url
        except Exception:  # noqa: BLE001
            return "youtube", url
    return kind, None


def _view(job) -> JobView:
    req = job.request or {}
    result = job.result or {}
    # Realtime sessions don't carry a `source` payload — the source IS the
    # live audio stream. Synthesise a uniform label for the UI.
    if job.kind == "realtime":
        kind, label = "realtime", "Live session"
    else:
        kind, label = _source_summary(req, getattr(job, "file_asset", None))
    return JobView(
        job_id=job.id, kind=job.kind, status=job.status, stage=job.stage,
        progress=job.progress,
        created_at=job.created_at, started_at=job.started_at, finished_at=job.finished_at,
        error=job.error, result=job.result,
        source_kind=kind, source_label=label,
        backend=req.get("backend"), model=req.get("model"),
        language=result.get("language") or req.get("language"),
        duration_sec=result.get("duration_sec"),
        # segment_count is intentionally omitted from list/get to avoid an N+1 — the
        # detail page already shows segment count via the transcript fetch.
    )


@v1_jobs_router.post("/transcribe")
async def create_transcribe(payload: TranscribeRequest, session: SessionDep) -> dict:
    repo = JobRepository(session)
    job_id = await submit_transcribe(repo, payload)
    return {"data": {"job_id": job_id, "status": "queued"}}


@v1_jobs_router.get("/{job_id}")
async def get_job(job_id: str, session: SessionDep) -> dict:
    repo = JobRepository(session)
    job = await repo.get(job_id)
    if job is None:
        raise JobNotFound(f"Job not found: {job_id}")
    return {"data": _view(job).model_dump()}


@v1_jobs_router.post("/{job_id}/cancel")
async def cancel_job(job_id: str, session: SessionDep) -> dict:
    """Signal the ai worker to stop the running task and mark the row cancelled.
    Idempotent: cancelling an already-finished job is a no-op (still returns
    200 so the UI doesn't have to special-case races)."""
    repo = JobRepository(session)
    job = await repo.get(job_id)
    if job is None:
        raise JobNotFound(f"Job not found: {job_id}")
    if job.status in {"succeeded", "failed", "cancelled"}:
        return {"data": {"cancelled": False, "reason": "terminal_state", "status": job.status}}

    # Fire the cancel signal first so the worker stops as fast as possible;
    # mark the DB row only after — the event_consumer also flips the row on
    # the worker's `failed` event, but doing it here gives the UI an
    # immediate optimistic state without waiting on the round trip.
    # Empty body — the ai handler keys off the subject (job_id), not the payload.
    # (publish_plain takes bytes; passing a dict here used to crash the request.)
    await nats_client.publish_plain(f"jobs.{job_id}.cancel", b"")
    await repo.mark_cancelled(job_id)
    log.info("job_cancel_requested", job_id=job_id, prior_status=job.status)
    return {"data": {"cancelled": True, "status": "cancelled"}}


@v1_jobs_router.post("/{job_id}/retry")
async def retry_job(job_id: str, session: SessionDep) -> dict:
    """Resubmit a finished job with the exact same request payload as a brand
    new job. Returns the new job_id. The original row is left untouched so the
    user keeps a record of the failed/cancelled attempt.

    Only transcribe jobs in a terminal state are retryable — realtime sessions
    have no replayable request, and re-running a still-active job would race."""
    repo = JobRepository(session)
    job = await repo.get(job_id)
    if job is None:
        raise JobNotFound(f"Job not found: {job_id}")
    if job.kind != KIND_TRANSCRIBE:
        raise ValidationFailed(f"Only transcribe jobs can be retried (got {job.kind})")
    if job.status not in {"succeeded", "failed", "cancelled"}:
        raise ValidationFailed(f"Job is still {job.status}; cancel it before retrying")

    # Rebuild the original request. For file sources the asset must still exist
    # (submit_transcribe re-validates) — surfaces a clean error if it was GC'd.
    try:
        req = TranscribeRequest(**(job.request or {}))
    except Exception as exc:  # noqa: BLE001
        raise ValidationFailed(f"Stored request is no longer valid: {exc}") from exc

    new_id = await submit_transcribe(repo, req)
    log.info("job_retried", original=job_id, new=new_id)
    return {"data": {"job_id": new_id, "status": "queued"}}


@v1_jobs_router.delete("/{job_id}")
async def delete_job(job_id: str, session: SessionDep) -> dict:
    """Permanently delete a job + its segments. Output files on disk are removed
    best-effort. ai-side interrupt of running inference is not implemented yet —
    a running job's record is removed but the worker will finish its current
    chunk and discover the row gone when it tries to write events back."""
    import shutil
    from pathlib import Path

    from api.config import settings as cfg
    repo = JobRepository(session)
    job = await repo.get(job_id)
    if job is None:
        raise JobNotFound(f"Job not found: {job_id}")

    deleted = await repo.delete_job(job_id)

    # Best-effort cleanup of /data/outputs/{job_id}. Failures shouldn't 500
    # the API — the DB row is gone, the disk leak is reclaimable.
    out_dir: Path = cfg.output_dir / job_id
    if out_dir.exists():
        try:
            shutil.rmtree(out_dir)
        except OSError as exc:
            log.warning("output_dir_cleanup_failed", job_id=job_id, error=str(exc))

    return {"data": {"deleted": deleted}}


@v1_jobs_router.get("")
async def list_jobs(
    session: SessionDep,
    kind: str | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    repo = JobRepository(session)
    items, total = await repo.list(kind=kind, status=status, page=page, size=size)
    return {"data": {
        "items": [_view(j).model_dump() for j in items],
        "total": total, "page": page, "size": size,
    }}
