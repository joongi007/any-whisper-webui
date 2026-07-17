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
    import shutil
    import tempfile

    # Demucs writes multi-GB 44.1kHz stereo stems. On a 9p/DrvFs bind mount
    # (repo on a Windows drive /mnt/* under WSL2) that large write can fail — the
    # process reaches 100% then dies on save. Write stems to a container-local
    # (ext4) temp dir; only the small normalized 16k mono lands on /data.
    tmp_out = Path(tempfile.mkdtemp(prefix="uvr_"))
    # `sys.executable` is the absolute path to THIS interpreter — robust against
    # `python` not being on PATH (it isn't, in the slim image).
    cmd = [
        sys.executable, "-m", "demucs.separate",
        "-n", model, "-d", device, "--two-stems", "vocals",
        "-o", str(tmp_out), str(src_wav),
    ]
    try:
        async with gpu_lock:
            p = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                # MERGE into the inherited env — passing only HF_HOME wiped PATH
                # and broke the subprocess spawn entirely.
                env={**os.environ, "HF_HOME": str(settings.model_cache_dir / "hf")},
            )
            _, err = await p.communicate()
            if p.returncode != 0:
                raise RuntimeError(f"demucs exited {p.returncode}: {_clean_stderr(err)}")

        out = tmp_out / model / src_wav.stem / "vocals.wav"
        if not out.exists():
            raise RuntimeError(f"demucs produced no vocals stem at {out}")

        # Demucs emits 44.1kHz STEREO. Downstream (silero VAD, whisper) expects
        # 16kHz MONO — feeding stereo to silero raises "More than one dimension
        # in audio". Normalise to a drop-in replacement for the 16k mono input.
        from ai.audio.ffmpeg import to_wav_16k_mono
        dst_dir.mkdir(parents=True, exist_ok=True)
        norm = dst_dir / "vocals_16k.wav"
        await to_wav_16k_mono(out, norm)
        log.info("uvr_separated", src=str(src_wav), out=str(norm))
        return norm
    finally:
        shutil.rmtree(tmp_out, ignore_errors=True)


def _clean_stderr(err: bytes) -> str:
    """Demucs writes a tqdm progress bar to stderr (with `\\r`), which used to
    mask the real error. Strip the progress lines and keep the actual message."""
    text = err.decode(errors="ignore").replace("\r", "\n")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and "%|" not in ln]
    if not lines:
        return "(no error output — likely OOM or killed; try disabling UVR or a shorter input)"
    return " | ".join(lines[-4:])
