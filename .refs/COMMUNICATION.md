---
name: communication
description: REST + WebSocket + NATS 계약 — api/ai/ui 3-서비스 통신 명세 (r2)
type: contract
date: 2026-05-10
revision: 2
supersedes: 2026-05-10 r1 (monolith)
---

# 통신 계약 — any-whisper-webui (revision 2)

**Date:** 2026-05-10
**JSON 키 컨벤션:** `snake_case` (플레이북 §11.7).
**라우트 prefix:** `/api/v1`. WS: `/ws/...`.

## A. 브라우저 ↔ api (REST / WS)

### REST 요약
- `GET  /api/v1/system/info`
- `GET  /api/v1/system/models?backend=...`
- `POST /api/v1/files` (multipart)
- `GET  /api/v1/files/{file_id}`
- `POST /api/v1/jobs/transcribe`  → 즉시 `{job_id}` 반환
- `POST /api/v1/jobs/translate`
- `POST /api/v1/jobs/uvr`
- `POST /api/v1/jobs/diarize`
- `GET  /api/v1/jobs/{id}` / `DELETE /api/v1/jobs/{id}`
- `GET  /api/v1/jobs?kind=&status=&page=&size=`
- `GET  /api/v1/transcripts/{id}` / `GET /api/v1/transcripts/{id}/export?format=srt|vtt|txt`
- `POST /api/v1/youtube/meta`
- `POST /api/v1/translate/text`

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
  "options": { "word_timestamps": true, "compute_type": "float16" }
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
- `.refs/ARCHITECTURE.md` (r2)
- `.refs/2026-05-10-nats-vs-redis.md`
- 플레이북 §5.4, §7.1, §11.7
