from __future__ import annotations

from pydantic import BaseModel


class FileView(BaseModel):
    file_id: str
    filename: str
    size_bytes: int
    duration_sec: float | None
    mime_type: str | None = None
