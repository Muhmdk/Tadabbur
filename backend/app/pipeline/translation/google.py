"""Google Translate implementation of Translator. Fallback provider."""

from app.pipeline.translation.base import Translator


class GoogleTranslator(Translator):
    def __init__(self, credentials_path: str) -> None:
        self._credentials_path = credentials_path
        # TODO: build google.cloud.translate client.

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        # TODO: call Google. Raise on failure.
        raise NotImplementedError
