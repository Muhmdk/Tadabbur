"""Fallback must deliver English or visibly fail the session."""

import pytest

from app.pipeline.translation.orchestrator import TranslationRouter, TranslationUnavailable


class FailingProvider:
    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        raise RuntimeError("request failed")


class WorkingProvider:
    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        return "English translation"


@pytest.mark.asyncio
async def test_google_style_fallback_is_used_after_primary_failure() -> None:
    router = TranslationRouter([FailingProvider(), WorkingProvider()])
    assert await router.translate_to_all("Arabic", "ar", ["en"]) == {"en": "English translation"}


@pytest.mark.asyncio
async def test_no_provider_does_not_publish_empty_success() -> None:
    router = TranslationRouter([FailingProvider()])
    with pytest.raises(TranslationUnavailable):
        await router.translate_to_all("Arabic", "ar", ["en"])
