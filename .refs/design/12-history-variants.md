---
name: design-12-history-variants
description: 12회차 — HistoryPage 3 variants 정의 (Card Grid / Dense Table / Date Timeline)
type: design
iteration: 12
date: 2026-05-22
---

# Iter 12 — HistoryPage variants

## 사용자 불만 정확히 짚기
"어떤 히스토리를 열었는지 구분이 안 가는데??"
- 카드에 `transcribe`만 표시되고 있었음
- 클릭 전까지 어떤 파일/유튜브/모델/언어/시간 정보 미노출

## 백엔드 메타 풍부화
`api/api/routers/jobs.py::_view` + `_source_summary`:
- `source_kind` (file/youtube)
- `source_label` (filename 또는 youtube id)
- `backend`, `model`
- `language`, `duration_sec`
- `created_at`

`repo.list/get`에 `selectinload(Job.file_asset)` — N+1 방지하면서 filename 노출.

## Variant A — Card Grid (rich)
- 잡당 1.5rem padding의 폭넓은 카드
- 상단: source icon + filename(굵게) + status chip + 휴지통
- 중단: model · language · duration · `Nm ago` 라인 (chip 형태가 아닌 muted small)
- 진행 중: 막대 + stage · %
- 완료: SRT/VTT/TXT 인라인 다운로드 + "열기 →"

장점: 한눈에 풍부. 좁은 폭에서도 정보 손실 적음.
단점: 잡 많을 때 스크롤 길음.

## Variant B — Dense Table
- 7열 그리드 (source / status / model / lang / dur / created / export)
- 행 hover로 클릭 가능 강조
- 헤더는 uppercase 11px (현대 admin 톤)

장점: 100+ 잡 비교 효율. 한 줄에 모든 메타.
단점: 좁은 폭(<lg)에서 가로 스크롤 또는 column 줄여야 함.

## Variant C — Date Timeline
- created_at 날짜로 그룹핑
- 각 그룹은 좌측 세로선 + 시간 라벨(HH:MM) 형태
- 행은 굵게 한 줄 + 메타 한 줄

장점: 시간 흐름이 명확. "어제 했던 그 잡"을 찾기 좋음.
단점: 같은 날 잡이 적으면 비효율 (그룹 헤더 비용).

## 결정
- 셋 다 같은 `filtered` 데이터 + Toolbar 공유 (검색·필터)
- prototype 스위처로 비교, 사용자가 채택 결정
- 채택 후 변종 삭제하고 한 디자인으로 정착 (prototype skill §6)
