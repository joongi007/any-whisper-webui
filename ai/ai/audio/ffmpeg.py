from __future__ import annotations

import asyncio
from pathlib import Path


async def to_wav_16k_mono(src: Path, dst: Path) -> None:
    """Decode any audio/video to 16 kHz mono PCM WAV."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    p = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-i", str(src),
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(dst),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await p.communicate()
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {src}: {err.decode(errors='ignore')[-512:]}")


async def probe_duration(path: Path) -> float | None:
    import json
    import shutil
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
