from __future__ import annotations

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI

from api import nats_client
from api.config import settings
from api.db import Base, get_engine
from api.logging_setup import setup_logging
from api.routers.files import v1_files_router
from api.routers.jobs import v1_jobs_router
from api.routers.system import v1_system_router
from api.routers.transcripts import v1_transcripts_router
from api.routers.translate import v1_translate_router
from api.routers.ws import ws_router
from api.routers.youtube import v1_youtube_router
from api.services import event_consumer

log = structlog.get_logger()


@asynccontextmanager
async def _lifespan(_: FastAPI):
    setup_logging()
    for d in (settings.data_dir, settings.upload_dir, settings.output_dir):
        d.mkdir(parents=True, exist_ok=True)

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await nats_client.connect()
    await event_consumer.start()
    log.info("api_started", host=settings.host, port=settings.port)
    try:
        yield
    finally:
        await event_consumer.stop()
        await nats_client.close()
        log.info("api_stopped")


def create_app() -> FastAPI:
    app = FastAPI(title="any-whisper-webui API", version="0.1.0", lifespan=_lifespan)
    for r in (
        v1_system_router, v1_files_router, v1_jobs_router,
        v1_transcripts_router, v1_translate_router, v1_youtube_router,
        ws_router,
    ):
        app.include_router(r)
    return app
