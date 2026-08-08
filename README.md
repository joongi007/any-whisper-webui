# any-whisper-webui

![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)

OpenAI Whisper 기반의 로컬 음성 인식(STT) · 번역 · 자막 편집 웹 UI입니다.
모든 처리가 내 컴퓨터에서 이루어지며, 클라우드를 거치지 않습니다.

## 소개

회의 녹음과 강의 영상의 자막을 로컬에서 직접 만들고 다듬기 위해 시작한 개인 프로젝트입니다.
기존 도구들은 받아쓰기까지는 충분히 잘 동작하지만, 그 이후의 작업(자막을 손보고, 화자를 나누고,
특정 구간만 다시 변환하는 일)이 늘 아쉬웠습니다. 그래서 받아쓰기와 편집기를 한 화면에 통합하는
것을 목표로 만들었습니다.

## 주요 기능

- **다양한 입력** : 오디오/영상 파일, YouTube URL, 마이크, 브라우저 탭·창 오디오 캡처
- **자막 내보내기** : SRT / WebVTT / TXT (편집한 내용이 그대로 반영됩니다)
- **Whisper 백엔드 선택** : `faster_whisper`(기본) / `openai_whisper` / `insanely_fast_whisper`
- **축자(verbatim) 옵션** : CrisperWhisper 모델 선택 시 필러·말더듬까지 들리는 그대로 받아쓰기 (CC-BY-NC 비상업, 기본 아님·선택 사항)
- **번역** : 음성 → 영어 번역(Whisper `task=translate`), 텍스트 번역(NLLB 오프라인·비상업 / DeepL)
- **전처리** : Silero VAD, UVR(Demucs) 기반 배경음 분리
- **화자 분리** : pyannote 기반 후처리
- **실시간 변환** : WebSocket 스트리밍 STT, 옵션 번역, 화자 라벨

## 기존 Whisper UI와의 차이점

대부분의 오픈소스 Whisper UI(예: Gradio 기반 도구)는 "오디오를 넣으면 자막이 나오는" 단방향
도구입니다. 이 프로젝트는 두 가지 방향으로 한 걸음 더 나아갔습니다.

**1. 받아쓰기 이후의 본격 자막 편집기**

- 자막 줄 인라인 편집 (클릭하면 재생, 더블클릭하면 편집)
- **구간 재변환** : 잘못 인식된 부분만 선택해 다른 설정으로 다시 변환
- 파형에서 드래그로 타임코드 조정, 세그먼트 삽입·복제·이동·병합·삭제
- 화자 라벨 편집 (한 줄만 변경 / 라벨 전체 일괄 변경 / 화자 지정 / 제거)
- 모든 편집에 실행 취소(undo) 제공

**2. 입력 방식과 구조**

- **실시간 스트리밍 STT** : 마이크뿐 아니라 브라우저 탭·창 오디오 캡처(`getDisplayMedia`) 지원
- **멀티프로세스 아키텍처** : GPU 추론을 API 서버에서 분리하고 NATS 큐로 연결하여 ai 워커를
  수평 확장할 수 있습니다. 단일 Gradio 프로세스가 아닙니다. (자세한 내용은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))
- **직접 구현한 React UI** : Simple/Advanced 모드, 한국어·영어, 라이트·다크 테마, 키보드 단축키,
  스크린리더 접근성 지원
- pyannote 화자 분리 통합, Whisper 백엔드 3종 선택

설치는 Gradio 기반 도구보다 무겁습니다(Docker Compose로 5개 서비스 구동). 대신 구조가 분리되어
있어 확장·교체가 쉽고, 편집 경험이 훨씬 깊습니다.

## 설치 및 실행

### 전제 조건

- Docker 및 Docker Compose v2 (CPU 오버레이는 `!reset`을 쓰므로 v2.24+ 필요)
- 권장: NVIDIA GPU. ai 워커는 기본적으로 CUDA(float16)로 추론하며, GPU가 없으면 CPU로도
  동작하지만 느립니다.

### 공통 절차

```bash
git clone <this-repo> && cd any-whisper-webui
cp .env.example .env        # 화자 분리를 사용하려면 HuggingFace 토큰 등을 입력합니다
```

그다음 환경에 맞게 실행합니다. 실행 명령은 운영체제(GPU 유무)에 따라 다르므로 아래 항목을
참고하세요. 실행 후 브라우저에서 `http://localhost:8080`에 접속합니다.

- NVIDIA GPU (Linux / Windows-WSL2): `docker compose up -d`
- GPU 없음 (macOS / GPU 미탑재 PC): `docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d`

호스트에 노출되는 포트는 `8080` 하나입니다. 첫 실행 시 ai 워커가 수 GB 규모의 모델을
내려받으므로 시간이 다소 걸립니다(모델 캐시는 `./data/models`에 저장됩니다).

### Linux (GPU 네이티브, 권장)

1. NVIDIA 드라이버를 설치합니다 (`nvidia-smi`로 확인).
2. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)을 설치하고 Docker에 등록합니다.
   ```bash
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```
3. 컨테이너에서 GPU가 인식되는지 확인합니다.
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
   ```
4. `docker compose up -d` 를 실행합니다.

### Windows (GPU)

GPU를 쓰는 방법은 두 가지입니다. 대부분은 방법 A로 충분합니다.

**방법 A. Docker Desktop (일반 사용자 권장)**

WSL2를 직접 다룰 필요가 없습니다. 설치 마법사가 알아서 구성합니다.

1. Docker Desktop을 설치합니다(설치 과정에서 WSL2 기반이 자동으로 설정됩니다).
2. Windows에 최신 NVIDIA 드라이버를 설치합니다(WSL용 CUDA 지원이 드라이버에 포함되어 있습니다).
3. `docker compose up -d` 를 실행합니다. GPU 인식 여부는 위 Linux의 `nvidia-smi` 명령으로 확인할 수 있습니다.

**방법 B. WSL2에서 직접 (개발자)**

WSL2 배포판 안에서 작업하면 빌드와 볼륨 마운트가 빠릅니다.

1. WSL2와 리눅스 배포판(예: Ubuntu)을 설치하고, 그 안에서 저장소를 clone합니다.
2. Windows에 최신 NVIDIA 드라이버를 설치합니다(WSL 내부에 별도 CUDA 드라이버는 설치하지 않습니다, 충돌함).
3. 프로젝트는 WSL2 파일시스템(예: `~/projects/...`)에 둡니다. Windows 드라이브(`/mnt/c/...`)는 마운트가 느립니다.
4. `docker compose up -d` 를 실행합니다.

> 탭·창 오디오 캡처는 Chrome / Edge에서 동작합니다(Firefox/Safari는 마이크만 지원).

### macOS (CPU 전용)

Mac에는 NVIDIA GPU가 없으며, Apple Silicon의 MPS도 Docker 컨테이너 내부에서는 접근할 수
없습니다. 따라서 CPU 모드로만 동작하며 속도가 느립니다(가벼운 용도, 작은 모델 권장).

1. Docker Desktop for Mac을 설치합니다.
2. `.env`를 CPU 환경에 맞게 조정합니다.
   ```ini
   API_DEFAULT_MODEL=small        # base / small 권장 (large는 매우 느림)
   API_DEFAULT_COMPUTE_TYPE=int8
   AI_PREWARM_MODEL=base
   ```
3. CPU 오버레이로 실행합니다. base 파일의 GPU 예약을 자동으로 비워 주므로
   `docker-compose.yml`을 직접 수정할 필요가 없습니다.
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d
   ```

> GPU가 없는 Linux/Windows 환경도 동일하게 CPU 오버레이
> (`-f docker-compose.yml -f docker-compose.cpu.yml`)와 `int8` + 작은 모델 설정을 쓰면 됩니다.

### ai 워커 확장

```bash
docker compose up -d --scale ai=3
```

> 단일 GPU에서 ai 워커를 늘리면 VRAM이 분할되어 OOM(메모리 부족)이 발생할 수 있습니다.
> 다중 GPU 또는 충분한 VRAM 환경에서만 의미가 있습니다.

## 아키텍처

api · ai · ui 세 개의 프로세스가 NATS를 통해 통신하는 구조입니다. 다이어그램과 서비스별 책임,
데이터 흐름은 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에, 통신 계약은
[docs/COMMUNICATION.md](docs/COMMUNICATION.md), 설계 결정 기록은
[docs/ARCHITECTURE-design.md](docs/ARCHITECTURE-design.md)에 정리되어 있습니다. 조사 원본과 디자인
이터레이션은 [.refs/](.refs/)에 있습니다.

## 라이선스 및 외부 리소스

본 프로젝트는 Apache-2.0 라이선스로 배포됩니다. 다만 일부 의존 모델은 별도의 약관을 따르므로
사용 시 주의가 필요합니다.

| 대상 | 약관 |
|---|---|
| Whisper 가중치 | MIT (자유 사용) |
| CrisperWhisper | CC-BY-NC (상업적 사용 불가, 선택 시 UI에 경고 표시) |
| pyannote 모델 | gated. HuggingFace 약관 동의 및 토큰 필요 |
| NLLB | CC-BY-NC (상업적 사용 불가, UI에 경고 표시) |
| DeepL | 사용자 본인의 API 약관에 따름 |
| YouTube 콘텐츠 | yt-dlp는 Unlicense이나, 다운로드 권리는 사용자 책임 |

전체 의존성 라이선스는 [NOTICE](./NOTICE)를 참고하시기 바랍니다.

## 참고 사항

- HuggingFace 토큰은 보안상 UI 입력 폼이 아니라 `.env`로만 받습니다(장기간 유지되는 비밀 값이므로
  폼 입력을 막았습니다).
- 임의의 다른 데스크톱 애플리케이션을 PID로 직접 캡처하는 기능은 지원 범위 밖입니다.
- 현재 v1은 transcribe 작업만 NATS 큐로 처리하며, translate/uvr/diarize 작업의 큐 분리는 추후
  과제입니다.
