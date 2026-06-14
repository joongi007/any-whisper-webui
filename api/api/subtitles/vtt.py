from __future__ import annotations

from collections.abc import Iterable

from api.schemas.transcript import TranscriptSegmentView


def _ts(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms == 1000:
        ms, s = 0, s + 1
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def to_vtt(segments: Iterable[TranscriptSegmentView]) -> str:
    out: list[str] = ["WEBVTT", ""]
    for i, seg in enumerate(segments, start=1):
        text = seg.text.strip()
        if seg.speaker:
            text = f"<v {seg.speaker}>{text}"
        out += [str(i), f"{_ts(seg.start)} --> {_ts(seg.end)}", text, ""]
    return "\n".join(out)
