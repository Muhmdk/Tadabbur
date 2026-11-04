"""Translation orchestration: a primary provider with ordered fallbacks.

For each target language the router tries providers in order and uses the first
that succeeds (DeepL primary, Google fallback). Targets are translated
concurrently to keep clause latency low.

A target that no provider could translate is left out of the result, so the
caption carries the Arabic with "translation unavailable" for that phrase. The
session keeps running: one failed request must never stop live captions, and an
untranslated clause is never presented as a translation.
"""

import asyncio
import logging

from app.pipeline.translation.base import Translator

logger = logging.getLogger(__name__)
_PROVIDER_TIMEOUT_SECONDS = 4.0


class TranslationRouter:
    """Fan a clause out to every target language across ordered providers."""

    def __init__(self, providers: list[Translator]) -> None:
        self._providers = providers

    async def translate_to_all(
        self, text: str, source_lang: str, targets: list[str]
    ) -> dict[str, str]:
        """Return translations for the targets that succeeded; omit the rest."""
        results = await asyncio.gather(
            *(self._translate(text, source_lang, target) for target in targets)
        )
        return {
            target: result
            for target, result in zip(targets, results, strict=True)
            if result is not None
        }

    async def _translate(self, text: str, source_lang: str, target: str) -> str | None:
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
        logger.error(
            "no provider translated %s->%s; phrase shown untranslated", source_lang, target
        )
        return None
