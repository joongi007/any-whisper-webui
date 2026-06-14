---
name: whisper-backends
description: 3가지 Whisper 구현체 비교 — 기본은 faster-whisper, 사용자가 동적 선택 가능한 어댑터 설계
type: research
date: 2026-05-10
---

# Whisper 백엔드 3종 비교 및 어댑터 설계

**Date:** 2026-05-10
**Context:** 사용자가 `openai/whisper`, `SYSTRAN/faster-whisper`, `Vaibhavs10/insanely-fast-whisper` 중 하나를 선택할 수 있어야 한다. 기본은 `faster-whisper`. 백엔드별 의존성·GPU·정확도 트레이드오프와 어댑터 인터페이스를 정한다.

## Findings

### 1. SYSTRAN/faster-whisper (기본)
- **라이선스:** MIT
- **엔진:** CTranslate2 (CTranslate2 추론 엔진을 사용한 Whisper 재구현)
- **장점:**
  - 동일 정확도에서 openai/whisper 대비 4–5배 빠름, VRAM 절반
  - INT8 양자화로 CPU 추론 실용적 가능
  - **단어 단위 타임스탬프 (`word_timestamps=True`) 지원** → 자막 정밀도 ↑
  - VAD 필터(Silero) 옵션 내장 → 자막 누락↓ (단, 외부 Silero 전처리와 중복 가능)
- **단점:**
  - CTranslate2 의존 → CUDA cuBLAS/cuDNN 호환성에 민감 (CUDA 12.x 권장)
  - large-v3-turbo는 별도 변환 필요 (huggingface에 변환본 있음)
- **API 핵심:**
  ```python
  from faster_whisper import WhisperModel
  model = WhisperModel("large-v3", device="cuda", compute_type="float16")
  segments, info = model.transcribe(path, word_timestamps=True, vad_filter=False, language="ko")
  for seg in segments:  # generator — 끝까지 소비해야 GPU 해제
      ...
  ```

### 2. openai/whisper (참조 구현)
- **라이선스:** MIT
- **엔진:** PyTorch (오리지널)
- **장점:**
  - 정확도의 기준선. faster-whisper와의 비교 디버깅에 유용.
  - 가장 안정적 (가장 오래된 구현)
- **단점:**
  - 느리고 VRAM 많이 씀 (large-v3에서 ~10GB)
  - 단어 타임스탬프는 cross-attention 후처리(`word_timestamps=True`)로 지원하지만 비싸다
- **API 핵심:**
  ```python
  import whisper
  model = whisper.load_model("large-v3")
  result = model.transcribe(path, word_timestamps=True, language="ko")
  ```

### 3. Vaibhavs10/insanely-fast-whisper
- **라이선스:** Apache-2.0
- **엔진:** transformers + Flash Attention 2 + (옵션) BetterTransformer
- **장점:**
  - A100/H100 같은 최신 GPU에서 가장 빠름 (Flash Attn 2)
  - HuggingFace transformers와 동일한 모델 ID로 로드
- **단점:**
  - **Flash Attention 2 필요** → Compute Capability ≥ 8.0 (Ampere 이상). 구형 GPU(예: RTX 2060) 미지원.
  - 단어 타임스탬프는 `return_timestamps="word"` 옵션 — chunk-batch 분할에서 경계가 불안정할 수 있음
  - chunked batching이 기본 → 매우 긴 음성에서 화자 경계가 살짝 어긋날 가능성
- **API 핵심:**
  ```python
  from transformers import pipeline
  pipe = pipeline(
      "automatic-speech-recognition",
      model="openai/whisper-large-v3",
      torch_dtype=torch.float16,
      device="cuda:0",
      model_kwargs={"attn_implementation": "flash_attention_2"},
  )
  out = pipe(path, chunk_length_s=30, batch_size=24, return_timestamps="word")
  ```

## Outcome — 어댑터 설계 결정

`whisper_api/whisper_api/transcribe/backends/` 아래 3개 어댑터를 둔다. 공통 `Protocol`로 추상화:

```python
# transcribe/backends/base.py
from typing import Protocol, AsyncIterator
from ..schema import TranscriptSegment, TranscribeOptions

class TranscribeBackend(Protocol):
    name: str  # "faster_whisper" | "openai_whisper" | "insanely_fast_whisper"
    async def load(self, model_size: str, device: str, compute_type: str) -> None: ...
    async def transcribe(
        self, audio_path: str, opts: TranscribeOptions
    ) -> AsyncIterator[TranscriptSegment]:  # 스트리밍 자막 출력
        ...
    async def unload(self) -> None: ...  # GPU 해제 보장
```

규칙:
- **GPU 추론은 `asyncio.to_thread` + 단일 GPU 락**으로 직렬화 (UVR/diarize와 VRAM 충돌 방지)
- 모델 로드는 lazy. 첫 요청 시 1회 로드 후 LRU 캐시 (max=1, idle 5분 후 unload)
- `TranscribeOptions`는 Pydantic으로 검증. 백엔드별 미지원 옵션은 무시하고 경고 로그(`event="backend_option_ignored"`).

## 모델 사이즈 정책

기본 노출: `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo` (6개). distil 계열은 다음 단계에서.

## 정확도-속도 가이드 (사용자 노출)

| 사용 케이스 | 추천 백엔드 | 모델 |
|---|---|---|
| 일반 PC (RTX 3060 등) | faster-whisper | large-v3 (fp16) 또는 large-v3-turbo |
| CPU only | faster-whisper | small (int8) |
| 최신 GPU (A100/4090) | insanely-fast-whisper | large-v3 |
| 정확도 비교용 | openai/whisper | large-v3 |

## References
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/openai/whisper
- https://github.com/Vaibhavs10/insanely-fast-whisper
- CTranslate2 docs: https://opennmt.net/CTranslate2/
