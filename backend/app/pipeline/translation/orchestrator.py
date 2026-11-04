"""Translation orchestration: a primary provider with ordered fallbacks.

For each target language the router tries providers in order (DeepL primary,
Google fallback). Targets are translated concurrently to keep clause latency low.

Two guards keep a struggling provider from slowing every caption:

- Hedging: if the current provider has not answered within `_HEDGE_SECONDS`, the
  next provider is asked as well and the first good answer wins. A slow DeepL
  costs ~1.5 s per phrase instead of the full timeout.
- Circuit breaker: after `_TRIP_AFTER` consecutive failures a provider is skipped
  for `_COOL_DOWN_SECONDS`, then tried again. Skipped providers are still used
  when no other provider is available.

A target that no provider could translate is left out of the result, so the
caption carries the Arabic with "translation unavailable" for that phrase. The
session keeps running: one failed request must never stop live captions, and an
untranslated clause is never presented as a translation.
"""

import asyncio
import logging
import time
from dataclasses import dataclass

from app.pipeline.translation.base import Translator

logger = logging.getLogger(__name__)
_PROVIDER_TIMEOUT_SECONDS = 4.0
_HEDGE_SECONDS = 1.5
_TRIP_AFTER = 3
_COOL_DOWN_SECONDS = 30.0


@dataclass
class _Health:
    failures: int = 0
    skip_until: float = 0.0


class TranslationRouter:
    """Fan a clause out to every target language across ordered providers."""

    def __init__(self, providers: list[Translator]) -> None:
        self._providers = providers
        self._health = {id(provider): _Health() for provider in providers}

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

    def _available(self) -> list[Translator]:
        now = time.monotonic()
        healthy = [p for p in self._providers if self._health[id(p)].skip_until <= now]
        return healthy or list(self._providers)

    async def _translate(self, text: str, source_lang: str, target: str) -> str | None:
        providers = self._available()
        attempts: set[asyncio.Task[str]] = set()
        try:
            for index, provider in enumerate(providers):
                attempts.add(
                    asyncio.create_task(self._attempt(provider, text, source_lang, target))
                )
                last = index == len(providers) - 1
                result = await _first_success(attempts, None if last else _HEDGE_SECONDS)
                if result is not None:
                    return result
        finally:
            for attempt in attempts:
                attempt.cancel()
        logger.error(
            "no provider translated %s->%s; phrase shown untranslated", source_lang, target
        )
        return None

    async def _attempt(self, provider: Translator, text: str, source_lang: str, target: str) -> str:
        health = self._health[id(provider)]
        try:
            result = await asyncio.wait_for(
                provider.translate(text, source_lang, target),
                timeout=_PROVIDER_TIMEOUT_SECONDS,
            )
        except asyncio.CancelledError:
            raise  # lost a hedge race; not the provider's fault
        except Exception as exc:
            health.failures += 1
            logger.warning(
                "translation %s->%s failed via %s (%s)",
                source_lang,
                target,
                type(provider).__name__,
                type(exc).__name__,
            )
            if health.failures >= _TRIP_AFTER:
                health.skip_until = time.monotonic() + _COOL_DOWN_SECONDS
                logger.error(
                    "skipping %s for %.0f s after %d failures",
                    type(provider).__name__,
                    _COOL_DOWN_SECONDS,
                    health.failures,
                )
            raise
        health.failures = 0
        health.skip_until = 0.0
        return result


async def _first_success(attempts: set[asyncio.Task[str]], hedge_after: float | None) -> str | None:
    """Wait for any attempt to succeed. None if all failed or `hedge_after` passed."""
    loop = asyncio.get_running_loop()
    deadline = None if hedge_after is None else loop.time() + hedge_after
    pending = {attempt for attempt in attempts if not attempt.done()}
    for attempt in attempts - pending:
        if not attempt.cancelled() and attempt.exception() is None:
            return attempt.result()
    while pending:
        remaining = None if deadline is None else max(0.0, deadline - loop.time())
        done, pending = await asyncio.wait(
            pending, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
        )
        if not done:
            return None  # still waiting on slow attempts: time to hedge
        for attempt in done:
            if not attempt.cancelled() and attempt.exception() is None:
                return attempt.result()
    return None
