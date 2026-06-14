from __future__ import annotations

import structlog

from ai.config import settings

log = structlog.get_logger()


_LANG = {
    "en": "EN-US", "ko": "KO", "ja": "JA", "zh": "ZH", "de": "DE", "fr": "FR",
    "es": "ES", "it": "IT", "pt": "PT-PT", "ru": "RU", "id": "ID", "tr": "TR",
    "uk": "UK", "vi": "VI",
}


class DeepLTranslator:
    def __init__(self) -> None:
        self._client = None

    def _ensure(self):
        if self._client is None:
            if not settings.deepl_api_key:
                raise RuntimeError("DeepL API key not configured")
            import deepl
            self._client = deepl.Translator(settings.deepl_api_key)
        return self._client

    async def translate_batch(self, texts: list[str], *, source_lang: str, target_lang: str) -> list[str]:
        client = self._ensure()
        result = client.translate_text(
            texts,
            source_lang=None if source_lang == "auto" else source_lang.upper(),
            target_lang=_LANG.get(target_lang.lower(), target_lang.upper()),
        )
        if isinstance(result, list):
            return [r.text for r in result]
        return [result.text]


deepl_translator = DeepLTranslator()
