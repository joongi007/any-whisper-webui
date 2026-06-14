---
name: design-14-design-tokens
description: 14회차 — 디자인 토큰 한 단계 업 (typo/spacing/shadow/scrollbar/focus)
type: design
iteration: 14
date: 2026-05-22
---

# Iter 14 — Design tokens upgrade

## 변경 요약 (`ui/src/index.css`)

### 색
- canvas / surface / subtle / border 세분화 (`--border-strong` 신규)
- `--text-secondary` 신설 (caption은 secondary, 보조 inline은 muted)
- `--accent-soft` (8-12% alpha) — hover/selected 배경
- `--shadow-1/-2/-3` 토큰화 (인라인 rgba 박힌 곳들 통일 후보)

### 타이포
- `font-feature-settings: "ss01", "cv11"` — Inter의 둥근 a/g 활성 → 현대 SaaS 톤
- `text-rendering: optimizeLegibility` + antialias
- `.font-mono`에 `tabular-nums` 강제 → 타임코드 정렬 깔끔

### 스크롤바
- 10px 폭의 round thumb, track 투명
- canvas와 border 사이 2px border로 surface와 분리

### Focus
- 단일 focus ring (accent 2px, offset 2px) — MUI/native/Tailwind 통일

### 모션
- `prefers-reduced-motion` 그대로 보존

## 다음 iteration 후보
- accent 색을 indigo(#4F46E5) vs violet(#6D28D9) vs teal 등 후보 비교 (Iter 15)
- 다크 모드에서 shadow 가시성 점검 (Iter 16)
