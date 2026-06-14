from __future__ import annotations

import asyncio
from typing import Any

import structlog

from ai.config import settings
from ai.gpu_lock import gpu_lock

log = structlog.get_logger()

_LANG: dict[str, str] = {
    "en": "eng_Latn", "ko": "kor_Hang", "ja": "jpn_Jpan", "zh": "zho_Hans",
    "es": "spa_Latn", "fr": "fra_Latn", "de": "deu_Latn", "ru": "rus_Cyrl",
    "ar": "arb_Arab", "hi": "hin_Deva", "pt": "por_Latn", "it": "ita_Latn",
    "vi": "vie_Latn", "id": "ind_Latn", "th": "tha_Thai",
}


def _to_nllb(iso: str) -> str:
    if iso in _LANG.values():
        return iso
    code = _LANG.get(iso.lower())
    if not code:
        raise RuntimeError(f"NLLB language not supported: {iso}")
    return code


class NLLBTranslator:
    def __init__(self, model_id: str = "facebook/nllb-200-distilled-600M") -> None:
        self.model_id = model_id
        self._tok: Any = None
        self._model: Any = None

    async def load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        device = "cuda" if torch.cuda.is_available() else "cpu"

        def _load() -> tuple[Any, Any]:
            tok = AutoTokenizer.from_pretrained(self.model_id, cache_dir=str(settings.model_cache_dir / "hf"))
            mdl = AutoModelForSeq2SeqLM.from_pretrained(
                self.model_id, cache_dir=str(settings.model_cache_dir / "hf"),
                torch_dtype=torch.float16 if device == "cuda" else torch.float32,
            )
            mdl.to(device)
            mdl.eval()
            return tok, mdl

        async with gpu_lock:
            self._tok, self._model = await asyncio.to_thread(_load)
        log.info("nllb_loaded", model=self.model_id, device=device)

    async def translate_batch(self, texts: list[str], *, source_lang: str, target_lang: str) -> list[str]:
        await self.load()
        src = "eng_Latn" if source_lang == "auto" else _to_nllb(source_lang)
        tgt = _to_nllb(target_lang)

        def _run() -> list[str]:
            import torch
            self._tok.src_lang = src
            inputs = self._tok(
                texts, return_tensors="pt", padding=True, truncation=True, max_length=512,
            ).to(self._model.device)
            forced = self._tok.convert_tokens_to_ids(tgt)
            with torch.no_grad():
                out = self._model.generate(**inputs, forced_bos_token_id=forced, max_new_tokens=512, num_beams=4)
            return self._tok.batch_decode(out, skip_special_tokens=True)

        async with gpu_lock:
            return await asyncio.to_thread(_run)


nllb = NLLBTranslator()
