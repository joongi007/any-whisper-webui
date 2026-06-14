---
name: design-09-error-empty-loading
description: 9회차 — 모든 페이지의 빈/로딩/에러 상태 일제 정의. 누락 화면 채우기.
type: design
iteration: 9
date: 2026-05-10
---

# Iter 9 — Empty / Loading / Error 상태 정비

## 원칙
1. **빈 상태(empty)** 는 대화형이어야 한다. "할 일 없음"이 아니라 "여기서 X를 시작하세요".
2. **로딩(loading)** 은 시간이 보여야 한다. 무한 스피너만은 금지. 진행률 추정이 어려우면 작업 단계 텍스트라도.
3. **에러(error)** 는 원인 + 다음 행동 + 회복 경로.

## 페이지별 상태 매트릭스

### Home (Dashboard)
- empty: "최근 잡 없음. 파일 업로드하거나 YouTube URL을 붙여넣어 시작하세요" + 두 큰 카드 [File] [YouTube].
- loading: 시스템 정보 로드 중 → 스켈레톤(GPU 카드, 모델 카드).
- error: 시스템 API 응답 실패 → `Cannot reach API. Is the server running?` + [Retry].

### File
- empty: 드롭존 그대로. 파일 미선택 = 정상 빈.
- loading: 업로드 중 → 진행률 % + 파일명 + [Cancel upload].
- error:
  - 업로드 실패: "Network error during upload" + [Retry] + 파일 보존 (재시도 시 처음부터).
  - 형식 미지원: "We can't read .xyz. Try mp3/mp4/wav/m4a/flac." + [Choose another].
  - 잡 시작 실패 (백엔드 OOM 등): "GPU out of memory. Try a smaller model." + [Open settings].

### YouTube
- empty: 안내 + 유효 URL 예시 (스푸트닉 영상 등 일반적인 무난한 예).
- loading (메타 fetch): "Fetching video metadata…" + 스켈레톤 썸네일.
- error:
  - URL invalid: 입력 옆 빨간 헬퍼 텍스트.
  - 비공개/연령제한/지역제한: 명확한 원인 + "다운로드 권리는 본인이 책임지셔야 합니다" 링크.
  - 다운로드 실패: 일반 메시지 + 로그 다운로드.

### Realtime
- empty: 큰 마이크/모니터 아이콘 + [Connect] 버튼 + 안내 (Tab 공유는 오디오 체크박스 잊지 말 것).
- loading (연결 중): "Connecting to model…" → "Listening (level meter)".
- error:
  - 마이크 권한 거부: 권한 재요청 안내 + 브라우저별 캡처 화면 링크.
  - 디바이스 없음: "No microphones detected".
  - WebSocket 끊김: 자동 재연결 시도 카운터(3회). 실패 시 [Reconnect].
  - VAD/Whisper OOM: "GPU busy with another job. Pausing realtime…" — 다른 잡 끝나면 자동 재개? 또는 사용자 선택? **결정: 자동 재개. 단 toast로 알림**.

### History
- empty: "No jobs yet. Run something to see it here."
- loading: 잡 카드 스켈레톤 5개.
- error: API 실패 → "Couldn't load history" + [Retry].

### Settings
- empty: N/A.
- loading: 설정 저장 중 → 버튼 디저블 + spinner.
- error: 저장 실패 → toast.

## 글로벌 알림 (Snackbar)
- 위치: 우측 하단. 단일 큐, 한 번에 1개 + 다음으로 푸시.
- 5초 자동 닫힘. error는 7초.
- 액션 버튼 1개 가능 (예: "Undo", "Retry").

## 온보딩 (가벼움)
- 첫 방문 시 Dashboard에 banner: "처음이시군요! [3분 투어]" 또는 [닫기].
- 투어는 3 step: ① 파일 업로드 ② 모델 선택 ③ 결과/내보내기. 2초 후 자동 다음으로 이동 X — 사용자 클릭으로만.

## 새로 떠오른 비판
1. **글로벌 알림과 잡 패널 카드 알림이 중복**될 수 있음. 잡 진행/완료/실패는 잡 카드만 사용. 글로벌 토스트는 시스템 레벨(연결 끊김, 설정 저장 등)만.
2. **에러 메시지의 톤** — 사용자 탓처럼 들리지 않게. "We couldn't…" 형식 권장.
3. **Reduced motion**에서 스켈레톤 shimmer 정지.

→ 마지막 10회차에서 모든 결정 통합 + 디자인 토큰 + 컴포넌트 카탈로그 + 페이지별 최종 와이어프레임.
