---
name: design-06-information-density
description: 6회차 — 정보 밀도/계층 정리. 모바일 폼팩터 추가. 잡 패널 자동 접기.
type: design
iteration: 6
date: 2026-05-10
---

# Iter 6 — 정보 밀도 + 모바일

## 이전 비판 → 적용
- (Iter 4 #2/#3) 모바일 대응. 잡 패널 토글.
- 화면 폭에 따른 3-tier 레이아웃.

## 폼팩터별 레이아웃

### Wide (≥1280px) — Iter 4 형태 유지
```
[ Sidebar ][          Main          ][ Jobs Panel ]
  240px         flexible              320px
```

### Medium (768~1279px)
- Sidebar는 **레일 모드**(아이콘만, 64px). 호버 시 라벨 노출.
- Jobs 패널은 **오버레이 토글**(우측 슬라이드 인). 기본 숨김. 헤더의 `Jobs (2)` 배지 클릭으로 토글.
```
[Rail][          Main          ]
  64px      flexible
                                ← Jobs Panel slide-in (320px overlay)
```

### Narrow (<768px) — 모바일
- Sidebar는 **하단 탭바(BottomNav)** — 5개 아이콘.
- Jobs는 헤더 종 아이콘 → **풀스크린 시트(BottomSheet)**.
- 옵션 패널들은 **풀스크린 시트**.
- 메인 영역은 한 번에 한 가지만.
```
┌──────────────────────┐
│  any-whisper · ⚙ · 🔔 │
├──────────────────────┤
│                      │
│        Main          │
│                      │
├──────────────────────┤
│ ⌂ ⏚ ▶ 🎙 ⌚            │   ← BottomNav
└──────────────────────┘
```

## 정보 밀도 위계 (모든 폼팩터 공통)

옵션을 3계층으로 분리:
1. **Primary (항상 보임):** Backend, Model, Language, Run/Connect.
2. **Secondary (Pipeline 영역에서 펼침):** VAD on/off, UVR on/off, Diarize on/off, Translate on/off.
3. **Tertiary (각 단계 클릭 시 슬라이드):** threshold, model variant, target_lang, compute_type, beam_size.

기본 사용자는 Primary만 보고 시작 → 70% 케이스 커버.

## 잡 패널 정책
- Wide: 펼침이 기본. 사용자가 닫으면 접힘 상태 기억.
- Medium/Narrow: 닫힘이 기본. 새 잡 시작 시 1.5초간 자동 노출(토스트형) 후 접힘.
- 잡이 0개일 때는 패널 자체가 사라짐(폭 회수).

## 새로 떠오른 비판
1. 옵션 위계가 명확해졌지만, **신규 사용자가 "Just transcribe my file"** 만 하고 싶을 때 여전히 4-5번 클릭 필요. 더 짧은 길 필요.
2. **고급 사용자가 매번 옵션을 펼치는 것**도 비효율. 모드 토글로 한 방에 노출/접기?
3. 모바일에서 옵션 풀스크린 시트는 OK지만, 옵션 변경 후 **메인으로 돌아오는 길**이 명확해야 함(닫기 X 큰 버튼).

→ 7회차에서 Simple/Advanced 모드 토글로 (1)(2)를 풀자.
