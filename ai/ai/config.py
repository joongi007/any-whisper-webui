from __future__ import annotations

from functools import cached_property
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_", env_file=".env", extra="ignore")

    nats_url: str = "nats://nats:4222"
    data_dir: Path = Path("/data")

    log_level: str = "INFO"
    log_json: bool = True

    model_idle_unload_sec: int = 300
    translate_batch_size: int = 8
    translate_batch_max_wait_ms: int = 50

    # Prewarm the default whisper model at startup so the first realtime.start
    # request can reply quickly instead of hitting the 180s deadline during a
    # multi-GB download.
    prewarm_backend: str = "faster_whisper"
    prewarm_model: str = "large-v3-turbo"
    prewarm_enabled: bool = True

    huggingface_token: str = ""
    deepl_api_key: str = ""

    # YouTube audio cache: downloads are kept by video id so retries reuse them.
    # When the cache exceeds this size, the oldest files are evicted (LRU) after
    # each download. 0 disables auto-eviction.
    youtube_cache_max_gb: float = 5.0

    @cached_property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @cached_property
    def output_dir(self) -> Path:
        return self.data_dir / "outputs"

    @cached_property
    def model_cache_dir(self) -> Path:
        return self.data_dir / "models"

    @cached_property
    def worker_id(self) -> str:
        import os
        return f"ai-{os.uname().nodename}"


settings = Settings()
