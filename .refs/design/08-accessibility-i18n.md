---
name: design-08-accessibility-i18n
description: 8회차 — 접근성(키보드/스크린리더/콘트라스트), i18n(ko/en), RTL 준비.
type: design
iteration: 8
date: 2026-05-10
---

# Iter 8 — Accessibility & i18n

## 이전 비판 → 적용
- WCAG AA 준수.
- 키보드 단축키 풀세트.
- aria-live 영역 정책.
- i18next 도입, ko/en 1차.
- RTL 컴포넌트 구조는 닫지 않되, 1차 비활성.

## 키보드 단축키
| 단축키 | 동작 |
|---|---|
| `Ctrl+/` | 단축키 도움말 모달 |
| `g h` | Home으로 |
| `g f` | File로 |
| `g y` | YouTube로 |
| `g r` | Realtime로 |
| `g j` | History로 |
| `g s` | Settings로 |
| `Enter` (드롭존 포커스) | 파일 선택 다이얼로그 |
| `Ctrl+Enter` | 현재 페이지의 Run/Connect |
| `Esc` | 슬라이드 패널/모달 닫기 |
| `j` / `k` | 잡 카드 사이 이동 (Jobs 패널 포커스 시) |
| `Space` (실시간) | 음성 활성/일시정지 |
| `m` (실시간) | 마이크 음소거 |

## ARIA / 스크린리더 규칙
- **잡 카드** = `role="article"` + `aria-labelledby={title-id}` + 진행률은 `role="progressbar" aria-valuenow valuemin valuemax`.
- **Live transcript** = `role="log" aria-live="polite" aria-atomic="false"`. partial은 별도 영역으로 두고 `aria-live="off"` (너무 자주 읽힘 방지). final 추가 시에만 polite로 announce.
- **레벨 미터** = 시각 전용. 스크린리더는 무시(`aria-hidden="true"`). 음성 레벨 변화는 지속적이라 announce하면 소음.
- **모드 토글** = `role="radiogroup"` 와 두 개의 `role="radio"` 버튼.
- 모든 아이콘 버튼에 `aria-label`.

## 콘트라스트 / 색
- 라이트 / 다크 둘 다 WCAG AA(4.5:1 텍스트, 3:1 UI 요소) 통과.
- accent: light=`violet.700`, dark=`violet.400` — 본문 대비 4.7:1 / 7.2:1.
- 화자 컬러칩(다이아라이즈 표기)은 색만 의존하지 않음 — 화자 라벨(SPK1, SPK2) 텍스트도 함께. 색맹 사용자에게도 식별 가능.
- partial 자막은 italic + `text-muted` (콘트라스트 ≥4.5:1 유지).

## i18n
- 라이브러리: `i18next` + `react-i18next`.
- 디폴트 언어: 브라우저 `navigator.language` 기준 → `ko`, `en` 매칭. fallback `en`.
- 키 컨벤션: dot-separated, `page.dashboard.recent_jobs.empty` 같이 페이지·영역·항목.
- 번역 가능한 위치: 모든 UI 라벨, 에러 메시지, 빈 상태, 도움말.
- Whisper 검출 언어 코드(예: `ko`)는 `lang.ko`처럼 표시명으로 변환.
- 숫자/날짜는 `Intl` API.

## RTL
- 1차 미지원. 단 컴포넌트는 `text-align: start` / `padding-inline-start` 형태로 작성해 추후 켜기 쉽게.
- 화살표 아이콘은 RTL 시 좌우 반전 가능한 SVG로.

## 다크 모드 / 시스템 / 라이트
- 3-way 토글 (System / Light / Dark). 기본 System.
- prefers-reduced-motion 존중: 모든 200ms 이상 트랜지션 0ms로.

## 새로 떠오른 비판
1. **에러/빈/로딩 상태**가 페이지마다 정의되어 있지 않다.
2. **i18n 파일 누락 시 fallback** 정책 외에, **번역 누락을 개발자가 인지**할 방법(누락 키 콘솔 경고).
3. **첫 방문 온보딩** — 5개 기능을 한 번에 보여주면 압도. 가벼운 1-3 step 투어?

→ 9회차에서 (1)을 일제 정비, (3)은 도입 가치 vs 비용 검토.
