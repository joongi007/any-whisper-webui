from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import structlog

from ai.config import settings
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()

SUPPORTED = {"htdemucs", "htdemucs_ft", "mdx_extra", "mdx_extra_q"}


async def separate_vocals(src_wav: Path, dst_dir: Path, *, model: str = "htdemucs") -> Path:
    if model not in SUPPORTED:
        raise RuntimeError(f"UVR/Demucs model not whitelisted: {model}")
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        device = "cpu"
    dst_dir.mkdir(parents=True, exist_ok=True)
    # `sys.executable` is the absolute path to THIS interpreter — robust against
    # `python` not being on PATH (it isn't, in the slim image). Was `"python"`,
    # which combined with the env replacement below meant demucs never ran.
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "-n", model, "-d", device, "--two-stems", "vocals",
        "-o", str(dst_dir), str(src_wav),
    ]
    async with gpu_lock:
        p = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            # MERGE into the inherited env — passing only HF_HOME wiped PATH and
            # broke the subprocess spawn entirely.
            env={**os.environ, "HF_HOME": str(settings.model_cache_dir / "hf")},
        )
        _, err = await p.communicate()
        if p.returncode != 0:
            raise RuntimeError(f"demucs failed: {err.decode(errors='ignore')[-512:]}")

    out = dst_dir / model / src_wav.stem / "vocals.wav"
    if not out.exists():
        raise RuntimeError(f"Expected vocals output missing: {out}")

    # Demucs emits 44.1kHz STEREO. Downstream (silero VAD, whisper) expects
    # 16kHz MONO — feeding stereo to silero raises "More than one dimension in
    # audio". Normalise here so every caller gets a drop-in replacement for the
    # original 16k mono input.
    from ai.audio.ffmpeg import to_wav_16k_mono
    norm = out.with_name("vocals_16k.wav")
    await to_wav_16k_mono(out, norm)
    log.info("uvr_separated", src=str(src_wav), out=str(norm))
    return norm
