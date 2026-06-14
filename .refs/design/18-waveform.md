---
name: design-18-waveform
description: 18회차 — #17 waveform + #28 scrubber 묶음. 기존 native <audio>를 wavesurfer.js 기반 WaveformPlayer로 대체.
type: design
iteration: 18
date: 2026-05-24
---

# Iter 18 — Waveform + scrubber

## 변경 동기 (.refs/design/17 큐의 #17 + #28)

자막 편집 보조에서 가장 큰 누락: **이 구간이 음성의 어디에 있는지**를 사용자가 시각적으로 모름. native `<audio>`의 progress bar는:

- 60분 영상에서 1px 가로 = 약 14초 → 정확한 클릭 seek 불가
- waveform 자체 없음. 무음/대화/노이즈 구분 안 됨
- timeline scrubber와 별도 컴포넌트가 아니라 audio control 안에 갇혀 있음

## 채택 라이브러리

`wavesurfer.js@^7.12.7`. 단일 의존성, ESM, ~80KB gzip. peaks pre-compute 안 해도 자체 디코드 + 다운샘플.

대안 검토 (제외):
- 자체 Canvas + Web Audio API: 1주 작업, 검증 비용 큼
- howler.js: audio control만, waveform 없음
- @wavesurfer/react: thin wrapper. 직접 useImperativeHandle로 충분.

## 디자인

WaveformPlayer 컴포넌트 한 행:

```
[▶ 36px circle]   ━━━━━━━━━━━ waveform ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   00:01:23 / 00:42:18
                  ↑ click anywhere to seek
                  ↑ progress fill = accent color
                  ↑ cursor line = accent-strong
                  ↑ bars = text-muted (quiet at rest)
```

- accent는 진행 영역 한정 — DESIGN.md "one hue at a time" 준수
- bar 2px wide, gap 1px → 거친 분해능, 60분 영상도 빠른 디코드
- 38px height total (waveform 56px - bar inset)
- 좌측 play 버튼은 accent solid, hover/disabled 상태 분기
- 우측 타임코드 mono, tabular-nums

Loading 동안: 같은 영역에 skeleton 표시 (지오메트리 안 흔들림).
Error (404 — realtime 세션) 시: 컴포넌트 자체가 null 반환 → TranscriptViewer가 player 영역 collapse.

## 배선 (TranscriptViewer)

- `useRef<HTMLAudioElement>` → `useRef<WaveformHandle>`
- `playSegment(seg)` → `waveRef.current?.seekAndPlay(seg.start)`
- `addEventListener("timeupdate")` → wavesurfer `onTimeUpdate` callback prop
- active segment 강조 로직(파란 좌측 border + violet bg) 그대로

## 비결정 / 미해결

- **세그먼트별 region 시각화 보류**: wavesurfer.js regions 플러그인이 있지만 60분 자막 = 수백 region → DOM 폭주. timeline scrubber 위에 boundary 가는 선만 그리는 단순 접근이 더 적합. 다음 turn 후보.
- **peaks pre-compute 안 함**: ai pipeline에서 waveform peaks json을 저장하면 첫 로드가 빠르지만 추가 backend 작업 + 디스크. 60분 wav가 ~5초 디코드면 견딜 만.
- **realtime 세션은 audio 없음**: 의도. WaveformPlayer가 error 처리 → null 반환 → UI는 transcript만 보임.

## DESIGN.md 영향

`WaveformPlayer`는 카드 → `--shadow-1`로 둘러 카드처럼 보이지만 nested 아님 (별도 row). "Card is the exception" 원칙 부합. accent는 진행 fill + play 버튼만 — 화면에 하나의 hue.
