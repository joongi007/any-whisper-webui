from __future__ import annotations

import structlog

from api import nats_client
from api.constants import (
    KIND_TRANSCRIBE,
    SUBJ_JOB_DIARIZE,
    SUBJ_JOB_TRANSCRIBE,
    SUBJ_JOB_TRANSLATE,
    SUBJ_JOB_UVR,
)
from api.deps import new_id
from api.exceptions import ValidationFailed
from api.repositories.job_repo import JobRepository
from api.schemas.job import TranscribeRequest

log = structlog.get_logger()

_KIND_TO_SUBJECT = {
    KIND_TRANSCRIBE: SUBJ_JOB_TRANSCRIBE,
    "translate": SUBJ_JOB_TRANSLATE,
    "uvr": SUBJ_JOB_UVR,
    "diarize": SUBJ_JOB_DIARIZE,
}


async def submit_transcribe(repo: JobRepository, req: TranscribeRequest) -> str:
    file_asset_id: str | None = None
    source_payload: dict
    if req.source.kind == "file":
        asset = await repo.get_file(req.source.file_id)
        if asset is None:
            raise ValidationFailed("Referenced file does not exist", fields={"source.file_id": "not_found"})
        file_asset_id = asset.id
        source_payload = {"kind": "file", "storage_path": asset.storage_path}
    else:
        source_payload = {"kind": "youtube", "url": req.source.url}

    job_id = new_id()
    await repo.create(
        job_id=job_id, kind=KIND_TRANSCRIBE,
        request=req.model_dump(),
        file_asset_id=file_asset_id,
    )

    msg = {
        "job_id": job_id,
        "source": source_payload,
        "backend": req.backend,
        "model": req.model,
        "language": req.language,
        "task": req.task,
        "preprocess": req.preprocess,
        "postprocess": req.postprocess,
        "options": req.options,
    }
    await nats_client.publish_job(SUBJ_JOB_TRANSCRIBE, msg)
    log.info("job_submitted", job_id=job_id, kind=KIND_TRANSCRIBE)
    return job_id
