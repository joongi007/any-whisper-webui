---
name: design-13-detail-variants
description: 13회차 — JobDetailPage 3 variants (Stacked / Two-pane / Reader)
type: design
iteration: 13
date: 2026-05-22
---

# Iter 13 — JobDetailPage variants

## 공통 building blocks (모든 variant 재사용)
- `JobMeta` — status chip + model + backend + language + duration + relative time
- `ProgressBanner` — running/queued 시 한 줄 + progress bar
- `ErrorBanner` — failed 시 code + message
- `ExportRow` — SRT/VTT/TXT 큰 버튼
- `TranscriptViewer` (이미 존재) — 오디오 플레이어 + 인라인 편집 + 검색

## Variant A — Stacked (현 디자인 다듬음)
- 위→아래: 헤더(source label 큼) → 메타 → progress → export → transcript
- 페이지 폭 그대로 사용 (max-width 제한 없음)
- 익숙한 형태, 가장 안전

## Variant B — Two-pane (메타 sticky)
- lg 이상에서 좌측 300px sticky 패널 (메타/progress/export), 우측 transcript
- 자막 길어도 액션은 항상 노출
- 모바일은 1-column으로 fallback

장점: 60분 자막 스크롤 중에도 export 버튼 reachable.
단점: 좁은 폭에서 fallback 필요.

## Variant C — Reader (transcript-first)
- max-width 980px 가운데 정렬
- 헤더 한 줄: filename + 메타 + export 인라인
- transcript가 페이지의 거의 전체

장점: 자막을 "읽고 편집"하는 흐름에 가장 집중.
단점: 메타 정보 한 줄로 압축되어 일부 잘림.

## 결정
prototype 스위처로 비교 후 사용자가 선택.

## 다음 iteration 후보
- 채택 variant 확정 후 spacing/typography 5-10번 정밀 튜닝 (.refs/design/14~20)
- 오디오 플레이어 waveform 추가 검토 (.refs/design/21+)
- 화자별 채팅-style 레이아웃 검토 (diarize 결과 살리기)
