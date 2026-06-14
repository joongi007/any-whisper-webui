from __future__ import annotations

from functools import cached_property
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="API_", env_file=".env", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 8080

    nats_url: str = "nats://nats:4222"

    data_dir: Path = Path("/data")
    db_url: str = "sqlite+aiosqlite:////data/whisper.db"

    log_level: str = "INFO"
    log_json: bool = True

    default_backend: str = "faster_whisper"
    default_model: str = "large-v3-turbo"
    default_compute_type: str = "float16"

    # Mirrors AI_YOUTUBE_CACHE_MAX_GB so the UI can show the auto-evict ceiling.
    # Keep these two in sync via env if you change the default.
    youtube_cache_max_gb: float = 5.0

    @cached_property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @cached_property
    def output_dir(self) -> Path:
        return self.data_dir / "outputs"


settings = Settings()
