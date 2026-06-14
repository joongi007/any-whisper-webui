from __future__ import annotations

from typing import Final

# Job kinds
KIND_TRANSCRIBE: Final = "transcribe"
KIND_TRANSLATE: Final = "translate"
KIND_UVR: Final = "uvr"
KIND_DIARIZE: Final = "diarize"
KIND_REALTIME: Final = "realtime"

# Status
STATUS_QUEUED: Final = "queued"
STATUS_RUNNING: Final = "running"
STATUS_SUCCEEDED: Final = "succeeded"
STATUS_FAILED: Final = "failed"
STATUS_CANCELLED: Final = "cancelled"

# NATS subjects
SUBJ_JOB_TRANSCRIBE: Final = "jobs.transcribe"
SUBJ_JOB_TRANSLATE: Final = "jobs.translate"
SUBJ_JOB_UVR: Final = "jobs.uvr"
SUBJ_JOB_DIARIZE: Final = "jobs.diarize"
SUBJ_EVENTS_WILDCARD: Final = "jobs.*.*"   # progress / done / failed
SUBJ_EVENTS_SEGMENT_WILDCARD: Final = "jobs.*.segment.*"

# Realtime subjects
SUBJ_RT_PREFIX: Final = "realtime"

# Subtitle formats
FMT_SRT: Final = "srt"
FMT_VTT: Final = "vtt"
FMT_TXT: Final = "txt"
