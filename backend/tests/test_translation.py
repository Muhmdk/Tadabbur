"""Fallback must deliver English, or mark the phrase untranslated without failing."""

import asyncio
import time

import pytest

from app.pipeline.translation import orchestrator
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


class SlowProvider:
    def __init__(self, delay: float) -> None:
        self.delay = delay
        self.calls = 0

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        self.calls += 1
        await asyncio.sleep(self.delay)
        return "slow English"


class CountingFailingProvider(FailingProvider):
    def __init__(self) -> None:
        self.calls = 0

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        self.calls += 1
        return await super().translate(text, source_lang, target_lang)


@pytest.mark.asyncio
async def test_a_slow_primary_is_hedged_with_the_fallback(monkeypatch) -> None:
    monkeypatch.setattr(orchestrator, "_HEDGE_SECONDS", 0.05)
    router = TranslationRouter([SlowProvider(2.0), WorkingProvider()])
    started = time.monotonic()
    assert await router.translate_to_all("Arabic", "ar", ["en"]) == {"en": "English translation"}
    assert time.monotonic() - started < 1.0


@pytest.mark.asyncio
async def test_a_fast_primary_is_not_hedged(monkeypatch) -> None:
    monkeypatch.setattr(orchestrator, "_HEDGE_SECONDS", 0.5)
    primary, fallback = SlowProvider(0.01), SlowProvider(0.01)
    router = TranslationRouter([primary, fallback])
    assert await router.translate_to_all("Arabic", "ar", ["en"]) == {"en": "slow English"}
    assert (primary.calls, fallback.calls) == (1, 0)


@pytest.mark.asyncio
async def test_a_failing_primary_is_skipped_after_three_failures() -> None:
    primary = CountingFailingProvider()
    router = TranslationRouter([primary, WorkingProvider()])
    for _ in range(5):
        assert await router.translate_to_all("Arabic", "ar", ["en"]) == {
            "en": "English translation"
        }
    assert primary.calls == 3  # later phrases go straight to the fallback
