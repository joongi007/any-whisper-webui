from __future__ import annotations

from collections.abc import Iterable

from api.schemas.transcript import TranscriptSegmentView


def to_txt(segments: Iterable[TranscriptSegmentView]) -> str:
    lines: list[str] = []
    for seg in segments:
        text = seg.text.strip()
        if seg.speaker:
            text = f"[{seg.speaker}] {text}"
        lines.append(text)
    return "\n".join(lines) + "\n"
