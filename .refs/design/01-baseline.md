---
name: design-01-baseline
description: 1회차 — Whisper-WebUI(Gradio) 동등의 폼-덤프식 단일 페이지. 출발점이자 비판 대상.
type: design
iteration: 1
date: 2026-05-10
---

# Iter 1 — Baseline (모두 한 화면에)

## 컨텍스트
처음에는 가장 단순한 형태로 시작. Whisper-WebUI Gradio UI와 거의 동일하게, 모든 입력·옵션·결과를 단일 페이지에 세로로 쌓는다.

## 와이어프레임
```
┌─────────────────────────────────────────────────────────────┐
│ any-whisper-webui                              [☾] [Settings] │
├─────────────────────────────────────────────────────────────┤
│ Source                                                      │
│ ( ) File   ( ) YouTube URL   ( ) Mic   ( ) Tab Audio        │
│ [ Drag & drop a file or click to browse ............]       │
│                                                             │
│ Whisper                                                     │
│ Backend [faster-whisper ▾]   Model [large-v3-turbo ▾]       │
│ Language [auto ▾]   Task ( ) transcribe  ( ) translate      │
│ Compute [float16 ▾]   Word timestamps [✓]                   │
│                                                             │
│ Pre-processing                                              │
│ VAD [✓] Threshold [0.5]                                     │
│ UVR [ ] Model [htdemucs] Stem [vocals]                      │
│                                                             │
│ Post-processing                                             │
│ Diarize [ ] min [auto] max [auto]                           │
│ Translate text [ ] Provider [NLLB] Target [ko]              │
│                                                             │
│           [   Start   ]                                     │
│                                                             │
│ ─────────── Output ───────────                              │
│ [empty until run]                                           │
│                                                             │
│ Export: [SRT] [VTT] [TXT]                                   │
└─────────────────────────────────────────────────────────────┘
```

## 구성요소
- 라디오 4개로 소스 선택 → 같은 자리의 입력 위젯이 바뀐다.
- 모든 옵션이 항상 노출.
- 단일 [Start] 버튼.

## 비판 — 다음 회차로 넘기는 문제들
1. **소스 라디오 4개가 한 줄에 있는데 입력 폼이 자리만 바뀌어 사용자가 헷갈린다.** YouTube의 URL 박스, 파일의 드래그존, 마이크의 디바이스 선택, Tab의 공유 버튼은 시각/상호작용 맥락이 완전히 다름.
2. **항상 모든 옵션 노출** → 처음 사용자에게 위협적. Whisper가 처음인 사람은 "compute_type"이 뭔지 모름.
3. **결과 영역이 출력만 보여줌**. 잡이 30분 걸릴 때 그동안 뭘 보여줄지 정의 안됨.
4. **실시간 모드가 일반 잡과 같은 자리에 들어옴.** 실시간은 "잡 결과"가 아니라 "스트림"이라 본질적으로 다른 화면이 필요.
5. **하나의 잡만 다룰 수 있다.** 사용자가 60분 영상 두 개를 동시 돌리고 싶을 때 동시성이 보이지 않음.
6. **에러/취소/재시도 인터랙션 없음.**

→ 다음 회차에서 (1)(3)부터 손댄다.
