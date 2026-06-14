from __future__ import annotations

from pydantic import BaseModel


class WordTiming(BaseModel):
    start: float
    end: float
    word: str


class TranscriptSegmentView(BaseModel):
    start: float
    end: float
    text: str
    speaker: str | None = None
    translation: str | None = None
    words: list[WordTiming] | None = None


class TranscriptView(BaseModel):
    transcript_id: str
    language: str | None
    duration_sec: float | None
    segments: list[TranscriptSegmentView]
