from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from api import nats_client
from api.exceptions import BackendUnavailable

v1_translate_router = APIRouter(prefix="/api/v1/translate", tags=["translate"])


class _Req(BaseModel):
    text: str
    provider: str = "nllb"
    source_lang: str = "auto"
    target_lang: str = "en"


@v1_translate_router.post("/text")
async def translate_text(payload: _Req) -> dict:
    # ai exposes a NATS req-reply endpoint on subject "ai.translate.text"
    resp = await nats_client.request(
        "ai.translate.text", payload.model_dump(), timeout=20.0,
    )
    if resp is None:
        raise BackendUnavailable("ai worker unavailable")
    return {"data": resp}
