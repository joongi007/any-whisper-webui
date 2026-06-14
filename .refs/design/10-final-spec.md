---
name: design-10-final-spec
description: 10회차 — 최종 사양. 디자인 토큰, 컴포넌트 카탈로그, 페이지별 와이어프레임 확정.
type: design
iteration: 10
date: 2026-05-10
---

# Iter 10 — Final Spec

이전 9회 검토에서 확정된 결정을 모두 통합. 코드 작성의 설계 입력으로 사용.

## 1. 디자인 토큰

### 색 (light / dark)
| 토큰 | light | dark | 용도 |
|---|---|---|---|
| `bg.canvas` | `#FAFAF9` | `#0B0B0F` | 페이지 배경 |
| `bg.surface` | `#FFFFFF` | `#15151B` | 카드 배경 |
| `bg.subtle` | `#F1F0EE` | `#1E1E26` | 서브 영역 |
| `border.default` | `#E5E4E0` | `#2A2A33` | 카드 테두리 |
| `text.primary` | `#1A1A1F` | `#F0EFEB` | 본문 |
| `text.muted` | `#6B6A6A` | `#A1A09C` | 보조 |
| `accent.solid` | `#6D28D9` (violet 700) | `#A78BFA` (violet 400) | primary 버튼 |
| `accent.fg-on-solid` | `#FFFFFF` | `#0B0B0F` | accent 위 텍스트 |
| `success` | `#16A34A` | `#4ADE80` | 완료 |
| `warning` | `#D97706` | `#FBBF24` | 경고 |
| `danger` | `#DC2626` | `#F87171` | 에러 |
| `chip.spk[0..7]` | 8색 팔레트 | 8색 팔레트 | 화자 라벨 |

### 타이포
- UI: **Inter** (`var(--font-sans)`), 14px base, line-height 1.5.
- 타임코드/모노: **JetBrains Mono** 13px.
- 헤딩 스케일: 12 / 14 / 16 / 20 / 24 / 32 (px). semibold 600.

### 간격
- spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 (px).
- 섹션 사이 24, 카드 내부 16.

### 모서리/그림자
- radius: `sm=6`, `md=10`, `lg=16`.
- shadow: 카드는 1단(저고도), 모달은 2단.

### 모션
- 표준: 200ms ease. Reduced-motion 시 0ms.
- 잡 카드 등장: 250ms slide-up + fade.

## 2. 그리드 / 폼팩터

| 폼팩터 | 폭 | 사이드바 | 잡 패널 |
|---|---|---|---|
| Wide | ≥1280 | 240px (펼침) | 320px (펼침) |
| Medium | 768~1279 | 64px (rail) | overlay 토글 |
| Narrow | <768 | bottom nav | bottom sheet |

## 3. 컴포넌트 카탈로그

### 레이아웃
- `<AppShell>` — Sidebar + TopBar + Main + (JobsPanel) 4-zone.
- `<Sidebar>` / `<SidebarRail>` / `<BottomNav>`.
- `<TopBar>` — 페이지 제목, 모드 토글(Simple/Advanced), 알림 종, 테마 메뉴.
- `<JobsPanel>` / `<JobsBottomSheet>` — 잡 카드 컨테이너.

### 잡
- `<JobCard kind="active|done|failed">`.
- `<JobStepperDots steps={...} current={n} />` — 가로 dot 표시.
- `<JobStepperVertical>` — 잡 상세 페이지용.
- `<JobProgressBar value={0..1} eta={"2:18"} />`.

### 입력
- `<FileDropZone onSelect>` — 드롭+클릭+키보드.
- `<YouTubeUrlInput />` — URL 검증 + 썸네일 미리보기.
- `<MicSelector />` — `enumerateDevices()` 결과 드롭다운 + 권한 요청.
- `<TabAudioStartButton />` — `getDisplayMedia` 트리거 + 안내 모달.
- `<LanguageSelect />` — Whisper 언어 + auto.

### 옵션
- `<PipelinePlan>` — 7-step 우측 사이드 위젯.
- `<PipelineStepEditor stepId>` — 단계별 슬라이드 패널.

### 출력
- `<TranscriptViewer segments speakers />` — 가상 스크롤 (60분이면 수백 개 세그먼트).
- `<SegmentRow>` — 시각·텍스트·화자칩·번역.
- `<LiveTranscript>` — 실시간 변형, partial/final 차등.
- `<LevelMeter>` — RMS dBFS, ARIA hidden.
- `<ExportMenu transcriptId />` — SRT/VTT/TXT.

### 피드백
- `<EmptyState illustration title hint actions />`.
- `<LoadingSkeleton variant="card|line|grid" />`.
- `<ErrorBox cause action />`.
- `<Snackbar />` — 글로벌, 위치 우하단.

### 시스템
- `<HardwareCard />` — GPU/RAM/ffmpeg.
- `<ThemeMenu />` — System/Light/Dark.
- `<KeyboardHelpDialog />` — `Ctrl+/`.

## 4. 페이지별 최종 와이어프레임

### Dashboard (`/`)
```
┌──────────────────────────────────────────────────────────┐
│ Home                              Simple ◉─◉ Advanced 🔔 │
├──────────────────────────────────────────────────────────┤
│ ┌── Hardware ───────┐  ┌── Recent ──────────────┐         │
│ │ ⚡ NVIDIA RTX 3060 │  │ ✓ talk1.mp3 · 2 min ago│         │
│ │ 12 GB · CUDA 12.4 │  │ ✓ vlog.mp4 · 1 h ago   │         │
│ │ ffmpeg 6.1        │  │ ✕ song.mp3 · OOM       │         │
│ └───────────────────┘  └────────────────────────┘         │
│ ┌── Quick start ────────────────────────────────┐         │
│ │ [⏚ Drop a file]  [▶ YouTube URL]  [🎙 Realtime]│         │
│ └───────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

### File (`/file`) — Iter 7 Advanced 모드 그대로.

### YouTube (`/youtube`)
```
┌── youtube.com/watch?v=… ──┐ ┌── Pipeline ────┐
│ [Paste URL]                │ │ ① Source video │
│ ┌── Thumbnail (16:9) ───┐  │ │ ② VAD          │
│ │  ▶  Title              │  │ │ ③ ...          │
│ │  Channel · 12:34       │  │ └────────────────┘
│ └────────────────────────┘  │
│ Subtitles available: ko, en │
│ [Run]                       │
└─────────────────────────────┘
●━━○━━○━━...
```

### Realtime (`/realtime`) — Iter 5 와이어프레임.

### History (`/history`)
```
Filter: [All ▾] [Last 7 days ▾]   Search [____]   Export selected ▾
┌─ JobCard (done) ───────────────┐
│ ✓ talk1.mp3 · transcribe       │
│ Whisper · large-v3-turbo · 2:34│
│ [⬇ SRT] [⬇ VTT] [→ Open]       │
└────────────────────────────────┘
... (가상 스크롤)
```

### Settings (`/settings`)
```
Sections:
- General: Mode (Simple/Advanced default), Language (UI), Theme.
- Models:
   Whisper backend default [faster-whisper ▾]
   Whisper model default   [large-v3-turbo ▾]
   Compute type            [float16 ▾]
- Translation:
   NLLB model variant      [3.3B ▾]   ⚠ CC-BY-NC, non-commercial only.
   DeepL API key           [********]
- Diarization:
   HuggingFace token       [********]   (pyannote 약관 동의 필요)
- Storage:
   Data folder             /data
   Auto-cleanup            [✓] 30 days
- Privacy:
   Opt-in telemetry        [☐]
```

## 5. 라우트와 네비

```
/                  Home
/file              File 입력
/youtube           YouTube 입력
/realtime          실시간 STT/번역
/history           잡 히스토리
/jobs/:id          잡 상세
/transcripts/:id   자막 뷰어 (외부 공유 링크용)
/settings          설정
```

## 6. 상태 머신 (UI 측면)

### 잡
```
idle → submitting → queued → running → done
                              ↓        ↑
                          cancelled / failed
```

### 실시간
```
disconnected → requesting_permission → connecting → connected_idle
                                            │             │
                                            ↓             ↓
                                          error        speaking → silence
                                                          ↓
                                                     listening (continuous)
                                            ↑
                                       reconnecting (auto x3)
```

## 7. 다음 단계 입력
- 컴포넌트 → MUI7 컴포넌트 + Tailwind4 토큰 클래스로 구현.
- 토큰은 CSS 변수(`:root[data-theme=light|dark]`) + Tailwind config의 `theme.extend.colors`에 동시 노출.
- React Router v6, React Query, Zustand 5, i18next, axios.
- 가상 스크롤은 `react-virtuoso`.

## 회차별 핵심 변화 요약 (Sanity check)
1. baseline: 한 화면 모두.
2. tab으로 소스 분리.
3. pipeline stepper.
4. job-centric, 다잡 패널, History.
5. realtime 페이지 분리.
6. 정보 밀도 + 모바일 (3-tier).
7. Simple/Advanced 모드.
8. a11y + i18n.
9. 빈/로딩/에러 일제 정비.
10. 토큰·컴포넌트·라우트 확정.

→ 코드 작성 입력 완성.
