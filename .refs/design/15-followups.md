---
name: design-15-followups
description: 15회차 — 사용자 채택 후 뒤따를 검수 항목 큐 (5+ iteration 분량 미리 적어둠)
type: design
iteration: 15
date: 2026-05-22
---

# Iter 15 — Follow-ups queue (16 → 30+)

prototype skill: "사용자가 채택한 뒤 → 잃은 variants 삭제 → 채택 variant 정밀 튜닝". 다음 iteration들이 그 부분.

| # | 항목 | 우선순위 |
|---|---|---|
| 16 | 화자별 채팅-style 자막 표시 (diarize 결과 살리기) | high |
| 17 | 오디오 플레이어 waveform (wavesurfer.js) — peaks pre-render | medium |
| 18 | 자막 편집 시 분할/병합/시간 조정 (start/end drag) | medium |
| 19 | 다국어 자막 (translate_text) — 원문/번역 split view | medium |
| 20 | 실시간 세션 저장 → 일반 jobs와 동등 export | medium |
| 21 | History 다중 선택 + 일괄 삭제 | low |
| 22 | 잡 검색 결과 highlight + 그룹별 카운트 | low |
| 23 | Dashboard에 "최근 작업" + "GPU 사용률" 카드 | low |
| 24 | Settings에 HF 토큰 입력 UI (현재는 .env로만) — 보안 검토 후 | low |
| 25 | 모바일 좁은 폭 BottomNav 동작 검증 | medium |
| 26 | a11y aria-live 영역 (실시간 자막 announce 빈도 조절) | medium |
| 27 | 키보드 단축키 도움말 모달 (`?` 핫키) | low |
| 28 | 자막 시간 축 timeline scrubber (오디오 위) | low |
| 29 | Empty/Loading/Error state 일관성 audit (.refs/design/09 적용) | medium |
| 30 | 디자인 토큰 일관성 audit (모든 인라인 색 → 토큰 치환) | low |

## 운영 원칙
사용자가 [채택 → 다음 iteration] 흐름 한 사이클씩. 자체 추측은 안 함.
