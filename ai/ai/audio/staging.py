from __future__ import annotations

import asyncio
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path


@asynccontextmanager
async def local_copy(src: Path):
    """Copy `src` to a container-local (ext4) temp file, yield its path, then
    delete it.

    torchcodec (pyannote 4.x's audio reader) fails with 'Bad address' when the
    source wav lives on a 9p/DrvFs bind mount — i.e. when the repo is on a
    Windows drive (/mnt/*) under WSL2. soundfile/ffmpeg sequential reads are
    fine there, but torchcodec's access pattern is not. Reading from a local
    copy sidesteps it without moving the whole project off the drive."""
    src = Path(src)
    tmp = Path(tempfile.mkstemp(prefix="stage_", suffix=src.suffix or ".wav")[1])
    try:
        await asyncio.to_thread(shutil.copyfile, str(src), str(tmp))
        yield tmp
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
