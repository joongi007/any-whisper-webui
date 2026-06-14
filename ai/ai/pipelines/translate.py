from __future__ import annotations

from typing import Literal

from ai.backends.translate.deepl import deepl_translator
from ai.backends.translate.nllb import nllb
from ai.config import settings
from ai.micro_batcher import MicroBatcher


async def _nllb_batch(items: list[tuple[str, str, str]]) -> list[str]:
    # Same source/target across batch is required for shared forward.
    # Group by (source_lang, target_lang) just to be safe; in practice
    # one job uses one lang pair.
    by_pair: dict[tuple[str, str], list[tuple[int, str]]] = {}
    for i, (text, src, tgt) in enumerate(items):
        by_pair.setdefault((src, tgt), []).append((i, text))

    out: list[str] = [""] * len(items)
    for (src, tgt), indexed in by_pair.items():
        texts = [t for _, t in indexed]
        translated = await nllb.translate_batch(texts, source_lang=src, target_lang=tgt)
        for (idx, _), tr in zip(indexed, translated, strict=False):
            out[idx] = tr
    return out


_nllb_batcher: MicroBatcher = MicroBatcher(
    _nllb_batch,
    max_size=settings.translate_batch_size,
    max_wait_ms=settings.translate_batch_max_wait_ms,
)


async def translate_text(
    text: str, *,
    source_lang: str = "auto",
    target_lang: str = "en",
    provider: Literal["nllb", "deepl"] = "nllb",
) -> str:
    if provider == "deepl":
        out = await deepl_translator.translate_batch(
            [text], source_lang=source_lang, target_lang=target_lang,
        )
        return out[0] if out else ""
    src = "en" if source_lang == "auto" else source_lang  # NLLB requires explicit src; auto → assume English fallback
    return await _nllb_batcher.submit((text, src, target_lang))
