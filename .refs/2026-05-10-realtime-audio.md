---
name: realtime-audio
description: 실시간 STT용 오디오 캡처(getDisplayMedia/getUserMedia) + WebSocket 청크 스트리밍 설계
type: research
date: 2026-05-10
---

# 실시간 오디오 캡처 + 스트리밍 STT 설계

**Date:** 2026-05-10
**Context:** 마이크와 "현재 동작 중인 앱의 사운드"를 캡처해 실시간 STT/번역. 사용자 결정: **브라우저 `getDisplayMedia({audio:true})`** (탭/창 단위, 임의 Windows 앱은 X). WSL2에서 Windows 앱별 사운드를 잡으려면 별도 네이티브 헬퍼가 필요하지만 범위 폭발 위험으로 제외.

## Findings

### 1. 캡처 API 비교

| API | 무엇을 캡처 | 브라우저 지원 | 비고 |
|---|---|---|---|
| `getUserMedia({audio:true})` | 마이크 | 모든 모던 브라우저 | 항상 동작 |
| `getDisplayMedia({audio:true})` | **공유 중인 탭/창의 시스템 오디오** | Chromium 계열 (Chrome/Edge) ✅, Firefox ❌(영상만), Safari ❌ | "탭 공유" 시 그 탭의 오디오. "창" 공유 시 OS에 따라 다름 (Windows는 가능, macOS/Linux는 보통 X) |
| Electron/Tauri `desktopCapturer` | OS 전체 / 특정 창 | 데스크톱 앱 한정 | 범위 외 |
| WASAPI per-process loopback | Windows 앱 PID별 | Windows 네이티브 .exe만 | 범위 외 |

→ **Chrome/Edge에서 "탭 공유 + 오디오 포함"** 을 1차 타겟. Firefox는 마이크만.

### 2. 캡처 → 서버 스트리밍 파이프라인

```
[브라우저]
 MediaStream
 ↓
 AudioContext (sampleRate=16000)
 ↓
 AudioWorkletNode  ← Float32 PCM 청크 (예: 100ms = 1600 samples)
 ↓
 다운믹스(스테레오→모노) + Int16 변환
 ↓
 WebSocket binary frame  (작고 자주 보냄)
 ↓
[서버]
 청크 버퍼 (sliding window)
 ↓
 VAD (Silero) → 발화 세그먼트 추출
 ↓
 faster-whisper 추론 (스트리밍 모드: 짧은 청크 누적 후 transcribe)
 ↓
 partial / final 자막 → WebSocket text frame (JSON)
```

### 3. 핵심 결정사항

**3-1. AudioWorklet vs MediaRecorder vs ScriptProcessor**
- ScriptProcessor: deprecated, 메인 스레드에서 동작 → 글리치 발생. **사용 금지.**
- MediaRecorder: 인코딩(opus) 떨어지지만 청크가 너무 큰 단위로 들어옴 (수백 ms~) → 인터랙티브 부적합.
- **AudioWorklet 채택:** 오디오 스레드에서 동작. 100ms 단위로 PCM 청크 송출 가능.

**3-2. 샘플레이트**
- Whisper는 16kHz 모노 입력. AudioContext에서 `sampleRate: 16000`로 생성 → 브라우저가 리샘플링 처리.
- 캡처 디바이스가 16kHz 미지원이면 AudioContext가 자동 리샘플 (확인 필요).

**3-3. 청크 크기**
- 100ms (1600 samples * 2 bytes = 3200 bytes/frame). WS 전송 오버헤드 미미.
- 서버는 600ms~1s 누적 후 partial transcribe, 발화 종료 감지(VAD) 시 final emit.

**3-4. 모델 선택**
- 실시간은 `small` 또는 `large-v3-turbo` 권장. `large-v3` 은 단일 GPU에서 실시간성 떨어질 수 있음.
- `condition_on_previous_text=True` + 누적 컨텍스트로 일관성 유지.

**3-5. 동시성 (서버)**
- WebSocket 세션마다 별도 백그라운드 태스크.
- GPU 추론은 전역 `asyncio.Semaphore(1)`로 직렬화.
- VAD는 CPU에서 가벼움 → 동시 가능.

### 4. 보안/권한 노트

- `getDisplayMedia`는 **사용자 제스처 필요** → 명시적 "공유 시작" 버튼.
- 권한 거부 시 명확한 UI 메시지.
- HTTPS 또는 `localhost`에서만 동작 (개발 시 Vite dev server는 OK).

### 5. 미지원 케이스 명시

- **임의의 다른 Windows 앱 사운드 (예: Discord, 게임 등을 직접 PID로):** 범위 외. 사용자가 해당 앱을 탭/창으로 공유해야 가능 (예: 브라우저 탭에서 재생되는 YouTube는 가능).
- **macOS/Linux 시스템 오디오:** 브라우저 정책상 보통 비활성. Linux는 PipeWire 환경에서 일부 가능.
- 향후 옵션: Tauri로 데스크톱 앱 래핑 → `getDisplayMedia` 제약 우회. **다음 단계 결정사항.**

## Outcome

- 프론트: `whisper_web/src/audio/AudioCaptureWorklet.ts` + `RealtimeStream.ts` (WebSocket 클라이언트)
- 백엔드: `whisper_api/whisper_api/realtime/router.py` (WebSocket 라우터) + `realtime/streamer.py` (청크 누적/VAD/transcribe 루프)
- WS 메시지 스키마: `references/COMMUNICATION.md` 참고

## References
- MDN getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- AudioWorklet: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode
- Silero VAD streaming: https://github.com/snakers4/silero-vad/wiki/Examples-and-Dependencies
