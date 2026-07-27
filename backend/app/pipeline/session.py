"""Session lifecycle and pipeline wiring.

A session ties together:
  - one ASRProvider stream (Arabic in, source text out)
  - clause assembly (granular ASR finals → translation-ready clauses)
  - one Redis publisher (fan-out to viewers)

The ASR stream is pinned to the worker that opens it; the runtime registry below
is that worker's in-memory state. Sticky routing / migration is still a TODO
(see CLAUDE.md §2). Translators are not wired yet — clauses are published with
empty translations until the DeepL/Google stage lands.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass

from app.broadcast import redis_pubsub
from app.config import settings
from app.models.contract import (
    ServerCaptionFinal,
    ServerCaptionPartial,
    ServerSessionState,
    Session,
)
from app.pipeline.asr.base import ASRProvider
from app.pipeline.asr.speechmatics import SpeechmaticsASR
from app.pipeline.clauses import ClauseAssembler
from app.pipeline.translation.base import Translator
from app.pipeline.translation.deepl import DeepLTranslator
from app.pipeline.translation.orchestrator import TranslationRouter


@dataclass
class SessionRuntime:
    """In-memory handle for one live session on this worker."""

    session: Session
    asr: ASRProvider
    router: TranslationRouter
    pump: asyncio.Task | None = None


# session_id -> runtime, for the session(s) whose ASR stream this worker holds.
_runtimes: dict[str, SessionRuntime] = {}


def has_runtime(session_id: str) -> bool:
    return session_id in _runtimes


def _build_router() -> TranslationRouter:
    providers: list[Translator] = []
    if settings.deepl_api_key:
        providers.append(DeepLTranslator(settings.deepl_api_key))
    # TODO: append GoogleTranslator(settings.google_application_credentials) as fallback.
    return TranslationRouter(providers)


async def open_session(session: Session) -> SessionRuntime:
    """Open the ASR stream and start publishing captions for this session."""
    asr: ASRProvider = SpeechmaticsASR(settings.speechmatics_api_key)
    await asr.open(session.sourceLanguage)
    runtime = SessionRuntime(session=session, asr=asr, router=_build_router())
    _runtimes[session.id] = runtime
    runtime.pump = asyncio.create_task(_pump(runtime))
    await redis_pubsub.publish(
        session.id,
        ServerSessionState(type="session.state", sessionId=session.id, state="live"),
    )
    return runtime


async def close_session(session_id: str) -> None:
    """Drain the ASR stream (flushing the final clause) and mark the session ended."""
    runtime = _runtimes.pop(session_id, None)
    if runtime is None:
        return
    await runtime.asr.close()  # ends the transcript stream → pump flushes + exits
    if runtime.pump is not None:
        await runtime.pump
    await redis_pubsub.publish(
        session_id,
        ServerSessionState(type="session.state", sessionId=session_id, state="ended"),
    )


async def _pump(runtime: SessionRuntime) -> None:
    """Consume ASR transcripts, assemble clauses, publish captions to Redis."""
    session = runtime.session
    assembler = ClauseAssembler()
    clause_id = uuid.uuid4().hex
    try:
        async for t in runtime.asr.transcripts():
            if t.ends_utterance:
                clause = assembler.flush()
                if clause is not None:
                    await _publish_final(runtime, clause_id, clause)
                    clause_id = uuid.uuid4().hex
                continue
            if t.is_final:
                clause = assembler.add_final(t.text)
                if clause is not None:
                    await _publish_final(runtime, clause_id, clause)
                    clause_id = uuid.uuid4().hex
                else:
                    await _publish_partial(session, clause_id, assembler.current)
            else:
                tail = t.text.strip()
                live = f"{assembler.current} {tail}".strip()
                await _publish_partial(session, clause_id, live)
        # stream ended cleanly — flush any buffered clause
        clause = assembler.flush()
        if clause is not None:
            await _publish_final(runtime, clause_id, clause)
    except Exception as exc:  # surface ASR/transport failures to viewers
        await redis_pubsub.publish(
            session.id,
            ServerSessionState(
                type="session.state", sessionId=session.id, state="error", error=str(exc)
            ),
        )


async def _publish_partial(session: Session, clause_id: str, text: str) -> None:
    await redis_pubsub.publish(
        session.id,
        ServerCaptionPartial(
            type="caption.partial",
            sessionId=session.id,
            chunkId=clause_id,
            text=text,
            lang=session.sourceLanguage,
            timestamp=_now_ms(),
        ),
    )


async def _publish_final(runtime: SessionRuntime, clause_id: str, clause: str) -> None:
    session = runtime.session
    translations = await runtime.router.translate_to_all(
        clause, session.sourceLanguage, session.targetLanguages
    )
    await redis_pubsub.publish(
        session.id,
        ServerCaptionFinal(
            type="caption.final",
            sessionId=session.id,
            chunkId=clause_id,
            source=clause,
            sourceLang=session.sourceLanguage,
            translations=translations,
            timestamp=_now_ms(),
        ),
    )


def _now_ms() -> int:
    return int(time.time() * 1000)
