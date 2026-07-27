"""Speechmatics implementation of ASRProvider.

The Speechmatics SDK is imported here and **only** here. See CLAUDE.md §7.

Speechmatics real-time streams raw PCM only (no webm/opus), so the speaker's
audio must arrive as mono 16-bit little-endian PCM at `sample_rate`; the
frontend mic capture is responsible for producing that. The SDK delivers
transcript events to synchronous callbacks, which fan them onto an asyncio queue
that `transcripts()` drains.
"""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import speechmatics.rt as rt

from app.models.contract import AUDIO_SAMPLE_RATE_HZ
from app.pipeline.asr.base import ASRProvider, ASRTranscript

# Audio format is pinned by the wire contract (AUDIO_FORMAT). Speechmatics needs
# the matching enum for the contract's s16le PCM encoding.
_SAMPLE_RATE = AUDIO_SAMPLE_RATE_HZ
_ENCODING = rt.AudioEncoding.PCM_S16LE
# max_delay is the primary latency knob (Speechmatics range 0.7–4.0s): lower
# finalizes clauses sooner at some accuracy cost. Latency is priority #1
# (CLAUDE.md §1); tune against real audio once a key is available.
_MAX_DELAY = 1.0
# A short pause marks a translation-ready phrase. Without this, short phrases
# remain buffered until punctuation, the word cap, or the entire stream ends.
_END_OF_UTTERANCE_SILENCE_SECONDS = 0.7

# Sentinel marking end-of-stream on the transcript queue.
_DONE = object()


class SpeechmaticsASR(ASRProvider):
    """Streaming ASR backed by Speechmatics real-time. One instance per session."""

    def __init__(
        self,
        api_key: str,
        *,
        sample_rate: int = _SAMPLE_RATE,
        model: rt.Model = rt.Model.ENHANCED,
    ) -> None:
        self._api_key = api_key
        self._sample_rate = sample_rate
        self._model = model
        self._client: rt.AsyncClient | None = None
        self._language = ""
        self._queue: asyncio.Queue[Any] = asyncio.Queue()
        # Partials for the in-progress clause share one chunk id; it rotates
        # after each final so the display can replace a partial with its final.
        self._chunk_id = uuid.uuid4().hex

    async def open(self, source_language: str) -> None:
        self._language = source_language
        client = rt.AsyncClient(api_key=self._api_key)
        client.on(rt.ServerMessageType.ADD_PARTIAL_TRANSCRIPT, self._on_partial)
        client.on(rt.ServerMessageType.ADD_TRANSCRIPT, self._on_final)
        client.on(rt.ServerMessageType.END_OF_UTTERANCE, self._on_end_of_utterance)
        client.on(rt.ServerMessageType.ERROR, self._on_error)
        await client.start_session(
            transcription_config=rt.TranscriptionConfig(
                language=source_language,
                model=self._model,
                enable_partials=True,
                max_delay=_MAX_DELAY,
                conversation_config=rt.ConversationConfig(
                    end_of_utterance_silence_trigger=_END_OF_UTTERANCE_SILENCE_SECONDS
                ),
            ),
            audio_format=rt.AudioFormat(encoding=_ENCODING, sample_rate=self._sample_rate),
        )
        self._client = client

    async def feed_audio(self, chunk: bytes) -> None:
        if self._client is None:
            raise RuntimeError("feed_audio() called before open()")
        await self._client.send_audio(chunk)

    async def transcripts(self) -> AsyncIterator[ASRTranscript]:
        while True:
            item = await self._queue.get()
            if item is _DONE:
                return
            if isinstance(item, Exception):
                raise item
            yield item

    async def close(self) -> None:
        if self._client is not None:
            try:
                await self._client.stop_session()
            finally:
                await self._client.close()
                self._client = None
        await self._queue.put(_DONE)

    # --- SDK callbacks: synchronous, invoked from the client's recv loop ---

    def _on_partial(self, message: dict[str, Any]) -> None:
        self._enqueue(message, is_final=False)

    def _on_final(self, message: dict[str, Any]) -> None:
        self._enqueue(message, is_final=True)
        self._chunk_id = uuid.uuid4().hex  # rotate for the next clause

    def _on_error(self, message: dict[str, Any]) -> None:
        # Surface upstream errors to the consumer; never swallow (CLAUDE.md §6).
        self._queue.put_nowait(RuntimeError(f"Speechmatics error: {message}"))

    def _on_end_of_utterance(self, _message: dict[str, Any]) -> None:
        self._queue.put_nowait(
            ASRTranscript(
                text="",
                lang=self._language,
                is_final=True,
                chunk_id=self._chunk_id,
                timestamp_ms=int(time.time() * 1000),
                ends_utterance=True,
            )
        )
        self._chunk_id = uuid.uuid4().hex

    def _enqueue(self, message: dict[str, Any], *, is_final: bool) -> None:
        transcript = message.get("metadata", {}).get("transcript", "")
        self._queue.put_nowait(
            ASRTranscript(
                text=transcript,
                lang=self._language,
                is_final=is_final,
                chunk_id=self._chunk_id,
                timestamp_ms=int(time.time() * 1000),
            )
        )
