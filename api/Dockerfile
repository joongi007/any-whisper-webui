FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 UV_SYSTEM_PYTHON=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
# Copy both the project metadata AND the package source before install,
# otherwise hatchling builds an empty wheel and the package is missing at runtime.
# Editable install (-e) so the `./api:/app` volume mount in docker-compose.yml
# actually drives the running process — without this, uvicorn loads the baked
# site-packages copy and hot edits silently get ignored.
COPY pyproject.toml ./
COPY api ./api
RUN uv pip install --system -e .

# Anything else (alembic, scripts, …) afterwards.
COPY . .
EXPOSE 8080
CMD ["api"]
