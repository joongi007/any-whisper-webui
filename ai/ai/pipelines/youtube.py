from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import structlog

from ai.config import settings

log = structlog.get_logger()


def _video_id(url: str) -> str | None:
    """Best-effort YouTube video id for caching. Covers watch, youtu.be,
    shorts, live, embed URLs."""
    try:
        p = urlparse(url)
        vid = parse_qs(p.query).get("v", [None])[0]
        if not vid and p.netloc.endswith("youtu.be"):
            vid = p.path.lstrip("/").split("/")[0] or None
        for seg in ("/shorts/", "/live/", "/embed/"):
            if not vid and seg in p.path:
                vid = p.path.split(seg, 1)[1].split("/")[0] or None
        return vid
    except Exception:  # noqa: BLE001
        return None


async def download_audio(url: str, dst_dir: Path) -> tuple[Path, dict[str, Any]]:
    """Download a YouTube URL's audio as wav, cached by video id in a shared
    dir. A retry (new job_id) or any later job on the same video reuses the
    existing file instead of re-downloading (slow, and prone to the 403 bot
    wall). `dst_dir` is kept for signature compat; downloads land in the cache."""
    import yt_dlp

    cache_dir = settings.output_dir / "youtube_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    vid = _video_id(url)
    if vid:
        cached = cache_dir / f"{vid}.wav"
        if cached.exists() and cached.stat().st_size > 0:
            log.info("youtube_cache_hit", url=url, vid=vid, path=str(cached))
            return cached, {"id": vid, "cached": True}

    opts: dict[str, Any] = {
        "format": "bestaudio/best",
        "outtmpl": str(cache_dir / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
            "preferredquality": "0",
        }],
    }

    def _run() -> dict:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=True)

    info = await asyncio.to_thread(_run)
    rid = info.get("id") or vid
    path = cache_dir / f"{rid}.wav"
    if not path.exists():
        cand = sorted(cache_dir.glob(f"{rid}.*"), key=lambda p: p.stat().st_mtime)
        path = cand[-1] if cand else path
    log.info("youtube_downloaded", url=url, path=str(path), cached=False)
    # Auto-evict oldest files if the cache grew past the configured ceiling.
    # Keep the file we just wrote regardless.
    await asyncio.to_thread(_evict_cache, cache_dir, path)
    return path, info


def _evict_cache(cache_dir: Path, keep: Path) -> None:
    """LRU eviction: while the cache exceeds the limit, delete the oldest file
    (by mtime), never the one just downloaded. 0 disables."""
    max_bytes = int(settings.youtube_cache_max_gb * 1024 ** 3)
    if max_bytes <= 0:
        return
    try:
        files = [p for p in cache_dir.iterdir() if p.is_file()]
        total = sum(p.stat().st_size for p in files)
        if total <= max_bytes:
            return
        for p in sorted(files, key=lambda f: f.stat().st_mtime):
            if total <= max_bytes:
                break
            if p == keep:
                continue
            sz = p.stat().st_size
            try:
                p.unlink()
                total -= sz
                log.info("youtube_cache_evicted", path=str(p), freed=sz)
            except OSError:
                pass
    except Exception:  # noqa: BLE001
        log.warning("youtube_cache_eviction_failed")
