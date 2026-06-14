"""Reference-based speaker alignment.

Given user-labelled reference lines (each carries the correct speaker) and a
set of target lines, fingerprint every reference voice, build a centroid per
label, then assign each target line to the nearest centroid by cosine
similarity. The user's labels are the ground truth; we just propagate them.

Synchronous request-reply, like retranscribe — the api blocks on a spinner and
applies the DB swap once we hand back `{assignments: {seq: speaker}}`."""

from __future__ import annotations

from typing import Any

import structlog

from ai.backends.diarize.embedding import embedder
from ai.config import settings

log = structlog.get_logger()


def _norm(v: Any) -> Any:
    import numpy as np
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-8 else v


async def align_speakers(payload: dict[str, Any]) -> dict[str, Any]:
    """`{job_id, references:[{seq,start,end,speaker}], targets:[{seq,start,end}]}`
    → `{assignments: {seq: speaker}}` or `{error: str}`."""
    import numpy as np

    job_id = str(payload["job_id"])
    references = list(payload.get("references") or [])
    targets = list(payload.get("targets") or [])
    if not references:
        return {"error": "no_references"}
    if not targets:
        return {"assignments": {}}

    wav = settings.output_dir / job_id / "input_16k.wav"
    if not wav.exists():
        return {"error": f"audio not found: {wav}"}

    try:
        ref_embs = await embedder.embed(wav, [(r["start"], r["end"]) for r in references])
    except Exception as exc:  # noqa: BLE001
        log.exception("align_reference_embed_failed", job_id=job_id)
        return {"error": str(exc)}

    # Group reference embeddings by their (user-assigned) label → centroid.
    groups: dict[str, list[Any]] = {}
    for r, e in zip(references, ref_embs):
        if e is None:
            continue
        groups.setdefault(str(r["speaker"]), []).append(_norm(e))
    if not groups:
        return {"error": "no_reference_embeddings"}

    labels = list(groups.keys())
    centroids = np.stack([_norm(np.mean(np.stack(groups[l]), axis=0)) for l in labels])

    try:
        tgt_embs = await embedder.embed(wav, [(t["start"], t["end"]) for t in targets])
    except Exception as exc:  # noqa: BLE001
        log.exception("align_target_embed_failed", job_id=job_id)
        return {"error": str(exc)}

    assignments: dict[str, str] = {}
    for t, e in zip(targets, tgt_embs):
        if e is None:
            continue
        sims = centroids @ _norm(e)  # cosine: both sides L2-normalized
        assignments[str(t["seq"])] = labels[int(np.argmax(sims))]

    log.info("align_done", job_id=job_id, refs=len(references),
             targets=len(targets), assigned=len(assignments), labels=len(labels))
    return {"assignments": assignments}
