from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.constants import (
    STATUS_CANCELLED,
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_RUNNING,
    STATUS_SUCCEEDED,
)
from api.models import FileAsset, Job, TranscriptSegment


class JobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def create(self, *, job_id: str, kind: str, request: dict, file_asset_id: str | None) -> Job:
        job = Job(
            id=job_id, kind=kind, status=STATUS_QUEUED,
            stage="queued", progress=0.0, request=request, file_asset_id=file_asset_id,
        )
        self._s.add(job)
        await self._s.commit()
        return job

    async def get(self, job_id: str) -> Job | None:
        stmt = (
            select(Job).where(Job.id == job_id)
            .options(selectinload(Job.file_asset))
        )
        return (await self._s.execute(stmt)).scalar_one_or_none()

    async def get_with_segments(self, job_id: str) -> Job | None:
        stmt = (
            select(Job).where(Job.id == job_id)
            .options(selectinload(Job.segments), selectinload(Job.file_asset))
        )
        return (await self._s.execute(stmt)).scalar_one_or_none()

    async def list(self, *, kind: str | None, status: str | None, page: int, size: int) -> tuple[list[Job], int]:
        stmt = (
            select(Job).order_by(Job.created_at.desc())
            .options(selectinload(Job.file_asset))
        )
        if kind:
            stmt = stmt.where(Job.kind == kind)
        if status:
            stmt = stmt.where(Job.status == status)
        items = (await self._s.execute(stmt.offset((page - 1) * size).limit(size))).scalars().all()

        c = select(func.count()).select_from(Job)
        if kind:
            c = c.where(Job.kind == kind)
        if status:
            c = c.where(Job.status == status)
        total = int((await self._s.execute(c)).scalar_one())
        return list(items), total

    async def mark_running(self, job_id: str) -> None:
        job = await self._s.get(Job, job_id)
        if job is None:
            return
        job.status = STATUS_RUNNING
        if job.started_at is None:
            job.started_at = datetime.now(UTC)
        await self._s.commit()

    async def update_progress(self, job_id: str, *, stage: str, progress: float) -> None:
        job = await self._s.get(Job, job_id)
        if job is None:
            return
        if progress < job.progress:
            return  # ignore out-of-order
        job.stage = stage
        job.progress = min(1.0, max(0.0, progress))
        if job.status == STATUS_QUEUED:
            job.status = STATUS_RUNNING
            job.started_at = datetime.now(UTC)
        await self._s.commit()

    async def mark_succeeded(self, job_id: str, *, result: dict[str, Any]) -> None:
        job = await self._s.get(Job, job_id)
        if job is None:
            return
        job.status = STATUS_SUCCEEDED
        job.stage = "done"
        job.progress = 1.0
        job.result = result
        job.finished_at = datetime.now(UTC)
        await self._s.commit()

    async def mark_failed(self, job_id: str, *, error: dict[str, Any]) -> None:
        job = await self._s.get(Job, job_id)
        if job is None:
            return
        job.status = STATUS_FAILED
        job.error = error
        job.finished_at = datetime.now(UTC)
        await self._s.commit()

    async def mark_cancelled(self, job_id: str, *, reason: str = "Cancelled by user") -> None:
        """User-initiated stop. Separate from `mark_failed` so the UI can
        render 'cancelled' as a calm gray chip instead of a red error."""
        job = await self._s.get(Job, job_id)
        if job is None:
            return
        job.status = STATUS_CANCELLED
        job.error = {"code": "cancelled", "message": reason}
        job.finished_at = datetime.now(UTC)
        await self._s.commit()

    async def add_segment(self, *, job_id: str, seq: int, start: float, end: float,
                          text: str, speaker: str | None = None, translation: str | None = None,
                          words: list[dict] | None = None) -> None:
        """Insert one transcript segment. Idempotent on `(job_id, seq)` — a
        second call with the same key is a no-op. This is the safety net for
        NATS event redelivery (ack-timeout, hub.send failures, multi-worker
        races): the table has no UNIQUE constraint yet, so an explicit check
        is the only thing keeping the UI from rendering the same line twice."""
        existing = await self.get_segment(job_id, seq)
        if existing is not None:
            return
        self._s.add(TranscriptSegment(
            job_id=job_id, seq=seq, start_sec=start, end_sec=end, text=text,
            speaker=speaker, translation=translation, words=words,
        ))
        await self._s.commit()

    async def get_segment(self, job_id: str, seq: int) -> TranscriptSegment | None:
        from sqlalchemy import select
        stmt = select(TranscriptSegment).where(
            TranscriptSegment.job_id == job_id, TranscriptSegment.seq == seq,
        )
        return (await self._s.execute(stmt)).scalar_one_or_none()

    async def update_segment(self, *, job_id: str, seq: int,
                             patch: dict) -> TranscriptSegment | None:
        """Apply only the keys present in `patch`
        (`text` / `speaker` / `translation` / `start` / `end`).
        `None` clears a field; omit the key to leave it untouched.
        Callers should pass `model_dump(exclude_unset=True)` of their Pydantic patch."""
        seg = await self.get_segment(job_id, seq)
        if seg is None:
            return None
        if "text" in patch and patch["text"] is not None:
            seg.text = patch["text"]
        if "speaker" in patch:
            seg.speaker = patch["speaker"]
        if "translation" in patch:
            seg.translation = patch["translation"]
        if "start" in patch and patch["start"] is not None:
            seg.start_sec = float(patch["start"])
        if "end" in patch and patch["end"] is not None:
            seg.end_sec = float(patch["end"])
        await self._s.commit()
        return seg

    async def replace_segment_range(
        self, *, job_id: str, start_seq: int, end_seq: int,
        new_rows: list[dict],
    ) -> list[TranscriptSegment]:
        """Atomic replace: delete every segment with `start_seq <= seq <= end_seq`,
        insert `new_rows` (each `{start,end,text,speaker?,translation?,words?}`)
        starting at `start_seq`, and cascade-renumber all segments after the
        range so the sequence stays contiguous.

        Used by the "retranscribe this range" editor action. Returns the new
        rows in seq order so the caller can ship them back to the UI without
        a refetch."""
        from sqlalchemy import delete, select
        if start_seq > end_seq:
            return []
        new_count = len(new_rows)
        old_count = end_seq - start_seq + 1
        shift = new_count - old_count

        # Step 1: drop the old range. CASCADE on seq isn't a foreign-key thing
        # here — segments are flat rows keyed by (job_id, seq). Plain DELETE.
        await self._s.execute(
            delete(TranscriptSegment).where(
                TranscriptSegment.job_id == job_id,
                TranscriptSegment.seq >= start_seq,
                TranscriptSegment.seq <= end_seq,
            )
        )

        # Step 2: shift the tail. Go in the right direction so we never collide
        # mid-update — descending when shifting up, ascending when shifting
        # down. (We have no UNIQUE(job_id, seq) yet, but the direction is what
        # we'd need if/when it lands.)
        if shift != 0:
            tail_stmt = (
                select(TranscriptSegment)
                .where(TranscriptSegment.job_id == job_id, TranscriptSegment.seq > end_seq)
                .order_by(
                    TranscriptSegment.seq.desc() if shift > 0
                    else TranscriptSegment.seq.asc()
                )
            )
            tail = list((await self._s.execute(tail_stmt)).scalars().all())
            for s in tail:
                s.seq = s.seq + shift

        # Step 3: insert the new rows at start_seq..start_seq+new_count-1.
        inserted: list[TranscriptSegment] = []
        for offset, row in enumerate(new_rows):
            seg = TranscriptSegment(
                job_id=job_id, seq=start_seq + offset,
                start_sec=float(row["start"]), end_sec=float(row["end"]),
                text=str(row.get("text", "")),
                speaker=row.get("speaker"),
                translation=row.get("translation"),
                words=row.get("words"),
            )
            self._s.add(seg)
            inserted.append(seg)
        await self._s.commit()
        return inserted

    async def replace_time_range(
        self, *, job_id: str, t_start: float, t_end: float,
        new_rows: list[dict],
    ) -> list[TranscriptSegment]:
        """Time-based region replace: delete every segment overlapping
        [t_start, t_end], insert `new_rows`, then re-sort the whole transcript
        by start time and renumber seq.

        Unlike `replace_segment_range` (which needs existing seqs), this works
        on an EMPTY transcript — the case where whisper recognised nothing and
        the user drags a span on the waveform to retry. With nothing to delete
        it's a pure insert."""
        from sqlalchemy import delete, select
        # Overlap test: seg.start < t_end AND seg.end > t_start.
        await self._s.execute(
            delete(TranscriptSegment).where(
                TranscriptSegment.job_id == job_id,
                TranscriptSegment.start_sec < t_end,
                TranscriptSegment.end_sec > t_start,
            )
        )
        inserted: list[TranscriptSegment] = []
        for row in new_rows:
            seg = TranscriptSegment(
                job_id=job_id, seq=0,  # temp; renumbered below
                start_sec=float(row["start"]), end_sec=float(row["end"]),
                text=str(row.get("text", "")),
                speaker=row.get("speaker"),
                translation=row.get("translation"),
                words=row.get("words"),
            )
            self._s.add(seg)
            inserted.append(seg)
        await self._s.flush()
        # Re-sort everything by start time and renumber seq contiguously.
        rows = list((await self._s.execute(
            select(TranscriptSegment).where(TranscriptSegment.job_id == job_id)
        )).scalars().all())
        rows.sort(key=lambda r: (r.start_sec, r.id))
        for i, r in enumerate(rows, start=1):
            r.seq = i
        await self._s.commit()
        # Return the freshly inserted rows in time order.
        inserted.sort(key=lambda r: r.start_sec)
        return inserted

    async def rename_speaker(
        self, *, job_id: str, from_label: str, to_label: str | None,
    ) -> int:
        """Bulk-rename every segment whose `speaker == from_label`.
        Pass `to_label=None` to clear the label. Returns rows updated.

        Single UPDATE — avoids round-tripping per segment in a long transcript
        (a 60-min podcast with two hosts can have 800+ rows per speaker)."""
        from sqlalchemy import update
        stmt = (
            update(TranscriptSegment)
            .where(
                TranscriptSegment.job_id == job_id,
                TranscriptSegment.speaker == from_label,
            )
            .values(speaker=to_label)
        )
        result = await self._s.execute(stmt)
        await self._s.commit()
        return int(result.rowcount or 0)

    async def set_speakers_bulk(
        self, *, job_id: str, mapping: dict[int, str | None],
    ) -> int:
        """Set the speaker on many segments in one go. `mapping` is seq → label
        (None clears). Returns the count of rows actually changed. Used by the
        reference-based speaker alignment and its undo."""
        if not mapping:
            return 0
        from sqlalchemy import select
        stmt = (
            select(TranscriptSegment)
            .where(
                TranscriptSegment.job_id == job_id,
                TranscriptSegment.seq.in_(list(mapping.keys())),
            )
        )
        rows = list((await self._s.execute(stmt)).scalars().all())
        changed = 0
        for seg in rows:
            new = mapping.get(seg.seq)
            if seg.speaker != new:
                seg.speaker = new
                changed += 1
        await self._s.commit()
        return changed

    async def _segments_after(self, job_id: str, seq: int) -> list[TranscriptSegment]:
        """Ordered list of segments with `seq > seq`. Used by split/merge to
        cascade the renumbering. SQLite handles ~thousands of rows fine."""
        from sqlalchemy import select
        stmt = (
            select(TranscriptSegment)
            .where(TranscriptSegment.job_id == job_id, TranscriptSegment.seq > seq)
            .order_by(TranscriptSegment.seq.asc())
        )
        return list((await self._s.execute(stmt)).scalars().all())

    async def split_segment(
        self, *, job_id: str, seq: int, head_text: str, tail_text: str,
        split_ratio: float = 0.5,
    ) -> tuple[TranscriptSegment, TranscriptSegment] | None:
        """Split segment `seq` into two. New segment becomes `seq+1`, all
        subsequent rows shift down by 1.

        `split_ratio` (0..1) controls where the timecode boundary lands;
        defaults to 0.5 (middle). Callers may pass a length-weighted ratio
        for "split at cursor" UX. Words array is dropped on split — we don't
        try to re-bucket word timings."""
        seg = await self.get_segment(job_id, seq)
        if seg is None:
            return None
        ratio = max(0.05, min(0.95, split_ratio))
        boundary = seg.start_sec + (seg.end_sec - seg.start_sec) * ratio
        # Step 1: cascade subsequent seq+1 — do this DESCENDING so we never
        # hit a unique-constraint collision on (job_id, seq) along the way.
        # Our schema has no unique on (job_id, seq); plain UPDATE order is fine
        # but bottom-up is still safer if a constraint is added later.
        after = await self._segments_after(job_id, seq)
        for s in reversed(after):
            s.seq = s.seq + 1
        # Step 2: shrink head, insert tail.
        old_end = seg.end_sec
        seg.text = head_text
        seg.end_sec = boundary
        seg.words = None  # word timings invalidated by edit
        tail = TranscriptSegment(
            job_id=job_id, seq=seq + 1,
            start_sec=boundary, end_sec=old_end,
            text=tail_text, speaker=seg.speaker, translation=None, words=None,
        )
        self._s.add(tail)
        await self._s.commit()
        return seg, tail

    async def insert_segment_after(
        self, *, job_id: str, seq: int,
        start: float, end: float, text: str = "",
        speaker: str | None = None,
    ) -> TranscriptSegment | None:
        """Insert a new segment right after `seq` (becomes `seq+1`); cascade all
        later rows down by 1. `seq=0` inserts at the very front. Returns the new
        row, or None if `seq` doesn't exist (and seq != 0)."""
        if seq != 0:
            anchor = await self.get_segment(job_id, seq)
            if anchor is None:
                return None
        # Shift the tail down, descending so we never collide mid-update.
        after = await self._segments_after(job_id, seq)
        for s in reversed(after):
            s.seq = s.seq + 1
        new = TranscriptSegment(
            job_id=job_id, seq=seq + 1,
            start_sec=float(start), end_sec=float(end),
            text=text, speaker=speaker, translation=None, words=None,
        )
        self._s.add(new)
        await self._s.commit()
        return new

    async def duplicate_segment(self, *, job_id: str, seq: int) -> TranscriptSegment | None:
        """Clone `seq` as a new row at `seq+1` (text/speaker/translation copied,
        words dropped). Same timecodes as the original — the user retimes the
        copy via the inline editor. Subsequent rows shift down by 1."""
        src = await self.get_segment(job_id, seq)
        if src is None:
            return None
        after = await self._segments_after(job_id, seq)
        for s in reversed(after):
            s.seq = s.seq + 1
        copy = TranscriptSegment(
            job_id=job_id, seq=seq + 1,
            start_sec=src.start_sec, end_sec=src.end_sec,
            text=src.text, speaker=src.speaker, translation=src.translation, words=None,
        )
        self._s.add(copy)
        await self._s.commit()
        return copy

    async def move_segment_to_time(
        self, *, job_id: str, seq: int, new_start: float,
    ) -> TranscriptSegment | None:
        """Move a segment to a new start time (keeping its duration), then
        re-sort the whole transcript by start time and renumber seq. This is the
        "cut + paste-at-time" model from design doc B.4(c): the user drags a line
        to a new moment and everything re-orders around it. Returns the moved row
        (with its new seq), or None if `seq` is missing."""
        from sqlalchemy import select
        target = await self.get_segment(job_id, seq)
        if target is None:
            return None
        dur = max(0.0, target.end_sec - target.start_sec)
        target.start_sec = max(0.0, float(new_start))
        target.end_sec = target.start_sec + dur
        await self._s.flush()
        # Re-sort all rows by start time and renumber. Tie-break by old seq so a
        # paste landing exactly on another row's start is deterministic.
        rows = list((await self._s.execute(
            select(TranscriptSegment).where(TranscriptSegment.job_id == job_id)
        )).scalars().all())
        rows.sort(key=lambda r: (r.start_sec, r.id))
        for i, r in enumerate(rows, start=1):
            r.seq = i
        await self._s.commit()
        return target

    async def merge_segment_next(self, *, job_id: str, seq: int,
                                 joiner: str = " ") -> TranscriptSegment | None:
        """Merge `seq` with `seq+1` into one row at `seq`. Subsequent rows
        shift up by 1. Returns the merged row, or None if either neighbour
        is missing."""
        head = await self.get_segment(job_id, seq)
        tail = await self.get_segment(job_id, seq + 1)
        if head is None or tail is None:
            return None
        head.text = f"{head.text.rstrip()}{joiner}{tail.text.lstrip()}"
        head.end_sec = tail.end_sec
        # Translation: keep head's if present, otherwise inherit tail's.
        if not head.translation and tail.translation:
            head.translation = tail.translation
        # Speaker: only keep if both agree; conflict → null (UI can re-tag).
        if head.speaker != tail.speaker:
            head.speaker = None
        head.words = None
        await self._s.delete(tail)
        # Cascade renumber: rows after the deleted one shift up by 1.
        after = await self._segments_after(job_id, seq + 1)
        for s in after:
            s.seq = s.seq - 1
        await self._s.commit()
        return head

    async def delete_segment(self, *, job_id: str, seq: int) -> TranscriptSegment | None:
        """Remove segment `seq` entirely; rows after it shift up by 1 so the
        sequence stays contiguous. Returns the deleted row (a detached snapshot
        the router can echo back for undo), or None if `seq` doesn't exist."""
        seg = await self.get_segment(job_id, seq)
        if seg is None:
            return None
        # Snapshot fields before deletion — the ORM object is unusable after.
        snapshot = TranscriptSegment(
            job_id=job_id, seq=seq,
            start_sec=seg.start_sec, end_sec=seg.end_sec,
            text=seg.text, speaker=seg.speaker, translation=seg.translation,
        )
        await self._s.delete(seg)
        # Ascending decrement is collision-free: each row drops into the slot
        # the previous one just vacated.
        after = await self._segments_after(job_id, seq)
        for s in after:
            s.seq = s.seq - 1
        await self._s.commit()
        return snapshot

    async def upsert_file(self, *, file_id: str, filename: str, storage_path: str,
                          size_bytes: int, duration_sec: float | None, mime_type: str | None) -> FileAsset:
        a = FileAsset(
            id=file_id, filename=filename, storage_path=storage_path,
            size_bytes=size_bytes, duration_sec=duration_sec, mime_type=mime_type,
        )
        self._s.add(a)
        await self._s.commit()
        return a

    async def get_file(self, file_id: str) -> FileAsset | None:
        return await self._s.get(FileAsset, file_id)

    async def delete_job(self, job_id: str) -> bool:
        """Remove the job row (segments cascade via the relationship)."""
        job = await self._s.get(Job, job_id)
        if job is None:
            return False
        await self._s.delete(job)
        await self._s.commit()
        return True
