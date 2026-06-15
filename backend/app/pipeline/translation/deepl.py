"""DeepL implementation of Translator. Primary provider."""

from app.pipeline.translation.base import Translator


class DeepLTranslator(Translator):
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        # TODO: build deepl.Translator client.

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        # TODO: call DeepL. Map BCP-47 tags to DeepL's expected codes
        # (e.g. "en" -> "EN-US"). Raise on failure — no silent fallback here.
        raise NotImplementedError
