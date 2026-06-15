"""Session lifecycle and pipeline wiring.

A session ties together:
  - one ASRProvider stream (Arabic in, source text out)
  - one Translator per target language (clause-boundary translation)
  - one Redis publisher (fan-out to viewers)

Pre-connect: ASRProvider.open() should be called when the session is created
(REST), not when the speaker WebSocket attaches. This eliminates cold-start
latency on the first audio frame — see CLAUDE.md §2.
"""

from dataclasses import dataclass

from app.models.contract import Session


@dataclass
class SessionRuntime:
    """In-memory handle for one live session on this worker.

    Stateless workers + Redis is the scaling story — but a single ASR stream
    is pinned to the worker that opened it. The speaker websocket must land on
    that worker (sticky routing) or the session must be migrated. TODO either.
    """

    session: Session
    # TODO: asr: ASRProvider
    # TODO: translators: dict[str, Translator]
    # TODO: publisher: RedisPublisher


async def open_session(session: Session) -> SessionRuntime:
    """Called from REST create_session. Pre-warms ASR + Translators."""
    # TODO: instantiate ASRProvider, call .open(), wire callbacks to translate+publish.
    # TODO: instantiate one Translator per session.targetLanguages entry.
    # TODO: publish initial session.state = "ready" to the Redis channel.
    raise NotImplementedError


async def close_session(runtime: SessionRuntime) -> None:
    """Drain ASR, flush final caption, publish session.state = "ended"."""
    raise NotImplementedError


async def attach_speaker(session_id: str, websocket) -> None:  # noqa: ANN001
    """Bind the speaker websocket to an already-open session."""
    raise NotImplementedError
