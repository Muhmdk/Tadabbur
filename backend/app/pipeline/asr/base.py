"""ASRProvider interface.

This is the seam that makes the vendor swappable. Everything outside this
package talks to ASRProvider, never to a vendor SDK directly. See CLAUDE.md §7.
"""

from collections.abc import AsyncIterator
from typing import Protocol


class ASRTranscript:
    """Single transcript event emitted by the provider.

    `is_final` distinguishes interim partials from finalized clauses. Only
    finals are sent to the translation stage.
    """

    text: str
    lang: str
    is_final: bool
    chunk_id: str
    timestamp_ms: int


class ASRProvider(Protocol):
    """Streaming ASR. One instance per session."""

    async def open(self, source_language: str) -> None:
        """Establish the streaming connection. Call at session creation, not
        on first audio frame — see CLAUDE.md §2."""
        ...

    async def feed_audio(self, chunk: bytes) -> None:
        """Push one audio chunk from the speaker. Format negotiated in open()."""
        ...

    def transcripts(self) -> AsyncIterator[ASRTranscript]:
        """Async iterator of transcript events from the provider."""
        ...

    async def close(self) -> None:
        """Flush and tear down the upstream connection."""
        ...
