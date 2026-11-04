"""Fallback must deliver English, or mark the phrase untranslated without failing."""

import pytest

from app.pipeline.translation.orchestrator import TranslationRouter


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
async def test_failed_target_is_left_out_instead_of_faked_or_raised() -> None:
    router = TranslationRouter([FailingProvider()])
    assert await router.translate_to_all("Arabic", "ar", ["en"]) == {}
