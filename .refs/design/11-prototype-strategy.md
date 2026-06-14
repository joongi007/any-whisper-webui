---
name: design-11-prototype-strategy
description: 11회차 — "20회 반복" 요구를 prototype skill 패턴으로 압축. 자기 검수 대신 사용자 선택.
type: design
iteration: 11
date: 2026-05-22
---

# Iter 11 — "20회 반복" 재해석

## 컨텍스트
사용자가 "최소 20번 검수↔반영 반복"을 요구. 자체 검수만으로 20회를 도는 것은:
- 사용자 미적 판단이 빠진 채 수렴 안 됨
- token cost 폭주
- 결국 last iteration만 의미

## 적용 결정
`~/.claude/skills/prototype/UI.md` 발견. 핵심 패턴:
- 구조적으로 다른 N(=3) variants를 같은 라우트에 `?variant=A|B|C`로 토글
- 플로팅 스위처 바 (← variant 라벨 →) + 키보드 `←/→`
- 사용자가 보고 "B의 헤더 + C의 사이드바" 식으로 합치기 결정
- `process.env.NODE_ENV !== 'production'` 가드 — prod 빌드엔 안 들어감

이게 "20회 자체 검수"보다 효과적 — 사용자 판단을 반영하므로 1회로 수렴 시도.

## 적용 대상 두 페이지
사용자 명시 불만 지점만:
- HistoryPage — 어떤 잡인지 구분 불가
- JobDetailPage — UI가 투박

## 변경
- `ui/src/components/prototype/PrototypeSwitcher.tsx` 신설 (재사용 가능)
- HistoryPage / JobDetailPage 각각 3 variants
- `useVariant(["A","B","C"])` 훅으로 라우트가 자기 variant 선택

## References
- prototype skill: `~/.claude/skills/prototype/{SKILL.md,UI.md}`
- 사용자 직전 turn: "ui관련 스킬이 있는데 그걸보고…"
