"""Translation orchestration: a primary provider with ordered fallbacks.

For each target language the router tries providers in order and uses the first
that succeeds (DeepL primary, Google fallback — CLAUDE.md §7). Targets are
translated concurrently to keep clause latency low (§1). A target whose
providers all fail is omitted from the result rather than blocking the caption;
the failure is logged, not silently swallowed (§6).
"""

import asyncio
import logging

from app.pipeline.translation.base import Translator

logger = logging.getLogger(__name__)


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
        return {t: r for t, r in zip(targets, results, strict=True) if r is not None}

    async def _translate(self, text: str, source_lang: str, target: str) -> str | None:
        for provider in self._providers:
            try:
                return await provider.translate(text, source_lang, target)
            except Exception as exc:
                logger.warning(
                    "translation %s->%s failed via %s: %s",
                    source_lang,
                    target,
                    type(provider).__name__,
                    exc,
                )
        return None
