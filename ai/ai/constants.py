from __future__ import annotations

from typing import Final

# Pipeline stages
STAGE_DOWNLOAD: Final = "download"
STAGE_PRE_VAD: Final = "preprocess_vad"
STAGE_PRE_UVR: Final = "preprocess_uvr"
STAGE_TRANSCRIBE: Final = "transcribe"
STAGE_DIARIZE: Final = "diarize"
STAGE_TRANSLATE: Final = "translate"
STAGE_EXPORT: Final = "export"

TARGET_SAMPLE_RATE: Final = 16_000
