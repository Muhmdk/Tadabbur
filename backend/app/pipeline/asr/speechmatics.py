"""Speechmatics implementation of ASRProvider.

The Speechmatics SDK is imported here and **only** here. See CLAUDE.md §7.
"""

from collections.abc import AsyncIterator

from app.pipeline.asr.base import ASRProvider, ASRTranscript


class SpeechmaticsASR(ASRProvider):
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        # TODO: lazily build the Speechmatics client.

    async def open(self, source_language: str) -> None:
        # TODO: open Speechmatics real-time session, configure audio format
        # and language, register their callback to push into an internal queue.
        raise NotImplementedError

    async def feed_audio(self, chunk: bytes) -> None:
        # TODO: forward to Speechmatics SDK.
        raise NotImplementedError

    def transcripts(self) -> AsyncIterator[ASRTranscript]:
        # TODO: yield from internal queue populated by Speechmatics callbacks.
        raise NotImplementedError

    async def close(self) -> None:
        # TODO: send EOS, await final transcripts, close the connection.
        raise NotImplementedError
