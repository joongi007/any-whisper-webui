from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, UploadFile

from api.audio.ffmpeg import probe_duration
from api.config import settings
from api.db import SessionDep
from api.deps import new_id
from api.exceptions import FileNotFound
from api.repositories.job_repo import JobRepository
from api.schemas.files import FileView

v1_files_router = APIRouter(prefix="/api/v1/files", tags=["files"])


@v1_files_router.post("")
async def upload_file(session: SessionDep, file: UploadFile = File(...)) -> dict:
    file_id = new_id()
    suffix = Path(file.filename or "upload.bin").suffix
    storage = settings.upload_dir / f"{file_id}{suffix}"
    storage.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with storage.open("wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)
            size += len(chunk)
    duration = await probe_duration(storage)

    repo = JobRepository(session)
    await repo.upsert_file(
        file_id=file_id, filename=file.filename or "upload.bin",
        storage_path=str(storage), size_bytes=size,
        duration_sec=duration, mime_type=file.content_type,
    )
    return {"data": FileView(
        file_id=file_id, filename=file.filename or "upload.bin",
        size_bytes=size, duration_sec=duration, mime_type=file.content_type,
    ).model_dump()}


@v1_files_router.get("/{file_id}")
async def get_file(file_id: str, session: SessionDep) -> dict:
    repo = JobRepository(session)
    asset = await repo.get_file(file_id)
    if asset is None:
        raise FileNotFound(f"File not found: {file_id}")
    return {"data": FileView(
        file_id=asset.id, filename=asset.filename, size_bytes=asset.size_bytes,
        duration_sec=asset.duration_sec, mime_type=asset.mime_type,
    ).model_dump()}
