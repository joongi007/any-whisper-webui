FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 UV_SYSTEM_PYTHON=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml ./
COPY ai ./ai
# Editable install so the `./ai:/app` mount in docker-compose drives the live
# process — otherwise hot edits to /app/ai/... are silently ignored because
# uvicorn imports from the baked site-packages copy.
RUN uv pip install --system -e .

COPY . .

# CTranslate2 (faster-whisper backend) dlopens libcublas.so.12 / libcudnn.so.9
# at runtime. Both come from PyPI nvidia-* wheels installed above; expose their
# lib dirs via LD_LIBRARY_PATH so the dynamic linker can find them.
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib

CMD ["ai"]
