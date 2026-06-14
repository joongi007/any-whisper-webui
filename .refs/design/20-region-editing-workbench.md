---
name: design-20-region-editing-workbench
description: 20회차 — 트랜스크립트를 "한 번 찍고 끝"에서 "구간별로 반복 튜닝하는 워크벤치"로. 구간 재STT + 세그먼트 조작 + 실시간 녹화 보존.
type: design
iteration: 20
date: 2026-05-31
---

# Iter 20 — Region Editing Workbench

## 동기 (사용자 요구)

> "노래 같은 게 제대로 변환이 안 돼. 파일/유튜브에서 특정 부분을 선택해서 설정
> 튜닝해서 다시 STT 하고 싶어. 실시간은 말하면서 조절하면 되는데 파일/유튜브는
> 안 되잖아. 또 실시간도 녹화돼서 편집하거나 특정 부분 튜닝해서 다시 STT,
> 특정 부분 STT한 걸 추가/위치이동/복사할 수 있으면 좋겠어."

핵심 통찰: 트랜스크립트는 **불변 산출물이 아니라 편집 가능한 작업 공간**이어야 한다.
한 가지 설정으로 전체가 안 되는 오디오(노래, 다국어, 잡음 구간)는 **구간별로
다른 처리**가 필요하다.

## 결정사항 (사용자 확정)

1. **순서:** 전체 설계문서 먼저 → 검토 후 구현
2. **튜닝 UX:** 프리셋 + 개별 옵션 **둘 다**. Simple 모드 = 프리셋, Advanced = 개별 조정
3. **실시간 녹화:** 기본 **ON** (편의 우선). Settings에서 끌 수 있음

## 현황 — 이미 있는 것

| 능력 | 상태 | 위치 |
|---|---|---|
| 구간 재STT | ✅ | `retranscribeRange` ([api/routers/transcripts.py], [ai/pipelines/retranscribe.py]) |
| 구간 옵션 오버라이드 | ✅ (API만) | `RetranscribeRange.options_override` |
| 환각/디코딩 옵션 | ✅ (전역) | `AdvancedWhisperOptions`, `buildTranscribeOptions` |
| UVR 보컬 분리 | ✅ (잡 전체) | `backends/uvr/demucs` |
| 세그먼트 split/merge | ✅ | `splitSegment`, `mergeSegmentNext` |
| 세그먼트 인라인 편집 | ✅ | `TranscriptViewer` (text/time/speaker) |
| 구간 segment 교체 + 재번호 | ✅ | `replace_segment_range` |
| 실시간 audio 보존 | ❌ | `audio_unavailable` |

→ **"구간 재STT" 백엔드는 이미 있다.** 이 설계는 그 위에 ① 구간별 옵션 UI,
② 세그먼트 조작, ③ 실시간 녹화를 얹어 통합 워크벤치를 완성한다.

---

## 빌딩블록 A — Region Tuning (구간별 파라미터 재STT)

### A.1 개념
트랜스크립트에서 시간 구간(연속된 세그먼트들)을 선택 → 그 구간 전용 옵션을
지정 → 그 구간만 다시 STT 해서 교체. 노래 문제의 직접 해결책.

### A.2 왜 노래에 효과적인가
Whisper는 BGM 위 보컬에서 환각/누락이 심하다. 전체 파일에 UVR(보컬 분리)을
거는 건 느리고 낭비지만, **노래 구간만** UVR + 낮은 VAD threshold로 재처리하면
정확도가 크게 오른다. 멜로디성 발화는 `condition_on_previous_text=False`로
반복 환각도 막는다.

### A.3 프리셋 (Simple 모드)
구간 선택 시 프리셋 드롭다운. 각 프리셋은 옵션 묶음:

| 프리셋 | 의미 | 적용 옵션 |
|---|---|---|
| **말 (speech)** | 일반 대화 (기본) | VAD 0.5, UVR off, temp 0, condition off |
| **🎵 노래 (song)** | BGM 위 보컬 | **UVR vocals on**, VAD 0.3, temp 0, condition off, no_speech 0.4, initial_prompt 힌트 |
| **잡음 많음 (noisy)** | 소음/저음질 | VAD 0.6, no_speech 0.7 ↑, compression 2.0 ↓ (반복 강하게 거름) |
| **커스텀** | Advanced 수동 | 아래 개별 옵션 패널 노출 |

프리셋 정의는 **프론트엔드 상수** (백엔드는 이미 모든 옵션을 받음). 추가/수정이
쉽다.

### A.4 개별 옵션 (Advanced 모드)
프리셋 "커스텀" 선택 또는 Advanced 모드에서: 구간 단위로
backend/model/language/VAD/UVR/temperature/beam/initial_prompt/환각가드 전부
오버라이드. `AdvancedWhisperOptions`를 재사용하되 "구간 한정" 컨텍스트로.

### A.5 API (대부분 존재)
기존 `POST /transcripts/{tid}/retranscribe`를 확장:
```
body: {
  start_seq, end_seq,
  options_override: {           # ← 프리셋이 풀어쓴 옵션 또는 수동값
    backend?, model?, language?,
    uvr?: {enabled, stem},      # ← 신규: 구간 UVR
    vad?: {enabled, threshold}, # ← 신규: 구간 VAD
    temperature?, beam_size?, initial_prompt?,
    no_speech_threshold?, condition_on_previous_text?, ...
  }
}
```
[ai/pipelines/retranscribe.py]의 `retranscribe_range`가 슬라이스 wav에
**UVR/VAD 전처리를 구간에도 적용**하도록 확장 (현재는 transcribe만).

### A.6 UX 흐름
```
[자막에서 #12~#34 드래그/Shift선택]
 └─ 하단 SelectionToolbar (이미 있음) 확장:
     ┌──────────────────────────────────────────┐
     │ 23줄 선택 · #12–34                        │
     │ 프리셋: [ 🎵 노래 ▾ ]   [이 구간 다시 변환]│
     │ ▸ Advanced: UVR✓ VAD0.3 temp0 prompt"가사:"│  ← Advanced에서 펼침
     └──────────────────────────────────────────┘
```
변환 중 spinner → 완료 시 교체 + 재번호 (이미 구현된 흐름).

---

## 빌딩블록 B — 세그먼트 객체 조작 (insert / move / copy)

### B.1 개념
세그먼트를 split/merge만이 아니라 **추가·이동·복제**까지. 트랜스크립트를
편집 가능한 리스트로.

### B.2 신규 연산
| 연산 | 설명 | 시간축 처리 |
|---|---|---|
| **insert** | 빈 줄 또는 재STT 결과를 특정 위치에 삽입 | 앞뒤 세그먼트 사이 시간으로 자동, 또는 명시 |
| **move** | 순서 재배치 | **결정 필요** (아래 B.4) |
| **duplicate** | 세그먼트 복제 | 원본 직후, 같은 시간 또는 +ε |

### B.3 API + DB
```
POST /transcripts/{tid}/segments/{seq}/insert_after  {text, start?, end?}
POST /transcripts/{tid}/segments/{seq}/move          {to_seq}
POST /transcripts/{tid}/segments/{seq}/duplicate
```
DB: `_segments_after` cascade 재번호 로직 재사용 (split/merge와 동일 패턴).

### B.4 결정 필요 — move의 의미
자막은 본질적으로 **시간 정렬**이다. "위치 이동"이 무엇을 바꾸는가:
- **(a) 순서만, 시간 무시** — seq 순서를 바꾸되 start/end는 유지. 결과적으로
  자막이 시간 역순이 될 수 있음 (비정상 SRT). 거의 무의미.
- **(b) 시간까지 이동** — 대상 위치의 시간대로 start/end를 옮김. 기존 그 자리
  세그먼트와 겹침 → 충돌 해결 필요.
- **(c) move 대신 "cut + paste-at-time"** — 세그먼트를 들어내서 다른 시간점에
  떨어뜨림. 가장 직관적. duplicate도 같은 메커니즘(copy + paste-at-time).

→ **권장: (c)**. "이 자막을 저 시간으로" 가 사용자 멘탈모델에 맞음. move =
cut+paste, copy = duplicate+paste. 시간 충돌은 "가장 가까운 빈 슬롯" 또는 경고.

---

## 빌딩블록 C — 실시간 녹화 보존

### C.1 개념
실시간 세션의 PCM을 디스크에 누적 → 종료 시 파일 잡과 **동일한**
`/data/outputs/{sid}/input_16k.wav` 생성. 그러면 파일 잡의 모든 편집 능력
(waveform/재생/Region Tuning/세그먼트 조작)이 실시간 세션에도 **공짜로** 적용.

### C.2 구현 지점
[api/services/realtime_service.py]:
- 들어오는 16k PCM 청크를 wav writer로 append (세션당 파일 핸들)
- 종료(`_finalize_row`)에서 wav 닫고 `peaks.json` 생성 (파일 잡과 동일 파이프라인)
- 기존 `audio_unavailable` 분기는 "녹화 off였던 세션"에만 남김

### C.3 정책
- **기본 ON** (사용자 결정). Settings에 `realtimeRecord` 토글.
- 디스크: 16k mono ≈ 32KB/s → 1시간 ≈ 115MB. History 삭제 시 함께 정리(이미
  `delete_job`이 outputs 디렉토리 wipe).
- 녹화 off면 기존처럼 audio 미보존 → 편집은 되지만 재생/Region Tuning 불가.

---

## 빌딩블록 D — 통합 데이터 모델 (세 블록을 묶는 것)

**불변식:** 모든 잡(file/youtube/realtime)은 동일한
`input_16k.wav` + `transcript_segments` 행 + `peaks.json`을 가진다.

이게 성립하면 A·B·C가 **소스 종류와 무관하게** 동작한다. 현재 file/youtube는
이미 충족, realtime만 C로 맞추면 통일. 추가 스키마 변경 **없음** — 기존
TranscriptSegment 테이블 + outputs 디렉토리 규약만으로 충분.

(선택) 영구 Region 마킹: "이 구간은 노래"를 저장해 반복 튜닝에 재사용하려면
`transcript_regions` 테이블이 필요하지만, **MVP는 일회성 재STT로 충분**.
Region 영속화는 follow-up.

---

## 로드맵 (의존성 순)

1. **C — 실시간 녹화** (기반 통일)
   - realtime_service PCM append + peaks. 이후 A·B가 실시간에도 자동 적용.
   - 작업량: 中 (api 위주, ~150줄)

2. **A — Region Tuning** (노래 문제 직결, 체감 최대)
   - retranscribe에 UVR/VAD 구간 전처리 추가 (ai ~80줄)
   - 프리셋 상수 + SelectionToolbar 확장 (ui ~200줄)
   - 작업량: 中

3. **B — 세그먼트 조작** (편집 워크벤치 완성)
   - insert/duplicate 먼저 (단순), move=cut+paste 나중 (충돌 해결 필요)
   - 작업량: 中 (api ~150줄 + ui ~200줄)

---

## 비판 / 열린 질문

1. **구간 UVR의 경계 아티팩트** — 슬라이스 경계에서 demucs가 클릭음/누락 가능.
   슬라이스에 ±0.5s 패딩 주고 재STT 후 패딩 제거하는 방식 검토.
2. **재STT 결과의 화자 라벨** — 구간 재STT는 화자분리를 다시 안 돌림. 기존
   라벨 유지? 아니면 그 구간만 재diarize 옵션? → MVP는 라벨 비움, 사용자가
   인라인 재지정 (이미 가능).
3. **move/copy의 시간 충돌 UX** — paste-at-time 시 기존 세그먼트와 겹치면?
   "밀어내기" vs "겹침 허용(overlap)" vs "경고". 자막 포맷은 겹침 비권장 →
   가장 가까운 빈 슬롯 제안 + 사용자 확인.
4. **실시간 녹화 중 메모리/디스크 백프레셔** — 긴 세션(수시간)에서 wav append가
   느려지면 실시간 STT 지연 가능. async 파일 쓰기 + 버퍼링 필요.

→ 다음 단계: 이 문서 승인 후 C부터 구현 (tracer-bullet: 실시간 녹화 → 재생 →
구간 재STT 한 줄기 먼저 관통).

---

## 구현 완료 (2026-05-31)

전체 4블록 구현됨.

- **C** — 실시간 녹화는 streamer가 이미 `_persist_audio`로 wav+peaks를 쓰고
  있었음(Iter 17). `cfg.record` 플래그 추가(기본 ON, settings store v5),
  RealtimePage 토글 + 스테일 주석 정리.
- **A** — `retranscribe_range`에 구간 UVR(`separate_vocals`) + 구간 VAD
  필터 + ±0.5s 패딩(경계 아티팩트, Q1 해결) 추가. API `options_override`가
  backend/model/language도 오버라이드 가능. 프론트 `regionPresets.ts` +
  `SelectionToolbar`에 프리셋 드롭다운(Simple) + `RegionAdvancedPanel`(Advanced).
- **B** — `insert_segment_after` / `duplicate_segment` /
  `move_segment_to_time`(cut+paste-at-time, B.4(c) 채택) 리포+API+행 액션
  아이콘(PlaylistAdd/ContentCopy/SwapVert).
- **D** — 스키마 변경 없이 통일 달성. realtime이 file/youtube와 동일한
  outputs 규약을 따르게 됨.

## Follow-up 처리 (2026-06-14)

- ✅ **재STT 후 화자 라벨 상속** (Q2) — 재변환은 diarization을 다시 안 돌리므로
  결과 라인이 라벨 없이 돌아왔다. 이제 retranscribe API가 **기존 라벨을 시간
  겹침으로 상속** (가장 많이 겹치는 옛 세그먼트의 speaker 할당). 화자 색이
  재변환 구간에서 유지됨. seq/time 두 모드 모두.
- ✅ **move 시간충돌** (Q3) — 자동 ripple(밀어내기) 대신 **겹침 경고**로 결론.
  드롭은 위/아래 절반 판정으로 타겟과 안 겹치게 배치하고, 그래도 인접 자막과
  겹치면 빨강 시간 + ⚠️ 표시. 자막-오디오 동기를 깨는 자동 재배치는 의도적 배제.

미구현(낮은 우선순위): **영구 Region 마킹**(transcript_regions 테이블 — 같은
구간 반복 튜닝은 드물어 보류), **실시간 백프레셔**(현재 메모리 256MB cap +
종료 시 일괄 write라 실사용 문제 없음).
