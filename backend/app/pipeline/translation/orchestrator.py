"""Translation orchestration: a primary provider with ordered fallbacks.

For each target language the router tries providers in order and uses the first
that succeeds (DeepL primary, Google fallback). Targets are translated
concurrently to keep clause latency low. A failed target raises so the session
never silently presents an untranslated sermon clause as a successful caption.
"""

import asyncio
import logging

from app.pipeline.translation.base import Translator

logger = logging.getLogger(__name__)
_PROVIDER_TIMEOUT_SECONDS = 4.0


class TranslationUnavailable(RuntimeError):
    """No configured provider could translate a requested target language."""


class TranslationRouter:
    """Fan a clause out to every target language across ordered providers."""

    def __init__(self, providers: list[Translator]) -> None:
        self._providers = providers

    async def translate_to_all(
        self, text: str, source_lang: str, targets: list[str]
    ) -> dict[str, str]:
        results = await asyncio.gather(
            *(self._translate(text, source_lang, target) for target in targets)
        )
        return dict(zip(targets, results, strict=True))

    async def _translate(self, text: str, source_lang: str, target: str) -> str:
        for provider in self._providers:
            try:
                return await asyncio.wait_for(
                    provider.translate(text, source_lang, target),
                    timeout=_PROVIDER_TIMEOUT_SECONDS,
                )
            except Exception as exc:
                logger.warning(
                    "translation %s->%s failed via %s (%s)",
                    source_lang,
                    target,
                    type(provider).__name__,
                    type(exc).__name__,
                )
        raise TranslationUnavailable(f"No provider translated {source_lang} to {target}")
