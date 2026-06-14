# any-whisper-webui

Whisper 기반 **로컬 STT · 번역 · 자막 편집** WebUI. 전부 내 컴퓨터에서 돈다. 클라우드 안 거친다.

## 왜 만들었나

심심해서. 그리고 내 회의 녹음이랑 유튜브 강의 자막을 로컬에서 따고 싶었는데,
기존 도구들은 받아쓰기까지는 잘 되지만 그 다음(자막을 손보고, 화자 나누고, 특정 구간만 다시
돌리는 일)이 늘 아쉬웠다. 그래서 "받아쓰기 + 편집기"를 한 화면에 욱여넣은 주말 프로젝트.

그리고 **이 프로젝트는 거의 전부 AI(Claude Code)로 작성했다.** 코드, 아키텍처, 문서,
디자인까지 사람이 방향을 잡고 AI가 짜는 식으로 페어 프로그래밍한 결과물이다. 그래서 "AI가
이 정도 규모의 멀티프로세스 앱을 어디까지 만드나" 실험의 성격도 있다.

## 기존 Whisper UI들과 뭐가 다른가

대부분의 오픈소스 Whisper UI(예: Gradio 기반 webui들)는 "오디오 넣으면 자막 떨어지는" 단방향
도구다. 이 프로젝트는 거기서 두 방향으로 더 갔다.

**1. 받아쓰기가 끝이 아니라 시작 (본격 자막 편집기)**
- 자막 줄 인라인 편집, 더블클릭 편집 / 클릭 재생
- **구간 재변환** — 틀린 부분만 드래그로 골라 다른 설정으로 다시 돌리기
- 파형에서 드래그로 타임코드 조정, 세그먼트 삽입 · 복제 · 이동 · 병합 · 삭제
- 화자 라벨 편집 — 한 줄만 바꾸기 / 라벨 전체 일괄 변경 / 화자 지정 / 제거
- 모든 편집에 실행취소(undo)

**2. 입력과 구조**
- **실시간 스트리밍 STT** — 마이크뿐 아니라 브라우저 탭/창 오디오 캡처(`getDisplayMedia`)
- **멀티프로세스 아키텍처** — GPU 추론을 API 서버에서 분리하고 NATS 큐로 연결, ai 워커 수평 확장.
  단일 Gradio 프로세스가 아니다. ([ARCHITECTURE.md](./ARCHITECTURE.md))
- **커스텀 React UI** — Gradio가 아니라 직접 만든 SPA. Simple/Advanced 모드, ko/en, 라이트/다크,
  키보드 단축키, 스크린리더 a11y
- 화자 분리(pyannote) 통합, Whisper 백엔드 3종 선택

장단점은 분명하다. 설치는 Gradio 한 방보다 무겁다(Docker Compose 5개 서비스). 대신 구조가
분리돼 있어 확장·교체가 쉽고, 편집 경험이 훨씬 깊다.

## 기능

- **입력** — 파일, YouTube URL, 마이크, 브라우저 탭/창 오디오
- **출력** — SRT / WebVTT / TXT (편집한 내용 그대로 반영)
- **Whisper 백엔드** — `faster_whisper`(기본) / `openai_whisper` / `insanely_fast_whisper`
- **번역** — 음성→영어(Whisper `task=translate`), 텍스트 번역(NLLB 오프라인·비상업 / DeepL)
- **전처리** — Silero VAD, UVR(Demucs)로 BGM 분리
- **후처리** — pyannote 화자 분리
- **실시간** — WebSocket 스트리밍 STT + 옵션 번역, 화자 라벨

---

## 설치

공통 준비물: **Docker** + **Docker Compose v2**. 호스트에 뚫리는 포트는 `8080` 하나다.

```bash
git clone <this-repo> && cd any-whisper-webui
cp .env.example .env        # 화자분리 쓸 거면 HuggingFace 토큰 등 채우기
docker compose up -d
# 브라우저에서 http://localhost:8080
```

> 첫 실행 시 ai 워커가 수 GB 모델을 내려받는다(시간 소요). 캐시는 `./data/models`에 남는다.

ai 워커는 기본적으로 **NVIDIA GPU(CUDA, float16)** 로 추론한다. GPU가 없으면 CPU로도 돌지만
느리다. OS별로 GPU 세팅이 갈리니 아래를 따른다.

### 🐧 Linux (GPU 네이티브 · 권장)

1. NVIDIA 드라이버 설치 (`nvidia-smi`로 확인).
2. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) 설치 후 Docker에 등록:
   ```bash
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```
3. GPU가 컨테이너에서 보이는지 확인:
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
   ```
4. `docker compose up -d`. 끝.

### 🪟 Windows (WSL2 + GPU)

1. **Docker Desktop** 설치 → 설정에서 **WSL2 기반 엔진** 활성화.
2. **Windows에** 최신 NVIDIA 드라이버 설치 (WSL용 CUDA 지원이 드라이버에 내장돼 있다).
   WSL 안에 별도 CUDA 드라이버를 설치하지 말 것 — 충돌난다.
3. GPU는 Docker Desktop이 WSL2를 통해 자동으로 컨테이너에 노출한다. 위 Linux의 `nvidia-smi`
   확인 명령으로 검증.
4. 프로젝트는 **WSL2 파일시스템 안**(예: `~/projects/...`)에 두는 걸 권장. Windows 드라이브
   (`/mnt/c/...`)에 두면 볼륨 마운트가 느리다.
5. `docker compose up -d`.
6. 탭/창 오디오 캡처는 **Chrome / Edge**에서 동작. Firefox/Safari는 마이크만.

### 🍎 macOS (CPU 전용)

Mac에는 NVIDIA GPU가 없고, Apple Silicon의 MPS도 Docker 컨테이너 안에서는 접근할 수 없다.
따라서 **CPU 모드로만** 동작하며 느리다. 작은 모델로 가볍게 쓰는 용도.

1. **Docker Desktop for Mac** 설치.
2. GPU 예약 블록을 끈다. `docker-compose.yml`의 `ai` 서비스에서 아래를 주석 처리(또는 삭제):
   ```yaml
   #    deploy:
   #      resources:
   #        reservations:
   #          devices: [{ capabilities: [gpu] }]
   ```
3. `.env`에서 CPU에 맞게 조정:
   ```ini
   API_DEFAULT_COMPUTE_TYPE=int8
   API_DEFAULT_MODEL=small        # base / small 권장 (large는 비현실적으로 느림)
   ```
4. `docker compose up -d`.

> **GPU 없는 Linux/Windows**도 macOS와 동일하게 GPU 블록을 끄고 `int8` + 작은 모델로 설정하면 된다.

### ai 워커 늘리기

```bash
docker compose up -d --scale ai=3
```

> ⚠️ 단일 GPU에서 ai를 늘리면 VRAM이 분할돼 OOM 위험. 멀티 GPU나 충분한 VRAM에서만 의미 있다.

---

## 아키텍처

3개 프로세스(api · ai · ui)가 NATS로 통신하는 구조다. 다이어그램·서비스 책임·데이터 흐름은
[ARCHITECTURE.md](./ARCHITECTURE.md)에, 설계 결정 배경은 [.refs/](./.refs/)에 정리돼 있다.

## 라이선스 / 사용 책임

본 프로젝트는 **Apache-2.0**. 단, 일부 의존 모델은 별도 약관을 따른다.

| 대상 | 약관 |
|---|---|
| Whisper 가중치 | MIT — 자유 |
| pyannote 모델 | gated. HuggingFace 약관 동의 + 토큰 필요 |
| **NLLB** | **CC-BY-NC** — 상업 사용 금지. UI에 경고 표시 |
| DeepL | 사용자 본인의 API 약관 책임 |
| YouTube 콘텐츠 | yt-dlp는 Unlicense이나, 다운로드 권리는 본인 책임 |

전체 의존성 라이선스는 [NOTICE](./NOTICE) 참고.

## 비고

- HuggingFace 토큰은 보안상 **UI 폼이 아니라 `.env`로만** 받는다(장기 비밀이라 폼 입력 금지).
- 임의의 다른 데스크톱 앱을 PID로 직접 캡처하는 기능은 범위 외.
- 현재 v1은 transcribe 잡만 NATS 큐로 처리. translate/uvr/diarize 잡 큐 분리는 추후.
