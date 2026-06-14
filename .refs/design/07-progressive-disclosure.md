---
name: design-07-progressive-disclosure
description: 7회차 — Simple/Advanced 모드. "Just Run"과 "Tweak Everything"의 점진적 공개.
type: design
iteration: 7
date: 2026-05-10
---

# Iter 7 — Progressive Disclosure (Simple / Advanced)

## 이전 비판 → 적용
- (Iter 6 #1/#2) 모드 토글. 사용자가 한 번 선택하면 영구 저장.

## 모드별 UI

### Simple 모드
- 보이는 것:
  - 소스 입력
  - 언어 (auto가 기본)
  - **하나의 큰 [Transcribe] 버튼**
- 숨김:
  - 백엔드/모델 (자동 선택: GPU 있으면 large-v3-turbo, 없으면 small int8)
  - VAD/UVR/Diarize/Translate 등 모든 파이프라인 옵션 (모두 합리적 기본)
- 결과 화면에서 "More options" 클릭 시 Advanced로 한 번에 전환 가능 (스위치).

### Advanced 모드
- 보이는 것: Iter 6에서 정한 Primary + Secondary 모두 펼침.
- Tertiary는 여전히 단계별 슬라이드.

### Wireframe — Simple
```
┌─ Sidebar ┬─────────────────────────────────────────────┬─ Jobs ─┐
│ ...      │ File                                Simple ◉│        │
│          │                                              │        │
│          │     ┌─────────────────────────────┐          │        │
│          │     │     ⬆  Drop your file        │          │        │
│          │     │     or click to browse       │          │        │
│          │     └─────────────────────────────┘          │        │
│          │     my-talk.mp3 (60:02)                      │        │
│          │                                              │        │
│          │     Language [Auto ▾]                        │        │
│          │                                              │        │
│          │     ┌──────────────────────────┐             │        │
│          │     │     Transcribe →         │             │        │
│          │     └──────────────────────────┘             │        │
│          │     ⓘ Auto-tuned for your hardware. Switch  │        │
│          │       to Advanced for full control.          │        │
└──────────┴─────────────────────────────────────────────┴────────┘
```

### Wireframe — Advanced
```
┌─ Sidebar ┬─────────────────────────────────────────────┬─ Jobs ─┐
│ ...      │ File                              Advanced ◉│        │
│          │ ┌────────────────────┐ ┌──────────────────┐ │        │
│          │ │ Drop file          │ │ Pipeline         │ │        │
│          │ │  ...               │ │  ① Source ✓ file │ │        │
│          │ │ my-talk.mp3 60:02  │ │  ② VAD    [✓]    │ │        │
│          │ │                    │ │  ③ UVR    [☐]    │ │        │
│          │ │ Backend [fw ▾]     │ │  ④ Whisper       │ │        │
│          │ │ Model   [lv3-t ▾]  │ │  ⑤ Diarize [☐]   │ │        │
│          │ │ Language[auto ▾]   │ │  ⑥ Translate [☐] │ │        │
│          │ │ Task    [transc.] │ │  ⑦ Export srt+vtt│ │        │
│          │ │ [   Run   ]        │ └──────────────────┘ │        │
│          │ └────────────────────┘                       │        │
│          │ ●━━━━●━━○━━○━━○━━○━━○                        │        │
│          │ Output (live)                                 │        │
└──────────┴─────────────────────────────────────────────┴────────┘
```

## 모드 토글
- 우상단 작은 세그먼트 버튼 `Simple ◉ ─ ◉ Advanced`.
- 토글 시 **부드러운 expand/collapse** (200ms ease).
- 모드는 settings에 persist. 첫 방문은 Simple.

## 두 모드의 라우팅
- 둘 다 같은 페이지 (`/file`, `/youtube`). 모드는 페이지 내부 상태.
- Realtime은 모드 영향 적음 (옵션이 본래 적음). 단 "Diarize live"는 Advanced에서만 노출.

## 새로 떠오른 비판
1. **a11y**: 모드 토글이 키보드/스크린리더에서 명확한지? 라이브 영역의 partial/final 갱신을 스크린리더가 너무 자주 읽지 않게 `aria-live="polite"` 정책.
2. **i18n**: 한국어 사용자 다수가 예상되지만 영어 자막이 다국적 사용자에게 보일 가능성. 텍스트는 i18next로.
3. **콘트라스트**: violet 600의 다크 모드 대비 비율은? WCAG AA 통과 필요.
4. **RTL**(아랍어 등)은 범위 외로 두되, 컴포넌트 구조는 가능성 차단하지 않게.

→ 8회차에서 일괄 정리.
