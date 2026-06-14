---
name: design-17-followup-plan
description: 17회차 — 16-pending 9개 follow-up을 가치×비용 정렬, 이번 turn 3개 묶음 잡고 진행
type: design
iteration: 17
date: 2026-05-24
---

# Iter 17 — Follow-up 우선순위 + 이번 turn 묶음

## 가치 × 비용 매트릭스

| # | 항목 | 가치 | 비용 | 플레이북 매핑 |
|---|---|---|---|---|
| 20 | 실시간 세션 → 일반 잡 영구 저장 | **high** (사용자 1번 요구가 realtime, 끝나면 사라짐) | mid (api+ui 양쪽) | `architecture.md §7.1` (DB=api), `python-api.md §18.3` (repo inject) |
| 21 | History 다중 선택 + 일괄 삭제 | mid (행동 완결) | low (frontend only) | `frontend.md §9.1` (selection은 페이지 로컬) |
| 18 | 자막 분할/병합/시간 drag | mid (편집의 완성) | high (seq 재번호, 시간 분배, UX) | `python-api.md §18.3` (repo merge) |
| 17 | 오디오 waveform | mid (시각) | high (wavesurfer 의존 + peaks 사전계산) | n/a (외부 라이브러리) |
| 19 | 원문/번역 split view | low (translate ON 시) | low (TranscriptViewer 토글) | `frontend.md` (layout) |
| 25 | 모바일 BottomNav | low (`PRODUCT.md` 데스크톱이 canonical) | mid (viewport 별 점검) | `frontend.md §9.1` |
| 28 | 자막 timeline scrubber | mid | high (#17 의존) | n/a |
| 23 | GPU 라이브 사용률 | low (nice to have) | mid (nvidia-smi NATS 폴) | `concurrency.md §2.7` |
| 24 | Settings HF 토큰 입력 UI | low (.env로 충분) | mid (보안 검토 필요) | `config-secrets.md` |

## 이번 turn 묶음 (3개)

가치 high + low-cost 3개:

- **#20 realtime 영구 저장** — 사용자 최우선 요구의 마지막 누락 piece
- **#21 다중 선택 일괄 삭제** — `#`개 카드 클릭 X N 번 노가다 해소
- **#19 원문/번역 split view** — translate ON 케이스 가독성, 비용 작음

## 다음 turn 후보

- **#18 분할/병합** — 가치 mid, 비용 high. 단독 turn.
- **#17 waveform + #28 scrubber 묶음** — 둘이 결합되어야 의미. wavesurfer 도입.
- **#25 모바일** — 데스크톱 우선이라 후순위.
- **#23 GPU 사용률 + #24 HF UI** — 작은 nice-to-have, 묶어서 한 turn.

## 진행 순서 (이번 turn)

플레이북 §4 "외부 시스템 부하"/§7.1 "DB 소유" 검증 항목 챙기며:

1. **#21** (frontend only, 빠름) — 묶음 도입부
2. **#19** (frontend only, 빠름)
3. **#20** (backend 우선 → frontend) — 큰 변경

각 단계 끝 빌드 검증 한 번씩.

## 결정 / 비결정

- **#20에서 audio 보존하지 않기** — 실시간은 마이크/탭 청크가 일시적. WAV 저장하려면 ai 측 누적 + 파일 IO 추가. 자막만 저장하고 audio 없음. JobDetail의 오디오 플레이어는 404 onError 시 hide.
- **#21 bulk endpoint는 안 만듦** — 클라가 Promise.all로 DELETE 호출 (10~20개 규모). 서버 API 추가 비용 회피.
- **#19 translation 토글은 settingsStore에** — persist 가능, 다음 세션에도 유지.
