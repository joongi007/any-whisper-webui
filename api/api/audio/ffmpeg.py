from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

import structlog

log = structlog.get_logger()


async def ffmpeg_version() -> str | None:
    if shutil.which("ffmpeg") is None:
        return None
    p = await asyncio.create_subprocess_exec(
        "ffmpeg", "-version",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await p.communicate()
    if p.returncode != 0 or not out:
        return None
    parts = out.decode(errors="ignore").splitlines()[0].split()
    return parts[2] if len(parts) >= 3 else None


async def probe_duration(path: Path) -> float | None:
    if shutil.which("ffprobe") is None:
        return None
    p = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "json", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await p.communicate()
    if p.returncode != 0:
        return None
    try:
        return float(json.loads(out.decode())["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return None
