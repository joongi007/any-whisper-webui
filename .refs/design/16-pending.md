---
name: design-16-pending
description: 16회차 — 그동안 사용자 요구 누적에서 못 끝낸 작업 명확화. 이번 turn에 처리할 것·다음 turn으로 보류할 것 구분.
type: design
iteration: 16
date: 2026-05-24
---

# Iter 16 — 미완 정리

`/impeccable live도 써서 못한 일들을 다 이어서 해줘. 무엇을 못했는지 정리하고 모든 작업을 완료해줘.`

한 turn에 정직하게 다 못 들어가므로 분류한다.

## 이번 turn에 완료 (Priority 1)

| # | 항목 | 이유 |
|---|---|---|
| P1a | UI 카피 em dash 일괄 제거 | impeccable hard ban. 5분 작업. |
| P1b | AppShell / Sidebar / TopBar polish | 새 OKLCH 토큰 적용 가시화 |
| P1c | Dashboard 재설계 (hero-metric 회피) | 사용자 "디자인 구려" 1차 응답 |
| P1d | HistoryPage = Dense Table 채택 + 다른 variants 제거 | prototype §6 — 채택 후 정착 |
| P1e | JobDetailPage = Two-pane 채택 + 다른 variants 제거 | 동일 |
| P2a | TranscriptViewer chat-style speaker 그룹핑 + 자막 머리글 | 화자 분리(diarize) 가시화 |
| P2b | 키보드 단축키 도움말 모달 (`?` 핫키) | UX 일관 |
| P2c | Empty/Loading/Error 일관성 audit | impeccable harden 비슷 |
| L  | impeccable live config + helper 시작 (인터랙티브는 사용자 클릭) | 사용자 호출 충족 |

## 다음 turn 보류 (Priority 3)

이번 turn에 시간/토큰 안 됨. 명시.

| # | 항목 | 비용 |
|---|---|---|
| 17 | 오디오 waveform (wavesurfer.js peaks pre-render) | 외부 의존 + UI 큰 변경 |
| 18 | 자막 세그먼트 분할/병합/시간 drag | edit-mode 확장 |
| 19 | 원문/번역 split view | 레이아웃 한 단계 |
| 20 | 실시간 세션 저장 → 일반 jobs export | api+ui 양쪽 |
| 21 | History 다중 선택 + 일괄 삭제 | 선택 모델 추가 |
| 23 | Dashboard에 "GPU 사용률" 라이브 | nvidia-smi NATS poll |
| 24 | Settings에 HF 토큰 입력 UI | 보안 검토 필요 |
| 25 | 모바일 BottomNav 동작 검증 | viewport 별 테스트 |
| 28 | 자막 시간 timeline scrubber | 오디오 player + 동기 |

## 사용자가 직접 해줘야 하는 것

- **impeccable live의 진짜 가치**: 브라우저에서 요소 클릭 → variants 받기. helper만 띄워 두고, 사용자가 브라우저에서 click하면 우리 (다음 turn에) live-poll 회수.
