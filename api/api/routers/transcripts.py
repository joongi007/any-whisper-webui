from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from api import nats_client
from api.config import settings
from api.constants import FMT_SRT, FMT_TXT, FMT_VTT
from api.db import SessionDep
from api.exceptions import JobNotFound, ValidationFailed
from api.repositories.job_repo import JobRepository
from api.schemas.transcript import TranscriptSegmentView, TranscriptView, WordTiming
from api.subtitles import to_srt, to_txt, to_vtt

v1_transcripts_router = APIRouter(prefix="/api/v1/transcripts", tags=["transcripts"])


def _segments(job) -> list[TranscriptSegmentView]:
    out: list[TranscriptSegmentView] = []
    for s in sorted(job.segments, key=lambda x: x.seq):
        words = [WordTiming(**w) for w in s.words] if s.words else None
        out.append(TranscriptSegmentView(
            start=s.start_sec, end=s.end_sec, text=s.text,
            speaker=s.speaker, translation=s.translation, words=words,
        ))
    return out


@v1_transcripts_router.get("/{transcript_id}")
async def get_transcript(transcript_id: str, session: SessionDep) -> dict:
    repo = JobRepository(session)
    job = await repo.get_with_segments(transcript_id)
    if job is None:
        raise JobNotFound(f"Transcript not found: {transcript_id}")
    view = TranscriptView(
        transcript_id=job.id,
        language=(job.result or {}).get("language"),
        duration_sec=(job.result or {}).get("duration_sec"),
        segments=_segments(job),
    )
    return {"data": view.model_dump()}


@v1_transcripts_router.get("/{transcript_id}/export", response_class=PlainTextResponse)
async def export_transcript(
    transcript_id: str,
    session: SessionDep,
    format: str = Query(FMT_SRT, pattern="^(srt|vtt|txt)$"),
) -> PlainTextResponse:
    repo = JobRepository(session)
    job = await repo.get_with_segments(transcript_id)
    if job is None:
        raise JobNotFound(f"Transcript not found: {transcript_id}")
    segs = _segments(job)
    if format == FMT_SRT:
        body, media, ext = to_srt(segs), "application/x-subrip", "srt"
    elif format == FMT_VTT:
        body, media, ext = to_vtt(segs), "text/vtt", "vtt"
    else:
        body, media, ext = to_txt(segs), "text/plain", "txt"
    return PlainTextResponse(
        body, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{transcript_id}.{ext}"'},
    )


class SegmentPatch(BaseModel):
    """All fields optional. Omit to leave unchanged.
    `null` on `speaker` / `translation` clears the value (router detects
    omit vs explicit-null via `model_dump(exclude_unset=True)`)."""
    text: str | None = Field(default=None, max_length=10_000)
    speaker: str | None = None
    translation: str | None = None
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, ge=0)

    model_config = {"extra": "forbid"}


class RetranscribeRange(BaseModel):
    """Re-run Whisper on a span of a transcript and atomically swap in the new
    segments. Two addressing modes:

    - **seq mode**: `start_seq` + `end_seq` — the time span is read from those
      rows. Used when the user selected existing subtitle lines.
    - **time mode**: `t_start` + `t_end` (seconds) — used when there are no rows
      to select (whisper recognised nothing) and the user drags a span on the
      waveform. Works on an empty transcript.

    Inherits the parent job's backend/model/options; `options_override` nudges
    knobs (preset / UVR / VAD) for just this span."""
    start_seq: int | None = Field(default=None, ge=1)
    end_seq: int | None = Field(default=None, ge=1)
    t_start: float | None = Field(default=None, ge=0)
    t_end: float | None = Field(default=None, ge=0)
    options_override: dict[str, Any] | None = None

    model_config = {"extra": "forbid"}


class _RowIn(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = ""
    speaker: str | None = None
    translation: str | None = None
    model_config = {"extra": "ignore"}


class TimeRangeReplace(BaseModel):
    """Directly replace whatever segments overlap [t_start, t_end] with the
    given rows. Used by the retranscribe Undo (restore the pre-retranscribe
    snapshot) — no inference involved."""
    t_start: float = Field(ge=0)
    t_end: float = Field(ge=0)
    segments: list[_RowIn] = Field(default_factory=list)

    model_config = {"extra": "forbid"}


class SpeakerRename(BaseModel):
    """Bulk-rename one speaker label across a transcript. `to_label=None`
    clears the label (segments become unlabelled)."""
    from_label: str = Field(min_length=1, max_length=200, alias="from")
    to_label: str | None = Field(default=None, max_length=200, alias="to")

    model_config = {"extra": "forbid", "populate_by_name": True}


class SpeakerAlign(BaseModel):
    """Re-assign speakers using the given lines as voice references. Each
    reference seq's CURRENT speaker is the ground-truth label; every line not
    in `reference_seqs` gets matched to the nearest reference voice."""
    reference_seqs: list[int] = Field(min_length=1)

    model_config = {"extra": "forbid"}


class _SpeakerItem(BaseModel):
    seq: int
    speaker: str | None = None
    model_config = {"extra": "forbid"}


class SpeakerSetBulk(BaseModel):
    """Set the speaker on many segments at once. Powers the alignment undo."""
    items: list[_SpeakerItem] = Field(default_factory=list)

    model_config = {"extra": "forbid"}


class SegmentInsert(BaseModel):
    """Insert a new segment after `seq` (use seq=0 to prepend). Timecodes
    optional — default to a tiny window after the anchor's end."""
    text: str = Field(default="", max_length=10_000)
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, ge=0)
    speaker: str | None = None

    model_config = {"extra": "forbid"}


class SegmentMove(BaseModel):
    """Move a segment so it starts at `new_start` (seconds), keeping duration.
    The whole transcript re-sorts by time and renumbers afterwards."""
    new_start: float = Field(ge=0)

    model_config = {"extra": "forbid"}


class SegmentSplit(BaseModel):
    """Split segment `seq` at `split_at` chars of the text. The boundary in
    time is computed from the character ratio (or the explicit `time_ratio`
    if provided), so head and tail timings roughly track speech length."""
    split_at: int = Field(ge=1)
    time_ratio: float | None = Field(default=None, ge=0.05, le=0.95)

    model_config = {"extra": "forbid"}


def _segment_view(seg) -> dict:
    words = [WordTiming(**w) for w in seg.words] if seg.words else None
    return TranscriptSegmentView(
        start=seg.start_sec, end=seg.end_sec, text=seg.text,
        speaker=seg.speaker, translation=seg.translation, words=words,
    ).model_dump()


@v1_transcripts_router.patch("/{transcript_id}/segments/{seq}")
async def patch_segment(
    transcript_id: str, seq: int, body: SegmentPatch, session: SessionDep,
) -> dict:
    repo = JobRepository(session)
    sent = body.model_dump(exclude_unset=True)
    # Ordering guard: `start <= end` after patch. We can't enforce it at the
    # Pydantic level (some patches only carry one of the two), so check here.
    if "start" in sent and "end" in sent and sent["start"] > sent["end"]:
        raise ValidationFailed("start must be <= end")
    seg = await repo.update_segment(job_id=transcript_id, seq=seq, patch=sent)
    if seg is None:
        raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
    return {"data": _segment_view(seg)}


@v1_transcripts_router.post("/{transcript_id}/retranscribe")
async def retranscribe_range(
    transcript_id: str, body: RetranscribeRange, session: SessionDep,
) -> dict:
    """Synchronous re-run of Whisper across a span of a finished transcript.
    Blocks for the inference duration (~5–60s typical).

    Flow: resolve the span's time range (from seqs or given directly) → pull
    the job's options → ask AI worker (NATS request-reply) → atomic
    delete-and-insert via the repo. Returns the new rows."""
    repo = JobRepository(session)
    job = await repo.get_with_segments(transcript_id)
    if job is None:
        raise JobNotFound(f"Transcript not found: {transcript_id}")

    # Determine [t_start, t_end] and which replace strategy to use.
    time_mode = body.t_start is not None and body.t_end is not None
    in_range: list = []
    if time_mode:
        t_start = float(body.t_start)
        t_end = float(body.t_end)
        if t_end <= t_start:
            raise ValidationFailed("t_end must be > t_start")
    else:
        if body.start_seq is None or body.end_seq is None:
            raise ValidationFailed("provide either (start_seq, end_seq) or (t_start, t_end)")
        if body.end_seq < body.start_seq:
            raise ValidationFailed("end_seq must be >= start_seq")
        segs = sorted(job.segments, key=lambda x: x.seq)
        in_range = [s for s in segs if body.start_seq <= s.seq <= body.end_seq]
        if not in_range:
            raise JobNotFound(f"No segments in [{body.start_seq}, {body.end_seq}]")
        t_start = min(s.start_sec for s in in_range)
        t_end   = max(s.end_sec   for s in in_range)

    # Inherit decoding options from the parent job so a retried span uses the
    # same model preset the user originally picked. Per-call overrides win.
    # `backend` / `model` / `language` may also be overridden for the region
    # (e.g. a larger model just for a tricky song span) — they're pulled out of
    # the override dict so they don't end up inside `options`.
    req = job.request or {}
    override = dict(body.options_override or {})
    region_backend = override.pop("backend", None)
    region_model = override.pop("model", None)
    region_language = override.pop("language", None)
    options: dict[str, Any] = dict(req.get("options") or {})
    options.update(override)

    payload = {
        "job_id": transcript_id,
        "t_start": float(t_start), "t_end": float(t_end),
        "backend":  region_backend  or req.get("backend")  or "faster_whisper",
        "model":    region_model    or req.get("model")    or "large-v3-turbo",
        "language": region_language or req.get("language") or "auto",
        "options":  options,
    }

    # Retranscribe is bounded by audio length; 30s + slack covers a multi-min
    # span on a slow GPU. For longer ranges the UI should offer a full rerun.
    reply = await nats_client.request("ai.retranscribe.run", payload, timeout=180.0)
    if reply is None:
        raise ValidationFailed("ai worker did not respond in time")
    if "error" in reply:
        raise ValidationFailed(f"retranscribe failed: {reply['error']}")

    new_rows = list(reply.get("segments") or [])

    # Inherit speaker labels by time overlap. Retranscribe doesn't re-run
    # diarization, so without this the re-done lines come back unlabelled and
    # the user loses the speaker colouring on that span. Carry the old label
    # whose time best overlaps each new line (same idea as the diarizer's
    # assign_speakers, but reusing the existing labels for consistency).
    old_labeled = [
        (s.start_sec, s.end_sec, s.speaker)
        for s in (in_range if not time_mode else job.segments)
        if s.speaker and s.end_sec > t_start and s.start_sec < t_end
    ]
    if old_labeled:
        for row in new_rows:
            best, best_ov = None, 0.0
            for (os, oe, sp) in old_labeled:
                ov = max(0.0, min(float(row["end"]), oe) - max(float(row["start"]), os))
                if ov > best_ov:
                    best_ov, best = ov, sp
            if best and not row.get("speaker"):
                row["speaker"] = best

    if time_mode:
        inserted = await repo.replace_time_range(
            job_id=transcript_id, t_start=t_start, t_end=t_end, new_rows=new_rows,
        )
        replaced = 0  # count of deleted overlaps isn't tracked; not needed by UI
    else:
        inserted = await repo.replace_segment_range(
            job_id=transcript_id,
            start_seq=body.start_seq, end_seq=body.end_seq,
            new_rows=new_rows,
        )
        replaced = len(in_range)
    return {"data": {
        "start_seq": body.start_seq,
        "replaced": replaced,
        "inserted": len(inserted),
        "segments": [_segment_view(s) for s in inserted],
    }}


@v1_transcripts_router.post("/{transcript_id}/segments/replace_time_range")
async def replace_time_range_endpoint(
    transcript_id: str, body: TimeRangeReplace, session: SessionDep,
) -> dict:
    """Swap the segments overlapping [t_start, t_end] for `segments` verbatim.
    Powers the retranscribe Undo — restore the snapshot taken before the run."""
    if body.t_end <= body.t_start:
        raise ValidationFailed("t_end must be > t_start")
    repo = JobRepository(session)
    job = await repo.get(transcript_id)
    if job is None:
        raise JobNotFound(f"Transcript not found: {transcript_id}")
    rows = [
        {"start": r.start, "end": r.end, "text": r.text,
         "speaker": r.speaker, "translation": r.translation}
        for r in body.segments
    ]
    inserted = await repo.replace_time_range(
        job_id=transcript_id, t_start=body.t_start, t_end=body.t_end, new_rows=rows,
    )
    return {"data": {"inserted": len(inserted)}}


@v1_transcripts_router.post("/{transcript_id}/speakers/rename")
async def rename_speaker(
    transcript_id: str, body: SpeakerRename, session: SessionDep,
) -> dict:
    """Bulk-rename a speaker label across every matching segment.

    Used by the transcript editor when the user renames `SPEAKER_00` →
    `Host` etc — typing the name once should re-label every line, not just
    the row they clicked on."""
    repo = JobRepository(session)
    job = await repo.get(transcript_id)
    if job is None:
        raise JobNotFound(f"Transcript not found: {transcript_id}")
    if body.to_label is not None and body.to_label == body.from_label:
        return {"data": {"updated": 0}}
    count = await repo.rename_speaker(
        job_id=transcript_id, from_label=body.from_label, to_label=body.to_label,
    )
    return {"data": {"updated": count}}


@v1_transcripts_router.post("/{transcript_id}/speakers/align")
async def align_speakers(
    transcript_id: str, body: SpeakerAlign, session: SessionDep,
) -> dict:
    """Reference-based speaker re-assignment. The user picks a few lines whose
    speaker labels are correct; the ai worker voice-fingerprints them and
    re-labels every OTHER line to the nearest reference voice. Returns the
    changed rows (with their previous labels) so the UI can offer an undo."""
    repo = JobRepository(session)
    job = await repo.get_with_segments(transcript_id)
    if job is None:
        raise JobNotFound(f"Transcript not found: {transcript_id}")

    ref_set = set(body.reference_seqs)
    by_seq = {s.seq: s for s in job.segments}
    references = [
        {"seq": s.seq, "start": s.start_sec, "end": s.end_sec, "speaker": s.speaker}
        for seq in body.reference_seqs
        if (s := by_seq.get(seq)) is not None and s.speaker
    ]
    if not references:
        raise ValidationFailed("선택한 줄 중 화자가 지정된 줄이 없습니다")
    targets = [
        {"seq": s.seq, "start": s.start_sec, "end": s.end_sec}
        for s in job.segments
        if s.seq not in ref_set
    ]

    reply = await nats_client.request(
        "ai.diarize.align",
        {"job_id": transcript_id, "references": references, "targets": targets},
        timeout=180.0,
    )
    if reply is None:
        raise ValidationFailed("ai 워커 응답 없음 (시간 초과)")
    if "error" in reply:
        raise ValidationFailed(f"speaker align failed: {reply['error']}")

    assignments: dict[str, str] = reply.get("assignments") or {}
    mapping = {int(seq): label for seq, label in assignments.items()}
    # Snapshot prior labels for the changed rows so the UI can undo.
    previous = {
        seq: by_seq[seq].speaker
        for seq in mapping
        if seq in by_seq and by_seq[seq].speaker != mapping[seq]
    }
    changed = await repo.set_speakers_bulk(job_id=transcript_id, mapping=mapping)
    return {"data": {
        "changed": changed,
        "assignments": {str(k): v for k, v in mapping.items()},
        "previous": {str(k): v for k, v in previous.items()},
    }}


@v1_transcripts_router.post("/{transcript_id}/speakers/set_bulk")
async def set_speakers_bulk(
    transcript_id: str, body: SpeakerSetBulk, session: SessionDep,
) -> dict:
    """Set the speaker on many segments at once. Used by the alignment undo."""
    repo = JobRepository(session)
    job = await repo.get(transcript_id)
    if job is None:
        raise JobNotFound(f"Transcript not found: {transcript_id}")
    mapping = {it.seq: it.speaker for it in body.items}
    changed = await repo.set_speakers_bulk(job_id=transcript_id, mapping=mapping)
    return {"data": {"changed": changed}}


@v1_transcripts_router.post("/{transcript_id}/segments/{seq}/split")
async def split_segment(
    transcript_id: str, seq: int, body: SegmentSplit, session: SessionDep,
) -> dict:
    """Split at character position `split_at`. Returns both resulting rows."""
    repo = JobRepository(session)
    original = await repo.get_segment(transcript_id, seq)
    if original is None:
        raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
    text = original.text
    if body.split_at >= len(text):
        raise ValidationFailed(f"split_at must be < len(text) ({len(text)})")
    head = text[: body.split_at].rstrip()
    tail = text[body.split_at:].lstrip()
    if not head or not tail:
        raise ValidationFailed("both head and tail must be non-empty after trim")
    ratio = body.time_ratio if body.time_ratio is not None else (len(head) / max(1, len(head) + len(tail)))
    pair = await repo.split_segment(
        job_id=transcript_id, seq=seq,
        head_text=head, tail_text=tail, split_ratio=ratio,
    )
    if pair is None:
        raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
    head_seg, tail_seg = pair
    return {"data": {"head": _segment_view(head_seg), "tail": _segment_view(tail_seg)}}


@v1_transcripts_router.post("/{transcript_id}/segments/{seq}/insert_after")
async def insert_segment_after(
    transcript_id: str, seq: int, body: SegmentInsert, session: SessionDep,
) -> dict:
    """Insert a fresh segment after `seq` (seq=0 prepends). All later rows shift
    +1, so the caller should refetch."""
    repo = JobRepository(session)
    # Default the new segment to a 2s window right after the anchor's end (or at
    # 0 for a prepend), so it has a sane place on the timeline before editing.
    start = body.start
    end = body.end
    if start is None or end is None:
        if seq == 0:
            start = start if start is not None else 0.0
            end = end if end is not None else (start + 2.0)
        else:
            anchor = await repo.get_segment(transcript_id, seq)
            if anchor is None:
                raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
            start = start if start is not None else anchor.end_sec
            end = end if end is not None else (start + 2.0)
    if start > end:
        raise ValidationFailed("start must be <= end")
    seg = await repo.insert_segment_after(
        job_id=transcript_id, seq=seq,
        start=start, end=end, text=body.text, speaker=body.speaker,
    )
    if seg is None:
        raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
    return {"data": _segment_view(seg)}


@v1_transcripts_router.post("/{transcript_id}/segments/{seq}/duplicate")
async def duplicate_segment(
    transcript_id: str, seq: int, session: SessionDep,
) -> dict:
    """Clone `seq` into a new row right after it. Later rows shift +1."""
    repo = JobRepository(session)
    seg = await repo.duplicate_segment(job_id=transcript_id, seq=seq)
    if seg is None:
        raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
    return {"data": _segment_view(seg)}


@v1_transcripts_router.post("/{transcript_id}/segments/{seq}/move")
async def move_segment(
    transcript_id: str, seq: int, body: SegmentMove, session: SessionDep,
) -> dict:
    """Move `seq` to start at `new_start`; the transcript re-sorts by time and
    renumbers. Returns the moved row with its new seq. Caller should refetch —
    every seq may have changed."""
    repo = JobRepository(session)
    seg = await repo.move_segment_to_time(job_id=transcript_id, seq=seq, new_start=body.new_start)
    if seg is None:
        raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
    return {"data": {"new_seq": seg.seq, **_segment_view(seg)}}


@v1_transcripts_router.post("/{transcript_id}/segments/{seq}/merge_next")
async def merge_segment_next(
    transcript_id: str, seq: int, session: SessionDep,
) -> dict:
    """Merge `seq` with `seq+1` in place. 404 if either neighbour missing."""
    repo = JobRepository(session)
    merged = await repo.merge_segment_next(job_id=transcript_id, seq=seq)
    if merged is None:
        raise JobNotFound(f"Cannot merge: {transcript_id}#{seq} or its next neighbour is missing")
    return {"data": _segment_view(merged)}


@v1_transcripts_router.delete("/{transcript_id}/segments/{seq}")
async def delete_segment(
    transcript_id: str, seq: int, session: SessionDep,
) -> dict:
    """Delete segment `seq`; later rows shift up by 1. Returns the deleted
    row so the UI can offer an undo. 404 if the segment doesn't exist."""
    repo = JobRepository(session)
    deleted = await repo.delete_segment(job_id=transcript_id, seq=seq)
    if deleted is None:
        raise JobNotFound(f"Segment not found: {transcript_id}#{seq}")
    return {"data": _segment_view(deleted)}


def _audio_path_for(transcript_id: str) -> Path | None:
    """ai writes the canonical 16kHz mono wav at /data/outputs/{job}/input_16k.wav.
    We serve that for the editor's audio player — same content the model heard."""
    p = settings.output_dir / transcript_id / "input_16k.wav"
    return p if p.exists() else None


@v1_transcripts_router.get("/{transcript_id}/peaks")
async def get_peaks(transcript_id: str) -> Response:
    """Pre-computed waveform peaks written by the ai pipeline. Lets the UI
    render the waveform instantly instead of waiting on a 5s in-browser decode
    for hour-long files. 404 is a normal fallback — caller should let
    wavesurfer decode the audio itself in that case."""
    p = settings.output_dir / transcript_id / "peaks.json"
    if not p.exists():
        raise JobNotFound(f"Peaks not found: {transcript_id}")
    return FileResponse(
        p, media_type="application/json",
        # Peaks are content-addressed by the wav at write time — they never
        # change for an existing job, so the browser can cache hard.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@v1_transcripts_router.head("/{transcript_id}/audio")
async def head_audio(transcript_id: str) -> Response:
    path = _audio_path_for(transcript_id)
    if path is None:
        raise JobNotFound(f"Audio not found: {transcript_id}")
    size = path.stat().st_size
    return Response(headers={
        "Content-Length": str(size),
        "Accept-Ranges": "bytes",
        "Content-Type": "audio/wav",
    })


@v1_transcripts_router.get("/{transcript_id}/audio")
async def get_audio(
    transcript_id: str,
    request: Request,
    range_header: str | None = Header(default=None, alias="Range"),
) -> Response:
    """Stream source audio with HTTP Range support — required for the <audio>
    element to seek without downloading the whole file (hour-long jobs)."""
    path = _audio_path_for(transcript_id)
    if path is None:
        raise JobNotFound(f"Audio not found: {transcript_id}")

    file_size = path.stat().st_size
    if range_header is None:
        return FileResponse(
            path, media_type="audio/wav",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
        )

    try:
        units, _, rng = range_header.partition("=")
        if units.strip().lower() != "bytes":
            raise ValueError("only byte ranges supported")
        start_str, _, end_str = rng.partition("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        end = min(end, file_size - 1)
        if start > end or start >= file_size:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})
    except ValueError:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    chunk_size = 1 << 16  # 64 KB

    def _iter():
        with path.open("rb") as f:
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                buf = f.read(min(chunk_size, remaining))
                if not buf:
                    break
                yield buf
                remaining -= len(buf)

    return StreamingResponse(
        _iter(), status_code=206, media_type="audio/wav",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(end - start + 1),
        },
    )
