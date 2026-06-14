---
name: nats-vs-redis-broker
description: api↔ai 브로커로 NATS JetStream 선택 — 단일 바이너리 + pub/sub + persistent + req-reply 한 곳에서 처리
type: research
date: 2026-05-10
---

# 브로커 선택 — NATS JetStream

**Date:** 2026-05-10
**Context:** api 서비스가 잡 요청을 발행하고, ai 워커가 받아 처리한 뒤 진행 이벤트와 결과를 다시 api에 돌려보내야 한다. 동일 인터페이스로 파일 잡(분~수 분)과 실시간 청크(수십 ms)를 모두 지원하면서, ai 워커를 `docker compose --scale ai=N` 으로 늘릴 수 있어야 한다.

## Findings

| 후보 | 단일 바이너리 | pub/sub | persistent queue | req-reply | group consumer | 무게 |
|---|---|---|---|---|---|---|
| **NATS JetStream** | ✓ | ✓ | ✓ | ✓ | pull consumer + WorkQueuePolicy | 가장 가벼움 (~10MB) |
| Redis Streams | ✓ | △ (pubsub은 비-persistent) | ✓ | △ (직접 구성) | XREADGROUP | 가벼움 |
| RabbitMQ | △ | ✓ | ✓ | ✓ | ✓ | 무거움 (Erlang 런타임) |
| Kafka | ✗ (zookeeper/KRaft) | ✓ | ✓ | ✗ | ✓ | 매우 무거움 |
| HTTP + 내부 큐 | n/a | ✗ | ✗ | ✓ (HTTP) | n/a | 가벼움 |

## NATS JetStream의 결정 이유

1. **단일 바이너리.** docker compose 한 줄 (`nats:alpine -js`). zookeeper/etcd 같은 외부 의존 없음.
2. **WorkQueuePolicy + pull consumer로 N개 ai 워커가 자연스럽게 작업 분배.** 한 메시지는 한 컨슈머만 받음 + ack 기반 재시도.
3. **req-reply도 같은 인프라.** 실시간 STT의 짧은 왕복 메시지도 같은 NATS 클라이언트로 보낼 수 있음.
4. **subject hierarchy.** `jobs.transcribe`, `jobs.{id}.progress`, `realtime.{sid}.chunk` 같은 점-구분 주제. wildcard subscribe(`jobs.*.progress`)로 api가 모든 진행 이벤트를 한 번에 구독.
5. **플레이북 §7.x와 정합.** "API ↔ 워커 사이 이벤트 라우터" 패턴이 플레이북이 NATS를 기본 후보로 두는 이유와 같음.

## NATS의 알려진 한계와 대응

- **메시지 순서 보장은 stream/consumer 범위 안에서만.** 우리는 `jobs.{id}.*`를 같은 stream에 두고, 같은 job_id에 대해서는 순서 의존 코드를 작성하지 않음 (idempotent 이벤트로 설계).
- **JetStream 디스크 IO.** SQLite와 같은 볼륨에 두지 말 것. `/data/nats` 별도.
- **client library 선택.** Python: `nats-py` (공식). asyncio 친화.

## Stream / Consumer 설계

### Stream `JOBS`
- subjects: `jobs.>` 중 **요청 메시지** 만 — `jobs.transcribe`, `jobs.translate`, `jobs.uvr`, `jobs.diarize`.
- retention: WorkQueuePolicy (consumer가 ack하면 메시지 삭제).
- consumer: `ai-workers` (pull consumer, durable). 모든 ai 인스턴스가 같은 durable 이름으로 join → load balance.

### Stream `EVENTS`
- subjects: `jobs.*.progress`, `jobs.*.segment.partial`, `jobs.*.segment.final`, `jobs.*.done`, `jobs.*.failed`.
- retention: LimitsPolicy (예: 30분 또는 100MB). api가 잠시 끊겨도 재구독해 따라잡을 수 있게.
- consumer: api 인스턴스가 push consumer로 subscribe. (api도 추후 N개 띄울 수 있게 ephemeral consumer로 — 각자가 모든 이벤트를 받아 자기 WS 세션에 라우팅. 단일 api 단계에서는 무해.)

### Plain NATS (non-JetStream)
- `realtime.{session_id}.chunk` — 16kHz PCM 100ms 청크. 매우 빈번하고 잃어도 다음 청크가 빠르게 옴 → JetStream 오버헤드 아까움. plain subject로 fire-and-forget. ai가 같은 session_id에 대해 같은 인스턴스로 가도록 partition key는 별도 메커니즘 필요 — 아래 참조.

### 세션 어피니티 (realtime)
- 청크 sequence는 같은 ai 인스턴스가 받아야 누적 상태(VAD on/off, 누적 발화 버퍼) 유지가 단순.
- 해결: **api가 세션 시작 시점에 ai 인스턴스를 하나 골라**(round-robin) 그 인스턴스의 inbox subject로만 chunk 발행. ai 인스턴스마다 고유 inbox subject (예: `realtime.worker.{worker_id}.chunk`) → api는 시작 응답에서 받은 worker_id로 발행.
- 단순 대안: ai 1개 단계에서는 이 문제 미존재. scale 시점에 도입.

## References
- NATS docs: https://docs.nats.io/nats-concepts/jetstream
- nats-py: https://github.com/nats-io/nats.py
- Plyabook routing table — "NATS event router for service-to-service"
