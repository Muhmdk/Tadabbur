"""Google Cloud Translation v3 fallback provider."""

from google.cloud import translate_v3
from google.oauth2 import service_account

from app.pipeline.translation.base import Translator


class GoogleTranslator(Translator):
    def __init__(self, credentials_path: str) -> None:
        credentials = service_account.Credentials.from_service_account_file(credentials_path)
        if not credentials.project_id:
            raise ValueError("Google service account is missing project_id")
        self._parent = f"projects/{credentials.project_id}/locations/global"
        self._client = translate_v3.TranslationServiceAsyncClient(credentials=credentials)

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        response = await self._client.translate_text(
            request={
                "parent": self._parent,
                "contents": [text],
                "mime_type": "text/plain",
                "source_language_code": source_lang,
                "target_language_code": target_lang,
            },
            timeout=6.0,
        )
        if not response.translations or not response.translations[0].translated_text:
            raise RuntimeError("Google returned no translation")
        return response.translations[0].translated_text
