---
name: design-index
description: UI 디자인 검토 10회 반복의 인덱스 — 각 반복의 핵심 변화와 채택/폐기 결정 요약
type: design-index
date: 2026-05-10
---

# UI 디자인 검토 10회 — 인덱스

**Date:** 2026-05-10
**규칙:** 각 회차는 이전 회차의 결정을 **비판하고 개선**한다. 단순 변형이 아니라 "전회의 무엇이 부족했고, 이번에 무엇을 바꿨는가"를 명시.
**원칙:** 디자인은 ASCII 와이어프레임 + 구성요소 사양 텍스트로 기록(MUI7/Tailwind4의 토큰을 코드로 풀기 전 단계).

| # | 파일 | 한 줄 요약 |
|---|---|---|
| 1 | [01-baseline.md](./01-baseline.md) | Whisper-WebUI(Gradio)와 동일한 폼-덤프식 단일 페이지. 출발점. |
| 2 | [02-tabbed-sources.md](./02-tabbed-sources.md) | 입력 소스(File/YouTube/Mic/Tab) 탭 분리. 파이프라인 옵션은 사이드. |
| 3 | [03-pipeline-stepper.md](./03-pipeline-stepper.md) | VAD→UVR→Whisper→Diarize→Translate를 명시적 스텝퍼로 시각화. |
| 4 | [04-job-centric.md](./04-job-centric.md) | "한 번 시작하고 떠나라" — 잡 큐 + 진행 카드. 동시 여러 잡. |
| 5 | [05-realtime-split.md](./05-realtime-split.md) | 실시간을 별 페이지로 분리. 자막 라이브 + 메터 + 화자 컬러. |
| 6 | [06-information-density.md](./06-information-density.md) | 정보 밀도 재조정. 옵션 노출/숨김 위계 정리. 모바일 뷰 추가. |
| 7 | [07-progressive-disclosure.md](./07-progressive-disclosure.md) | 초보/숙련자 모드. "Just Run" vs "Tweak Everything". |
| 8 | [08-accessibility-i18n.md](./08-accessibility-i18n.md) | a11y(키보드/스크린리더/콘트라스트), KO/EN 전환, RTL 검토. |
| 9 | [09-error-empty-loading.md](./09-error-empty-loading.md) | 에러/빈/로딩 상태 모두 설계. 누락된 화면 채우기. |
| 10 | [10-final-spec.md](./10-final-spec.md) | 최종 사양 — 디자인 토큰, 컴포넌트 카탈로그, 페이지별 와이어프레임. |
| 11 | [11-prototype-strategy.md](./11-prototype-strategy.md) | "20회 반복" → prototype skill 패턴(3 variants + 사용자 선택)으로 압축. |
| 12 | [12-history-variants.md](./12-history-variants.md) | HistoryPage 3 variants: Card Grid / Dense Table / Date Timeline. |
| 13 | [13-detail-variants.md](./13-detail-variants.md) | JobDetailPage 3 variants: Stacked / Two-pane / Reader. |
| 14 | [14-design-tokens.md](./14-design-tokens.md) | 토큰 단계 업 — 색 세분화 / 그림자 / Inter ss01 / scrollbar / focus ring. |
| 15 | [15-followups.md](./15-followups.md) | 사용자 채택 후 진행할 16~30+ iteration 큐 (다음 단계 명시). |
| 16 | [16-pending.md](./16-pending.md) | 누적 미완 9개 분류 — 이번 turn에 무엇을 하고 무엇을 보류했는지 정직 기록. |
| 17 | [17-followup-plan.md](./17-followup-plan.md) | 16-pending 9개를 가치×비용으로 정렬, 이번 turn에 #20+#21+#19 묶음. |
| 18 | [18-waveform.md](./18-waveform.md) | #17+#28 waveform + scrubber 묶음. wavesurfer.js 도입, WaveformPlayer 컴포넌트로 native audio 대체. |
| 19 | [19-bugfix-overlay-hf.md](./19-bugfix-overlay-hf.md) | 사용자 보고 3 버그 fix (nested anchor, UTC tz, realtime audio hint) + #18.5 boundary overlay + #24 HF guide. |
| 20 | [20-region-editing-workbench.md](./20-region-editing-workbench.md) | 트랜스크립트를 구간별 반복 튜닝 워크벤치로. A:구간 재STT(프리셋/노래) B:세그먼트 insert/move/copy C:실시간 녹화 보존 D:통합 데이터모델. |

## 누적 결정 (final spec 입력)

- **레이아웃:** 좌 사이드바 + 상단 바 + 메인 콘텐츠 + (잡 진행) 우측 슬라이드 패널.
- **테마:** 라이트/다크 + 시스템. accent 1색(violet 600). 폰트: Inter (UI), JetBrains Mono (타임코드).
- **공통 페이지:** Dashboard, File, YouTube, Realtime, History, Settings.
- **상태 표현:** 잡은 카드. 단계 stepper, 진행률 막대, partial/final 자막 차등 표기.
- **모드 토글:** Simple / Advanced (settings에 영구 저장).
- **a11y:** WCAG AA, 키보드 단축키 풀세트, 스크린리더 라벨.
- **i18n:** ko/en 1차. 번역키는 `i18next`.
- **에러:** 페이지별 빈/로딩/에러 상태가 모두 정의됨.
