from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_serializer

BackendName = Literal["faster_whisper", "openai_whisper", "insanely_fast_whisper"]
TranslateProvider = Literal["nllb", "deepl"]


class FileSource(BaseModel):
    kind: Literal["file"] = "file"
    file_id: str


class YouTubeSource(BaseModel):
    kind: Literal["youtube"] = "youtube"
    url: str


JobSource = Annotated[FileSource | YouTubeSource, Field(discriminator="kind")]


class VADOptions(BaseModel):
    enabled: bool = True
    threshold: float = Field(default=0.5, ge=0.0, le=1.0)


class UVROptions(BaseModel):
    enabled: bool = False
    model: str = "htdemucs"
    stem: Literal["vocals", "instrumental"] = "vocals"


class DiarizeOptions(BaseModel):
    enabled: bool = False
    min_speakers: int | None = Field(default=None, ge=1)
    max_speakers: int | None = Field(default=None, ge=1)


class TextTranslateOptions(BaseModel):
    enabled: bool = False
    provider: TranslateProvider = "nllb"
    target_lang: str = "en"


class TranscribeRequest(BaseModel):
    source: JobSource
    backend: BackendName = "faster_whisper"
    model: str = "large-v3-turbo"
    language: str = "auto"
    task: Literal["transcribe", "translate"] = "transcribe"
    preprocess: dict = Field(default_factory=dict)
    postprocess: dict = Field(default_factory=dict)
    options: dict = Field(default_factory=dict)


class JobCreated(BaseModel):
    job_id: str
    status: str


class JobView(BaseModel):
    job_id: str
    kind: str
    status: str
    stage: str
    progress: float
    created_at: datetime | None = None
    started_at: datetime | None
    finished_at: datetime | None
    error: dict | None
    result: dict | None
    # Lightweight summary fields the UI surfaces in cards — derived server-side
    # so the client doesn't have to walk request.source / file_asset itself.
    source_kind: str | None = None
    source_label: str | None = None
    backend: str | None = None
    model: str | None = None
    language: str | None = None
    duration_sec: float | None = None
    segment_count: int | None = None

    # SQLite stores datetimes naively (no tz). SQLAlchemy's `DateTime(timezone=True)`
    # doesn't change that for the SQLite backend. Everything we write is UTC
    # (datetime.now(UTC) / func.now()), so tag the wire format explicitly with
    # `+00:00`; otherwise JS `new Date(...)` interprets the bare string as
    # local time and the UI shows a 9-hour skew in KST.
    # Runs for both `model_dump()` and `model_dump_json()` — the router calls
    # the Python form, so we have to attach the suffix at that layer.
    @field_serializer("created_at", "started_at", "finished_at")
    def _serialize_utc(self, v: datetime | None) -> str | None:
        if v is None:
            return None
        if v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        return v.isoformat()
