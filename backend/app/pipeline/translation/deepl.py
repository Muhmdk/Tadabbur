"""DeepL implementation of Translator. Primary provider.

The DeepL SDK is imported here and **only** here (CLAUDE.md §7). The SDK is
synchronous, so calls run in a worker thread to avoid blocking the event loop.
"""

import asyncio

import deepl

from app.pipeline.translation.base import Translator

# BCP-47 (contract) → DeepL target codes. DeepL wants uppercase, and English as
# a target needs a regional variant. Only contract languages are handled (§8).
_TARGET_OVERRIDES = {"en": "EN-US"}


class DeepLTranslator(Translator):
    def __init__(self, api_key: str) -> None:
        self._client = deepl.DeepLClient(api_key)

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        # deepl SDK is synchronous — run it off the event loop. Raises on
        # failure (contract requirement); never silently returns the input.
        result = await asyncio.to_thread(
            self._client.translate_text,
            text,
            source_lang=self._source(source_lang),
            target_lang=self._target(target_lang),
        )
        return result.text

    @staticmethod
    def _source(lang: str) -> str:
        # DeepL source codes carry no regional variant: "ar" -> "AR".
        return lang.split("-")[0].upper()

    @staticmethod
    def _target(lang: str) -> str:
        if "-" in lang:
            return lang.upper()  # e.g. "en-GB" -> "EN-GB"
        return _TARGET_OVERRIDES.get(lang.lower(), lang.upper())
