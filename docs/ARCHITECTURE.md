# 아키텍처

`any-whisper-webui`는 **3개의 독립 프로세스**(api · ai · ui)가 NATS를 통해 통신하는 구조다.
모놀리식 Gradio 앱이 아니라, 무거운 GPU 추론을 API 서버에서 떼어내 따로 굴리고
필요하면 수평 확장할 수 있게 만든 게 핵심이다.

> 이 문서는 요약 + 진입점이다. 설계 결정의 배경과 더 깊은 내용은
> [ARCHITECTURE-design.md](./ARCHITECTURE-design.md), [COMMUNICATION.md](./COMMUNICATION.md) 참고.

## 한눈에 보기

```
Browser ──HTTP/WS──► proxy(Caddy :8080) ──► api  ──jobs.*──► nats ──pull──► ai (x N)
                                        └──► ui                ▲                │
                                                               └── jobs.{id}.* ─┘
                                                                        │
                          /data (uploads · outputs · models · db) ◄─────┘
```

- 호스트에 노출되는 포트는 **Caddy `8080` 하나**. 나머지 서비스는 내부 네트워크에만 있다.
- `/api/*`, `/ws/*` 는 api로, 그 외는 ui로 Caddy가 분기한다.

## 서비스 책임

| 서비스 | 역할 | 핵심 원칙 |
|---|---|---|
| **api** (FastAPI) | HTTP/WS 외부 인터페이스, SQLite 원장 소유, 잡 발행 | **ML 추론 0.** DB는 여기만 만진다. |
| **ai** (워커, N개) | NATS pull consumer로 잡 수신, GPU 추론, 번역 마이크로배치, 결과 발행 | **DB 미접근.** 공유 볼륨에만 쓴다. |
| **ui** (React + Vite) | SPA. Caddy 뒤 같은 오리진 | 빌드/번들만 담당, 비즈니스 로직 없음 |
| **nats** | JetStream `JOBS`(WorkQueue) · `EVENTS`(Limits) + 실시간 plain pub/sub | 잡 큐 + 진행 이벤트 버스 |
| **proxy** (Caddy) | 단일 진입점 리버스 프록시 | 포트 하나로 묶고 경로 분기 |

## 데이터 흐름 (transcribe 잡)

1. ui가 파일 업로드 / YouTube URL → api `POST`.
2. api가 입력을 `/data`에 저장하고 `jobs.transcribe` 메시지를 JetStream WorkQueue에 발행.
3. ai 워커 중 하나가 pull로 잡을 잡아 전처리(VAD/UVR) → Whisper 추론 → (옵션) 번역/화자분리.
4. ai가 진행/세그먼트/완료 이벤트를 `jobs.{id}.progress|segment.*|done`으로 발행.
5. api가 이벤트를 받아 SQLite에 기록, ui는 WS로 실시간 수신.
6. 결과 오디오/peaks는 공유 볼륨 `/data/outputs/{job}`에 저장 → 편집기에서 재생.

실시간(마이크/탭 오디오) STT는 잡 큐를 거치지 않고 별도 plain NATS pub/sub로 저지연 스트리밍한다.

## 리포지토리 레이아웃

```
.
├── api/            FastAPI 서비스 (Python 3.12) — 라우터, 리포지토리, NATS 발행/소비
├── ai/             AI 워커 (Python 3.12) — 백엔드(whisper/diarize/uvr), 파이프라인
├── ui/             React + TS + Vite — 컴포넌트, 라우트, 스토어, i18n
├── data/           런타임 산출물 (uploads · outputs · models · whisper.db) — git 제외
├── Caddyfile       단일 진입점 프록시 설정
├── docker-compose.yml
├── DESIGN.md       UI 디자인 토큰/원칙 (impeccable 컨텍스트)
├── PRODUCT.md      제품 의도/사용자/안티레퍼런스 (impeccable 컨텍스트)
├── NOTICE / LICENSE
├── docs/           아키텍처 · 통신 계약 · 설계 기록
└── .refs/          리서치 원본 · 디자인 이터레이션 (참조 자료)
```

## 기술 스택

- **api** — FastAPI, SQLAlchemy(async) + aiosqlite, Pydantic, nats-py
- **ai** — faster-whisper(CTranslate2), openai-whisper, insanely-fast-whisper, transformers(NLLB), pyannote.audio, demucs(UVR), silero-vad, yt-dlp, nats-py
- **ui** — React 18, TypeScript, Vite, MUI, Tailwind, Zustand, TanStack Query, react-i18next, wavesurfer.js
- **infra** — NATS JetStream, Caddy, Docker Compose

## 확장 / 배치

ai 워커는 stateless하므로 수평 확장된다.

```bash
docker compose up -d --scale ai=3
```

> ⚠️ 단일 GPU에서 ai를 늘리면 VRAM이 분할돼 OOM 위험. 멀티 GPU 또는 충분한 VRAM에서만 의미 있다.
> 현재 v1은 transcribe 잡만 NATS 큐로 처리한다. translate/uvr/diarize 잡 큐 분리는 추후.
