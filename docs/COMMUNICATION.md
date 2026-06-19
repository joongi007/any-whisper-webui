---
name: communication
description: REST + WebSocket + NATS 계약 — api/ai/ui 3-서비스 통신 명세 (r3)
type: contract
date: 2026-06-19
revision: 3
supersedes: 2026-05-10 r2
---

# 통신 계약 — any-whisper-webui (revision 3)

**Date:** 2026-06-19
**JSON 키 컨벤션:** `snake_case` (플레이북 §11.7).
**라우트 prefix:** `/api/v1`. WS: `/ws/...`.

## r3 변경사항 (요약)

큰 구조(3서비스 · JOBS/EVENTS 스트림 · gpu_lock KV)는 r2와 동일. 그동안 추가된 표면을 반영:

- **편집기 REST 다수 추가** — 세그먼트 CRUD(split/insert/duplicate/move/merge/**delete**),
  시간범위 교체, 구간 재변환, 화자 rename/**align**(임베딩 기반 재할당)/set_bulk, 캐시 관리,
  잡 cancel/retry, peaks/audio 스트림.
- **동기 req-reply NATS subjects 다수 추가** (§B.2.1) — 시스템 정보/모델 로드·언로드,
  텍스트 번역, 구간 재변환, 화자 정렬, **성능 벤치마크**. 모두 queue group `ai-workers`로
  한 워커가 응답. JOBS 큐(비동기)와 별개의 동기 경로.
- **실행 모델에 배치 옵션** — TranscribeJobMsg `options.batch_size`(0/1=순차, >1=배치).
  배치는 faster-whisper BatchedInferencePipeline + word-timestamp 재세그먼트(§B.3 참고).
- **`jobs.*.cancel`** 브로드캐스트 subject — 실행 중인 잡 협조적 취소.

## A. 브라우저 ↔ api (REST / WS)

### REST 요약

시스템·잡·파일:
- `GET  /api/v1/system/info`
- `GET  /api/v1/system/models?backend=...`
- `GET  /api/v1/system/cache` / `DELETE /api/v1/system/cache`  (YouTube 캐시 관리)
- `POST /api/v1/system/benchmark`  (실행 전략 벤치마크 → ai에 동기 위임)
- `POST /api/v1/files` (multipart) / `GET /api/v1/files/{file_id}`
- `POST /api/v1/jobs/transcribe`  → 즉시 `{job_id}` 반환
- `GET  /api/v1/jobs/{id}` / `DELETE /api/v1/jobs/{id}`
- `POST /api/v1/jobs/{id}/cancel` / `POST /api/v1/jobs/{id}/retry`
- `GET  /api/v1/jobs?kind=&status=&page=&size=`
- `POST /api/v1/youtube/meta`
- `POST /api/v1/translate/text`

트랜스크립트 · 편집기 (transcripts):
- `GET  /api/v1/transcripts/{id}` / `GET /{id}/export?format=srt|vtt|txt`
- `GET  /api/v1/transcripts/{id}/peaks` / `GET /{id}/audio` (+ HEAD)
- `PATCH  /{id}/segments/{seq}` / `DELETE /{id}/segments/{seq}`
- `POST /{id}/segments/{seq}/split|insert_after|duplicate|move|merge_next`
- `POST /{id}/segments/replace_time_range`
- `POST /{id}/retranscribe`  (seq 또는 시간범위, ai에 동기 위임)
- `POST /{id}/speakers/rename` (라벨 일괄) / `POST /{id}/speakers/align` (임베딩 재할당) / `POST /{id}/speakers/set_bulk`

> `jobs/translate|uvr|diarize` 독립 큐는 계획만 있고 v1 미구현 (transcribe 파이프라인이 후처리로 흡수).

스키마는 r1과 동일 (snake_case, `{data: ...}` 래핑).

### WS — `/ws/jobs/{job_id}`
초기 스냅샷 → progress / segment_partial / segment_final / job_done / job_failed 이벤트.
**차이점 (r2)**: api가 직접 추론하지 않음. **NATS 이벤트를 받아서 WS로 fan-out** 만 함.

### WS — `/ws/realtime`
첫 메시지(text) = `start`. 이후 binary frame = 16kHz mono PCM s16le 100ms. 응답:
- `ready`, `level`, `vad`, `partial`, `final`, `error`, `stopped`.

내부 동작 변경: api는 WS ↔ NATS 브릿지. 모든 추론은 ai.

## B. api ↔ ai (NATS)

### B.1 Streams

**`JOBS` stream** (JetStream, WorkQueuePolicy)
- subjects: `jobs.transcribe`, `jobs.translate`, `jobs.uvr`, `jobs.diarize`
- storage: file
- max_age: 24h
- consumers:
  - `ai-workers` (durable, pull): 모든 ai 인스턴스가 같은 이름으로 join → load balance + 한 메시지 한 워커.

**`EVENTS` stream** (JetStream, LimitsPolicy)
- subjects: `jobs.*.progress`, `jobs.*.segment.partial`, `jobs.*.segment.final`, `jobs.*.done`, `jobs.*.failed`
- storage: file
- max_age: 30m  (api가 잠시 끊겨도 짧은 catch-up 허용)
- consumers:
  - `api-events` (durable, push): api 인스턴스가 join.

**plain NATS (no JetStream)**: realtime — 청크 손실 허용, 빈도 높음.

**`gpu_locks` KV bucket** (JetStream KV, ttl=60s)
- key: `gpu.lock`. value: holding worker_id.
- ai workers attempt atomic `kv.create` → first wins, others retry (sub-second backoff).
- TTL ensures a crashed holder doesn't deadlock subsequent inferences.

### B.2 Subjects 요약표

| 방향 | subject | 페이로드 | 비고 |
|---|---|---|---|
| api → ai | `jobs.transcribe` | TranscribeJobMsg | JetStream `JOBS` |
| api → ai | `jobs.translate` | TranslateJobMsg | JetStream `JOBS` |
| api → ai | `jobs.uvr` | UVRJobMsg | JetStream `JOBS` |
| api → ai | `jobs.diarize` | DiarizeJobMsg | JetStream `JOBS` |
| ai → api | `jobs.{job_id}.progress` | ProgressMsg | JetStream `EVENTS` |
| ai → api | `jobs.{job_id}.segment.partial` | SegmentMsg | JetStream `EVENTS` |
| ai → api | `jobs.{job_id}.segment.final` | SegmentMsg | JetStream `EVENTS` |
| ai → api | `jobs.{job_id}.done` | DoneMsg | JetStream `EVENTS` |
| ai → api | `jobs.{job_id}.failed` | FailedMsg | JetStream `EVENTS` |
| api → ai | `realtime.start` | RealtimeStartMsg | plain **req-reply, queue group `ai-workers`** — one worker claims session, replies `{worker_id, sid}` |
| api → ai | `realtime.worker.{worker_id}.{sid}.chunk` | bytes (PCM s16le) | plain — **only the assigned worker subscribes** |
| api → ai | `realtime.worker.{worker_id}.{sid}.flush` | empty | plain |
| api → ai | `realtime.worker.{worker_id}.{sid}.stop` | empty | plain |
| ai → api | `realtime.{sid}.ready` | ReadyMsg | plain — sid is system-unique so no worker prefix needed on responses |
| ai → api | `realtime.{sid}.level` | LevelMsg | plain |
| ai → api | `realtime.{sid}.vad` | VadMsg | plain |
| ai → api | `realtime.{sid}.partial` | PartialMsg | plain |
| ai → api | `realtime.{sid}.final` | FinalMsg | plain |
| ai → api | `realtime.{sid}.error` | ErrorMsg | plain |
| ai → api | `realtime.{sid}.stopped` | empty | plain |

### B.2.1 동기 req-reply subjects (plain NATS, queue group `ai-workers`)

JOBS 큐(비동기 워크큐)와 별개로, api가 결과를 바로 받아야 하는 작업은 plain NATS
request-reply로 처리한다. queue group `ai-workers` 덕에 워커 하나만 응답한다.

| 방향 | subject | 용도 | 타임아웃 |
|---|---|---|---|
| api → ai | `ai.system.info` | GPU/CUDA/백엔드/모델/diarize 접근성 프로브 | ~2s |
| api → ai | `ai.system.gpu_stats` | nvidia-smi 실시간 샘플 | ~2.5s |
| api → ai | `ai.system.load` / `ai.system.unload` | 모델 적재/해제 | ~120s / ~10s |
| api → ai | `ai.translate.text` | 단건 텍스트 번역 | ~20s |
| api → ai | `ai.retranscribe.run` | 구간 재변환(스팬 추론) | ~180s |
| api → ai | `ai.diarize.align` | 기준 화자 임베딩 기반 전체 재할당 | ~180s |
| api → ai | `ai.bench.run` | 실행 전략(순차/동시성/배치) 벤치마크 | ~200s |
| api → ai (broadcast) | `jobs.*.cancel` | 실행 중 잡 협조적 취소 (큐 그룹 없음 — 전 워커가 확인, 소유 워커가 취소) | fire-and-forget |

### B.3 메시지 스키마 (JSON)

```jsonc
// TranscribeJobMsg — api → ai
{
  "job_id": "01J...",
  "source": { "kind": "file", "storage_path": "/data/uploads/01J....mp3" },
  // or { "kind": "youtube", "url": "..." }
  "backend": "faster_whisper",
  "model": "large-v3-turbo",
  "language": "auto",
  "task": "transcribe",
  "preprocess": { "vad": {"enabled": true, "threshold": 0.5},
                  "uvr": {"enabled": false, "model": "htdemucs", "stem": "vocals"} },
  "postprocess": { "diarize": {"enabled": false, "min_speakers": null, "max_speakers": null},
                   "translate_text": {"enabled": false, "provider": "nllb", "target_lang": "en"} },
  // options는 자유형 dict (api는 그대로 전달). batch_size > 1 이면 ai가
  // BatchedInferencePipeline(VAD 경계 튜닝)로 처리 후 word-timestamp 기준
  // 재세그먼트해서 순차와 비슷한 자막 경계로 정규화한다. 배치 결과가 비정상
  // (반복 루프·빈 출력)이면 자동으로 순차로 폴백한다. 0/1 = 순차.
  "options": { "word_timestamps": true, "compute_type": "float16", "batch_size": 0 }
}

// ProgressMsg
{ "stage": "transcribe", "progress": 0.42 }

// SegmentMsg
{ "seq": 17, "start": 12.3, "end": 14.0, "text": "...", "speaker": null, "words": [...] }

// DoneMsg
{ "transcript_id": "01J...", "language": "ko", "duration_sec": 3602.5,
  "output_files": [
    {"format": "srt", "path": "/data/outputs/01J.../transcript.srt"},
    {"format": "vtt", "path": "/data/outputs/01J.../transcript.vtt"},
    {"format": "txt", "path": "/data/outputs/01J.../transcript.txt"}
  ]
}

// FailedMsg
{ "code": "oom", "message": "..." }
```

```jsonc
// RealtimeStartMsg — api → ai (req-reply)
{
  "session_id": "01J...",
  "backend": "faster_whisper",
  "model": "large-v3-turbo",
  "language": "auto",
  "task": "transcribe",
  "vad": {"enabled": true, "threshold": 0.5},
  "translate_text": {"enabled": false, "provider": "nllb", "target_lang": "en"},
  "audio": {"sample_rate": 16000, "channels": 1, "format": "pcm_s16le", "chunk_ms": 100}
}
// reply (synchronous):
{ "ready": true, "worker_id": "ai-7f3a..." }

// LevelMsg / VadMsg / PartialMsg / FinalMsg — ai → api
{ "rms_db": -34.2 }
{ "speech": true }
{ "start": 12.0, "end": 13.1, "text": "..." }
{ "start": 12.0, "end": 14.0, "text": "...", "speaker": null,
  "translation": { "provider": "nllb", "target_lang": "en", "text": "..." } }
```

### B.4 멱등성·재시도

- `JOBS` 메시지는 WorkQueue. ai는 처리 중 실패 시 nak → 다른 워커가 받음.
- ai는 **같은 job_id를 다시 받으면 처음부터 다시 처리** (output 폴더 덮어쓰기). DB는 api가 관리하므로 ai 측 중복 가드 불필요.
- 진행 이벤트는 보낼 때 시퀀스 번호(`seq` 또는 `progress`)로 단조 증가 보장 → api는 더 작은 값 무시.

### B.5 페이로드 크기 / 옵션

- NATS 기본 max payload 1MB. 실시간 청크 100ms × 16kHz × 2B = 3.2KB → 여유. 잡 메시지도 KB 수준.
- ack timeout: 잡은 60분(긴 영상). realtime은 5초.

## C. ai ↔ ai

없음. 워커끼리 직접 통신 X. 모든 조정은 NATS 통해.

## D. 보안 / 헤더

- 내부망 한정. NATS는 컨테이너 네트워크 안에서만 listen. 자격증명 미사용 (단일 호스트 가정).
- 추후 멀티 호스트 시 NATS TLS + 토큰 도입 (`nats.conf`).
- WS 티켓 패턴(§5.4)은 인증 도입 시.

## E. CORS

- ui와 api 같은 오리진 (Caddy 8080). CORS 헤더 불필요.

## Out of scope (이번 revision)

- 인증 / 멀티유저
- Postgres 마이그레이션

## References
- `docs/ARCHITECTURE-design.md` (설계 기록)
- `.refs/2026-05-10-nats-vs-redis.md`
- 플레이북 §5.4, §7.1, §11.7
