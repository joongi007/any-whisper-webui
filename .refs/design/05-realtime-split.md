---
name: design-05-realtime-split
description: 5회차 — 실시간을 별 페이지로 분리. 라이브 자막 + 레벨미터 + 화자 컬러칩.
type: design
iteration: 5
date: 2026-05-10
---

# Iter 5 — Realtime 페이지 분리

## 이전 비판 → 적용
- (Iter 4 #1) **실시간을 별 페이지(`/realtime`)** 로. 잡 모델과 분리.

## Realtime 페이지 와이어프레임
```
┌─ Sidebar ┬────────────────────────────────────────────────┬─ Jobs ─┐
│ ⌂ Home   │ Realtime                              ◉ ●LIVE   │        │
│ ⏚ File   │ ┌──────────────────────────────────────────────┐│        │
│ ▶ YouTube│ │ Source                                        ││        │
│ 🎙 Realtime│ │ ( ) Microphone   (●) Tab/Window audio         ││        │
│ ⌚ History │ │ Device: [Default ▾]                            ││        │
│ ⚙ Settings│ │ [▶ Connect]  [■ Stop]                         ││        │
│          │ ├──────────────────────────────────────────────┤│        │
│          │ │ Level     ▁▂▃▄▅▆▇█▇▆▅▄▃   -22 dB              ││        │
│          │ │ Backend  faster-whisper · large-v3-turbo      ││        │
│          │ │ Lang auto · Translate-text → en               ││        │
│          │ │                                                ││        │
│          │ │ Live transcript                                ││        │
│          │ │ ┌────────────────────────────────────────────┐││        │
│          │ │ │ 00:01 [SPK1] 안녕하세요 반갑…              │││        │
│          │ │ │ 00:03 [SPK1] 오늘 발표는…                  │││        │
│          │ │ │ 00:08 [SPK2] 질문 있습니다                  │││        │
│          │ │ │ 00:10 [SPK1] (typing partial…)              │││        │
│          │ │ └────────────────────────────────────────────┘││        │
│          │ │     EN: Hello, nice to meet you …              ││        │
│          │ │ [⬇ Save SRT so far]  [Clear]                   ││        │
│          │ └──────────────────────────────────────────────┘│        │
└──────────┴────────────────────────────────────────────────┴────────┘
```

## 핵심 요소
- 헤더의 ●LIVE 인디케이터 + 펄스 애니메이션. 연결 상태(WS) 표시.
- 레벨미터: AudioWorklet RMS dBFS, 50ms 갱신. 적색 클립 표시.
- "Live transcript" 영역:
  - 화자별 컬러칩 ([SPK1] 보라, [SPK2] 청록 등).
  - partial은 옅은 회색 + italic. final은 검정/흰색 통상.
  - autoscroll. 사용자가 위로 스크롤하면 일시 정지(스크롤 위치 유지) — UX 디테일.
- "Save SRT so far": 현재 누적 final 자막을 SRT로 다운.
- "Clear": 누적 자막을 비움 (확인 다이얼로그).

## 옵션 슬라이드 패널 (우측 슬라이드)
```
┌──────────────────────────┐
│ Realtime Options         │
│ ──────────────────────── │
│ Backend [faster-whisper▾]│
│ Model   [large-v3-turbo▾]│
│ Language[auto ▾]         │
│ VAD threshold [0.5]      │
│ Translate text [✓] en    │
│ Diarize live  [☐]  ⓘ     │
│   ⓘ 실험적 — 발화 종료    │
│      이후만 화자 라벨링   │
└──────────────────────────┘
```

## 새로 떠오른 비판
1. **공유 시작 UX (Tab Audio)** 가 약하다. 사용자가 "탭 공유 + 오디오 포함" 체크박스를 잊으면 무음. 안내 일러스트/체크리스트 필요.
2. **autoscroll vs 스크롤 멈춤** 인터랙션이 처음 사용자에게 자명하지 않음 — "맨 아래로" 부유 버튼.
3. **연결 끊김 / 재연결** 경로 미설계.
4. **마이크 권한 거부 / 디바이스 없음 / 16kHz 변환 실패** 등 실패 시나리오 미설계.

→ 9회차에서 빈/로딩/에러 상태 일제 정비. 6회차에서는 정보 밀도와 모바일.
