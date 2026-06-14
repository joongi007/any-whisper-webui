from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

v1_youtube_router = APIRouter(prefix="/api/v1/youtube", tags=["youtube"])


class _Req(BaseModel):
    url: str


class _Meta(BaseModel):
    title: str | None
    duration_sec: int | None
    thumbnail: str | None
    uploader: str | None
    available_subtitles: list[str]


@v1_youtube_router.post("/meta")
async def fetch_meta(payload: _Req) -> dict:
    import yt_dlp

    def _extract() -> dict:
        with yt_dlp.YoutubeDL({"quiet": True, "skip_download": True, "no_warnings": True}) as ydl:
            return ydl.extract_info(payload.url, download=False)

    info = await asyncio.to_thread(_extract)
    thumb = None
    if info.get("thumbnails"):
        thumb = info["thumbnails"][-1].get("url")
    if not thumb:
        thumb = info.get("thumbnail")
    subs = sorted(set(list((info.get("subtitles") or {}).keys()) + list((info.get("automatic_captions") or {}).keys())))
    return {"data": _Meta(
        title=info.get("title"),
        duration_sec=info.get("duration"),
        thumbnail=thumb,
        uploader=info.get("uploader"),
        available_subtitles=subs,
    ).model_dump()}
