---
name: design-19-bugfix-overlay-hf
description: 19회차 — 3 버그 fix(nested anchor / UTC tz suffix / realtime audio hint) + #18.5 boundary overlay + #24 HF guide card
type: design
iteration: 19
date: 2026-05-24
---

# Iter 19 — 사용자 보고 3 버그 + 큐 2개

## 버그 fix

### 1. `<a> cannot appear as a descendant of <a>`
**증상.** History → JobCard 안의 SRT/VTT/TXT 다운로드 a 태그가 카드 컨테이너 `<Link>` 안에 박혀 nested anchor.

**원인.** `<Box component={Link}>`로 카드 전체를 anchor화하면 어떤 inner anchor도 invalid HTML.

**fix.** [JobCard.tsx](../../ui/src/components/job/JobCard.tsx) 컨테이너를 `<Box role="link" tabIndex={0} onClick={navigate} onKeyDown={Enter/Space → navigate}>`로 교체. inner `<a>` 다운로드들은 `e.stopPropagation()` 으로 카드 click 안 올라가게. cmd+click new-tab은 잃지만 사용 시나리오 작음 — DESIGN.md "Card is the exception"의 일부.

HistoryPage Row는 처음부터 grid sibling 구조(source label만 Link, 다른 cells는 별도)로 nested 아님 — 수정 불필요.

### 2. created_at 시간 9시간 차
**증상.** "방금 녹음했는데 9시간 전" — KST 환경에서 UTC 시간을 local로 잘못 해석.

**원인.** SQLAlchemy `DateTime(timezone=True)`는 SQLite에서 naive로 저장. Pydantic `model_dump()`는 datetime을 그대로 dict에 넣고, FastAPI가 JSON 직렬화 시 `2026-05-24T12:04:03` (tz 없음) 형태로 출력. JS `new Date(...)`는 tz-less ISO 문자열을 **local timezone**으로 해석 — KST(+9)에서 UTC 12:04를 21:04 local로 해석 → 시계와 9h 차이.

**fix.** [api/api/schemas/job.py](../../api/api/schemas/job.py) `JobView`에 `@field_serializer("created_at", "started_at", "finished_at")`. tz-naive면 `replace(tzinfo=UTC)` 후 `isoformat()` → `2026-05-24T12:04:03+00:00`. JS가 UTC로 정확 해석.

**주의.** Pydantic v2의 `when_used="json"` 옵션은 `model_dump_json()` 호출 시만 적용 — 우리 router는 `model_dump()` (Python mode)를 호출하므로 명시적 적용 위해 `when_used` 제거 (default = "always").

### 3. 실시간 audio "못 들고옴"
**증상.** 사용자가 실시간 세션 열어보면 audio player 영역이 비어있고 자막만 보임. 의도된 동작이지만 안내가 없어 "버그" 같음.

**fix.** [TranscriptViewer.tsx](../../ui/src/components/transcript/TranscriptViewer.tsx) `audioMissing` 상태일 때 player 자리에 안내 박스 노출:
> "이 세션은 실시간이라 음원이 보존되지 않아요. 자막 편집·내보내기는 가능합니다."

[WaveformPlayer.tsx](../../ui/src/components/transcript/WaveformPlayer.tsx)에 `onMissing` callback prop 추가 — `'error'` 이벤트 시 부모에 알림.

## #18.5 — Waveform segment boundary overlay

**동기.** Iter 18에서 waveform 도입 후 후속 후보로 명시한 항목. 60분 자막의 segment 경계를 시각으로 알 수 있게.

**구현.**
- `WaveformPlayer.boundaries?: readonly number[]` prop 추가
- 절대 positioning overlay (waveform 위 inset 0, `pointer-events: none` — 클릭 seek 안 가로챔)
- 각 boundary는 1px 세로선, `--border-strong` 색, opacity 0.45 (조용함)
- TranscriptViewer에서 `segments.map(s => s.start)` 로 boundaries 계산, 첫 행 (start=0) 제외
- **500개 cap** — 그 이상이면 stride 샘플링. 1000+ 일 때 DOM 비대 + 시각 잡음 둘 다 회피

**의도적 누락:**
- region 인터랙션 (boundary 클릭 → 그 segment editing) — wavesurfer regions 플러그인이 있지만 DOM 비용 큼. 보류.
- boundary 위 segment 인덱스 라벨 — 60분 영상에서 안 보임. 보류.

## #24 — HuggingFace 토큰 안내 카드

**동기.** 화자 분리(diarize) 활성 조건이 `.env`의 `AI_HUGGINGFACE_TOKEN`인데 UI에서 그 사실을 안 알려줘 사용자가 "왜 화자 분리가 안 되지" 막힘.

**의도적 선택 — 입력 UI 안 만듦.**
- 토큰은 long-lived secret. 브라우저 form에서 받으면 sessionStorage / 백엔드 transit / 로깅 검토 필요. 단일 사용자 로컬 시나리오에 과한 surface.
- `.env` 한 줄 + `docker compose up -d ai` 가 가장 단순한 운영 패턴 — config-secrets.md (`.env`로만 secret 관리) 정합.

**구현** ([HuggingFaceTokenCard.tsx](../../ui/src/components/settings/HuggingFaceTokenCard.tsx)):
- `useQuery(["system-info"])` 30s polling으로 `diarize_available` 실시간 반영
- Ready: success 칩 + "재시작 안 해도 돼" 짧은 안내
- Needs token: warning 칩 + 4-step 가이드 (모델 약관 → 토큰 발급 → `.env` snippet → 컨테이너 재시작) + 외부 링크
- code snippet은 mono pre block, `AI_HUGGINGFACE_TOKEN=hf_xxx` 패턴

Settings page에 LoadedModelsCard 직후 마운트. DESIGN.md "Settings: section마다 overline 라벨" 패턴 유지.

## 검증

`curl /api/v1/jobs?size=1` 응답:
```
created_at: 2026-05-24T12:04:03+00:00
started_at: 2026-05-24T12:04:03.410418+00:00
finished_at: 2026-05-24T12:04:22.165011+00:00
```
모든 datetime에 `+00:00` suffix. JS `new Date()` 정상 해석.

UI는 HMR로 즉시 반영.

## 남은 후속 큐

| # | 항목 | 비용 |
|---|---|---|
| 23 | Dashboard GPU 라이브 사용률 | mid (nvidia-smi NATS poll) |
| 25 | 모바일 BottomNav 검증 | mid (PRODUCT.md 데스크톱 우선) |
| 18.6 | waveform peaks pre-compute (ai pipeline) | mid (5s 디코드 wait가 견딜만하면 보류) |
