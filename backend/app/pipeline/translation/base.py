"""Translator interface.

Translation runs on clause boundaries (final transcripts), not on every
partial. The orchestrator picks a primary Translator and falls back to a
secondary on failure. See CLAUDE.md §7.
"""

from typing import Protocol


class Translator(Protocol):
    """One translator instance handles many languages over its lifetime."""

    async def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate `text` from `source_lang` to `target_lang`.

        Raises on transport/provider failure so the orchestrator can fall back.
        Returns the translated string. Implementations must NOT silently return
        the input on error.
        """
        ...
