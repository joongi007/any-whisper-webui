---
name: architecture
description: any-whisper-webui 시스템 아키텍처 — api/ai/ui 3-서비스 분리, NATS JetStream 브로커, ai 수평 확장
type: architecture
date: 2026-05-10
revision: 2
supersedes: 2026-05-10 r1 (monolith design)
---

# Architecture — any-whisper-webui (revision 2)

**Date:** 2026-05-10
**Stack:** 플레이북 §3, §4 (워커 분리), §7.1 (DB는 API 한 곳), §2.6 (수평 확장), §2.7 (생산자-소비자 분리).

이전 r1 모놀리스 설계 폐기. 사용자 요구(별도 프로세스 + 내부 통신 + 배치)와 플레이북 §7.1을 충족하도록 3-서비스로 분리.

## 1. 한눈에 보기

```
                       [ Browser ]
                            │ HTTP, WS
                            ▼
                    ┌────────────────┐
                    │  proxy (Caddy) │  :8080
                    └───────┬────────┘
              ┌─────────────┼─────────────┐
              │             │             │
         /api,/ws         else          (static)
              │             │
              ▼             ▼
         ┌────────┐    ┌────────┐
         │  api   │    │   ui   │
         │ FastAPI│    │  Vite  │
         └────────┘    └────────┘
              │
              │  publish "jobs.transcribe" (JetStream WorkQueue)
              ▼
         ┌────────┐
         │  nats  │  JetStream + plain pub/sub
         └────────┘
              ▲             ▲
              │ pull        │ pub
              │             │
      ┌───────┴────────┐    │ "jobs.{id}.progress|done|segment.*"
      │   ai (N개)     │────┘
      │   asyncio +    │
      │ ProcessPool    │
      └────────────────┘
              │
              ▼   write to /data/outputs (shared volume)
         ┌────────┐
         │ /data  │  uploads, outputs, models, db
         └────────┘
              ▲
              │  read/write (api 만 db)
              └──── api
```

## 2. 서비스 책임

### 2.1 `api` (FastAPI)
- HTTP/WS 외부 인터페이스.
- 인증·인가 (현 단계는 single-user, 추후 §5).
- **DB 소유 (§7.1)** — SQLAlchemy + Alembic. ai는 DB에 안 붙음.
- 파일 업로드 → `/data/uploads` 저장.
- 잡 생성 → DB `INSERT` + NATS publish.
- 진행 이벤트 NATS subscribe → DB update + 활성 WS 세션에 fan-out.
- 자막 export (DB의 세그먼트 → SRT/VTT/TXT).
- AI 계산 0. 모델 라이브러리 임포트 없음 (Docker 이미지 가벼움).

### 2.2 `ai` (워커, N개)
- NATS WorkQueue pull consumer로 잡 한 건씩 받음 (비동기 경로).
- **동기 req-reply 경로**(queue group `ai-workers`)도 함께 처리 — 시스템 정보, 모델 적재/해제,
  텍스트 번역, 구간 재변환, 화자 정렬, 성능 벤치마크. api가 결과를 바로 받아야 하는 작업용.
  (목록은 COMMUNICATION.md §B.2.1)
- 모든 파이프라인(whisper / VAD / UVR / diarize / NLLB / DeepL) 보유.
- GPU 직렬화: 인스턴스 내 `asyncio.Semaphore(1)` + **워커 간 NATS KV 락**(`gpu.lock`, TTL).
  단일 GPU를 공유하는 멀티 워커는 이 KV 락으로 직렬화된다(멀티 GPU는 워커당 GPU 핀 + 락 생략).
- **실행 전략**(transcribe): `options.batch_size`로 순차/배치 선택. 배치는
  BatchedInferencePipeline(VAD 경계 튜닝) + word-timestamp 재세그먼트로 순차 수준 품질을
  맞추고, 결과가 비정상(반복 루프·빈 출력)이면 순차로 자동 폴백한다. 하드웨어별 최적은
  `ai.bench.run`으로 실측.
- **마이크로배치**: NLLB 번역 요청을 50ms 또는 8건 단위로 합쳐 한 forward.
- DB 미접근. 결과는 NATS publish + 파일은 `/data/outputs/{job_id}/`.
- 모델 가중치 캐시 `/data/models` (HF/torch).

### 2.3 `ui` (React SPA)
- 정적 빌드 또는 dev Vite. Caddy 뒤.
- API와 같은 오리진. CORS 무관.

### 2.4 `proxy` (Caddy)
- 단일 진입점 :8080 (HTTP). 플레이북 §11.1.
- `/api/*`, `/ws/*` → api.
- 그 외 → ui.

### 2.5 `nats` (NATS Server with JetStream)
- 단일 컨테이너. `/data/nats` 볼륨 (DB와 분리).
- streams: `JOBS` (WorkQueue), `EVENTS` (Limits). 상세 `.refs/2026-05-10-nats-vs-redis.md`.

## 3. 데이터 정책 (§3)

| 무엇 | 어디 | 소유 |
|---|---|---|
| 잡/파일/세그먼트 (원장) | SQLite `/data/whisper.db` | **api** |
| 잡 요청 큐 | NATS JetStream `JOBS` | NATS |
| 진행/세그먼트 이벤트 | NATS JetStream `EVENTS` | NATS |
| 실시간 청크/응답 | plain NATS | NATS |
| 업로드 원본 | `/data/uploads/` | api 쓰기, ai 읽기 |
| 자막/중간산물 | `/data/outputs/{job_id}/` | ai 쓰기, api 읽기 |
| 모델 가중치 캐시 | `/data/models/` | ai |
| NATS 상태 | `/data/nats/` | nats |

원장 단일 소스 = **SQLite**. 이벤트 스트림은 보조. SQLite 단일 writer = api 하나 → 락 문제 없음.

## 4. 동시성 / 배치 (§2)

### 4.1 ai 인스턴스 내부
- I/O와 추론을 분리: 들어오는 NATS 메시지 핸들러는 async. 추론은 `asyncio.to_thread` + GPU 세마포어(1).
- **micro-batcher** (translate, 그리고 batchable한 ASR backend):
  ```
  enqueue(text)  ─┐
                  ├─ 50ms 또는 8건 시 flush → forward([t1..tn]) → 응답 분배
  enqueue(text)  ─┘
  ```

### 4.2 인스턴스 간 (수평 확장 — r2.1에서 모두 구현)
| 메커니즘 | 구현 |
|---|---|
| 잡 분배 | NATS JetStream WorkQueue + durable `ai-workers` — 한 잡 한 워커 |
| req-reply (`ai.system.info`, `ai.translate.text`, `realtime.start`) | NATS queue group `ai-workers` — 한 요청 한 워커 |
| 실시간 세션 어피니티 | api가 `realtime.start` 로 req-reply → 응답한 워커의 `worker_id` 받아 그 워커 inbox (`realtime.worker.{worker_id}.{sid}.chunk\|flush\|stop`) 로만 청크 발행 |
| 단일 GPU 멀티 ai 직렬화 | NATS KV bucket `gpu_locks` 의 키 `gpu.lock` atomic create (TTL 60s) — 워커 죽어도 자동 해제 |
| 멀티 GPU 멀티 ai | 각 컨테이너에 `CUDA_VISIBLE_DEVICES`로 GPU pin. GPU 락은 사실상 무경합 통과. |
| micro-batcher | 인스턴스 로컬(의도). 글로벌 배치 효율 ↑가 필요해지면 별도 batcher 서비스 검토. |

## 5. 폴더 (사용자 명명)

```
.
├── api/                        FastAPI service
│   ├── pyproject.toml          # name: api (Python pkg)
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/versions/
│   └── api/                    # Python package
│       ├── __init__.py
│       ├── __main__.py
│       ├── app.py              # FastAPI factory + lifespan
│       ├── config.py
│       ├── constants.py
│       ├── db.py
│       ├── deps.py
│       ├── logging_setup.py
│       ├── exceptions.py
│       ├── nats_client.py      # connect, publish, subscribe helpers
│       ├── models/             # ORM (api만)
│       ├── repositories/
│       ├── schemas/
│       ├── services/
│       │   ├── job_service.py        # job create/lookup, publishes to NATS
│       │   ├── event_consumer.py     # NATS events → DB + WS fan-out
│       │   ├── realtime_service.py   # WS ↔ NATS bridge
│       │   └── ws_hub.py             # WebSocket session registry
│       └── routers/
│           ├── jobs.py
│           ├── files.py
│           ├── transcripts.py
│           ├── translate.py
│           ├── youtube.py
│           ├── system.py
│           └── ws.py
│
├── ai/                         AI worker
│   ├── pyproject.toml          # name: ai
│   ├── Dockerfile              # CUDA-friendly base
│   └── ai/
│       ├── __init__.py
│       ├── __main__.py         # entry — connect NATS, start consumers
│       ├── config.py
│       ├── constants.py
│       ├── logging_setup.py
│       ├── nats_client.py
│       ├── gpu_lock.py
│       ├── micro_batcher.py
│       ├── pipelines/          # job orchestrators (use backends)
│       │   ├── transcribe.py
│       │   ├── translate.py
│       │   ├── uvr.py
│       │   └── diarize.py
│       ├── realtime/
│       │   └── streamer.py
│       └── backends/
│           ├── whisper/
│           │   ├── base.py
│           │   ├── faster_whisper.py
│           │   ├── openai_whisper.py
│           │   └── insanely_fast.py
│           ├── vad/silero.py
│           ├── uvr/demucs.py
│           ├── diarize/pyannote.py
│           └── translate/
│               ├── nllb.py
│               └── deepl.py
│
├── ui/                         React + Vite + TS
│   ├── package.json
│   ├── Dockerfile
│   ├── vite.config.ts
│   ├── eslint.config.js
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/audio-worklet/pcm-encoder.js
│   └── src/
│       ├── main.tsx, App.tsx, theme.ts, i18n.ts, index.css
│       ├── routes/             # DashboardPage, FilePage, YouTubePage, RealtimePage, HistoryPage, JobDetailPage, SettingsPage
│       ├── components/         # layout, job, transcript, source, pipeline
│       ├── stores/             # zustand
│       ├── hooks/
│       ├── api/                # http clients
│       ├── audio/              # AudioCaptureWorklet, RealtimeStream
│       └── i18n/{en,ko}.json
│
├── Caddyfile
├── docker-compose.yml
├── .env.example
├── LICENSE
├── NOTICE
├── README.md
├── docs/
│   ├── ARCHITECTURE.md         # 요약 · 진입점
│   ├── ARCHITECTURE-design.md  # 본 문서 (설계 기록)
│   └── COMMUNICATION.md        # REST + WS + NATS 주제 계약
└── .refs/                      # 리서치 원본 · 디자인 이터레이션 (참조)
    ├── 2026-05-10-nats-vs-redis.md
    ├── 2026-05-10-whisper-backends.md
    ├── 2026-05-10-realtime-audio.md
    ├── 2026-05-10-licenses.md
    └── design/  (10회 UI 검토, 그대로 유효)
```

> **Python 패키지명 = 폴더명 `api`/`ai`**: 사용자 결정. `from api.config import settings` 형태. `api`/`ai`라는 이름이 PyPI에 있을 수 있으나 컨테이너 내부에서 우리 패키지만 설치하므로 충돌 없음.

## 6. 잡 흐름 — 파일 STT 예

```
Browser ── POST /api/v1/jobs/transcribe ──▶ api
                                              │  INSERT job(status=queued)
                                              │  NATS publish "jobs.transcribe"
                                              ▼ 200 {job_id}
Browser ── WS /ws/jobs/{job_id} ──▶ api (session registered)

[ai worker pulls JOBS consumer]
   │ download/decode → 16kHz wav
   │ VAD (optional)
   │ UVR (optional)
   │ Whisper inference (segments stream)
   │ ─ each segment → NATS publish "jobs.{job_id}.segment.partial"
   │ diarize (optional)
   │ translate (optional)
   │ write outputs/{job_id}/transcript.{srt,vtt,txt}
   │ NATS publish "jobs.{job_id}.done"
   ▼ ack to JetStream

[api event_consumer]
   on segment.partial: UPDATE job.progress + WS send to subscribers
   on done:           UPDATE job.status=succeeded + WS send done
```

## 7. 실시간 흐름

```
Browser ── WS /ws/realtime ──▶ api
                                  │  NATS publish "realtime.{sid}.start" (config)
                                  ▼
                              ai (selected worker)
                                  │ subscribe "realtime.{sid}.chunk" (api → ai)
                                  ▼ emits ↓
                              "realtime.{sid}.{level|vad|partial|final}"
                                  │
api subscribes "realtime.{sid}.>" → forward to that WS session
```

세션 어피니티: ai 1개일 때는 모든 청크가 그 한 인스턴스로 자동. scale 시점에 worker presence + round-robin 도입.

## 8. Docker Compose

```yaml
services:
  proxy:  # Caddy :8080
  ui:     # expose 80 (nginx-served static)
  api:    # expose 8080
  ai:     # no port; pulls NATS
  nats:   # 4222 internal, jetstream on /data/nats
```

GPU: `ai` 서비스에 NVIDIA toolkit 활성화 시 device reservation. 단일 GPU 환경에서 ai를 scale하면 VRAM 공유 → OOM 가능 (README 명시).

## 9. 비기능

- ai 컨테이너 첫 실행: 모델 다운로드 ~수 GB. 진행상황 NATS로 흘림 → UI에 "downloading model".
- api 첫 실행: SQLite + Alembic migrate. 별도 init 컨테이너 없이 lifespan에서 처리.
- 로그: 모든 서비스 structlog JSON to stdout.
- 보안: 로컬 단일 사용자 가정. 인증 없음. Caddy → api/ui only.

## 10. 추후 (의도적 보류)

- 인증 도입 → 플레이북 §5 (JWT RS256, ticket WS).
- DB SQLite → PostgreSQL (멀티 api 인스턴스 시).
- macOS/Linux 시스템 오디오 → Tauri 데스크톱.
- micro-batcher 글로벌화 (현재는 인스턴스 로컬).

## References
- 플레이북 §3, §4, §7.1, §2.6, §2.7
- `.refs/2026-05-10-nats-vs-redis.md`
- `.refs/2026-05-10-whisper-backends.md`
- `.refs/2026-05-10-realtime-audio.md`
- `.refs/2026-05-10-licenses.md`
- `.refs/design/10-final-spec.md` (UI 사양은 그대로 유효)
