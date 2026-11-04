"""Session lifecycle and pipeline wiring.

A session ties together:
  - one ASRProvider stream (Arabic in, source text out)
  - clause assembly (granular ASR finals → translation-ready clauses)
  - one Redis publisher (fan-out to viewers)

The ASR stream is pinned to the worker that opens it; the runtime registry below
is that worker's in-memory state. Speaker ownership across workers is leased in
Redis by the WebSocket handler.
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

from app.broadcast import redis_pubsub
from app.config import settings
from app.models.contract import (
    ServerCaptionFinal,
    ServerCaptionPartial,
    ServerRecitationState,
    ServerSessionState,
    Session,
)
from app.pipeline.asr.base import ASRProvider
from app.pipeline.asr.speechmatics import SpeechmaticsASR
from app.pipeline.clauses import ClauseAssembler
from app.pipeline.quran import is_quranic_candidate
from app.pipeline.translation.base import Translator
from app.pipeline.translation.deepl import DeepLTranslator
from app.pipeline.translation.google import GoogleTranslator
from app.pipeline.translation.orchestrator import TranslationRouter
from app.store import sessions as session_store
from app.store import speakers


@dataclass
class SessionRuntime:
    """In-memory handle for one live session on this worker."""

    session: Session
    asr: ASRProvider
    router: TranslationRouter
    pump: asyncio.Task | None = None
    failed: bool = False
    recitation_active: bool = False
    resume_pending: bool = False
    resume_deadline: float = 0.0
    quranic_chunk_id: str | None = None
    recitation_epoch: int = 0
    publish_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    lease_token: str | None = None


# session_id -> runtime, for the session(s) whose ASR stream this worker holds.
_runtimes: dict[str, SessionRuntime] = {}
logger = logging.getLogger(__name__)


def has_runtime(session_id: str) -> bool:
    return session_id in _runtimes


def _build_router() -> TranslationRouter:
    providers: list[Translator] = []
    if settings.deepl_api_key:
        providers.append(DeepLTranslator(settings.deepl_api_key))
    if settings.google_application_credentials:
        providers.append(GoogleTranslator(settings.google_application_credentials))
    return TranslationRouter(providers)


async def open_session(session: Session, *, lease_token: str | None = None) -> SessionRuntime:
    """Open the ASR stream and start publishing captions for this session.

    A session may be reopened after the speaker reconnects; Quran mode carries
    over from the last broadcast state so a reconnect never silently lifts it.
    """
    router = _build_router()
    asr: ASRProvider = SpeechmaticsASR(settings.speechmatics_api_key)
    await asr.open(session.sourceLanguage)
    live = session.model_copy(update={"status": "live"})
    try:
        await session_store.save(live)
        recitation_active = await redis_pubsub.latest_recitation_active(session.id)
    except Exception:
        await asr.close()
        raise
    runtime = SessionRuntime(
        session=live,
        asr=asr,
        router=router,
        lease_token=lease_token,
        recitation_active=recitation_active,
    )
    _runtimes[session.id] = runtime
    runtime.pump = asyncio.create_task(_pump(runtime))
    try:
        await redis_pubsub.publish(
            session.id,
            ServerSessionState(type="session.state", sessionId=session.id, state="live"),
        )
    except Exception:
        _runtimes.pop(session.id, None)
        await asr.close()
        if runtime.pump is not None:
            await runtime.pump
        raise
    return runtime


async def close_session(session_id: str, *, end: bool) -> None:
    """Drain the ASR stream (flushing the final clause) and release the speaker.

    Only an explicit operator stop ends a session (`end=True`). A dropped
    connection, a provider failure, or a worker shutdown keeps the session live
    so the operator can reconnect to the same projector and attendee links;
    viewers are told the captions are reconnecting.
    """
    runtime = _runtimes.pop(session_id, None)
    if runtime is None:
        return
    try:
        try:
            await runtime.asr.close()  # ends the transcript stream → pump flushes + exits
        except Exception as exc:
            runtime.failed = True
            logger.error("ASR close failed (%s)", type(exc).__name__)
        if runtime.pump is not None:
            try:
                await runtime.pump
            except Exception as exc:
                runtime.failed = True
                logger.error("Session caption pump failed (%s)", type(exc).__name__)
        if end:
            await session_store.save(runtime.session.model_copy(update={"status": "ended"}))
            if runtime.recitation_active:
                await redis_pubsub.publish(
                    session_id,
                    ServerRecitationState(
                        type="recitation.state", sessionId=session_id, active=False
                    ),
                )
        await redis_pubsub.publish(
            session_id,
            ServerSessionState(
                type="session.state",
                sessionId=session_id,
                state="ended" if end else "connecting",
            ),
        )
    finally:
        if runtime.lease_token is not None:
            await speakers.release(session_id, runtime.lease_token)


async def close_all_sessions() -> None:
    """Drain active streams while Redis is still available during shutdown.

    A deploy or scale-in must not end a khutbah: sessions stay live and the
    operator reconnects to another worker.
    """
    for session_id in list(_runtimes):
        try:
            await close_session(session_id, end=False)
        except Exception as exc:
            logger.error("Session shutdown failed (%s)", type(exc).__name__)


async def set_recitation_mode(runtime: SessionRuntime, active: bool) -> None:
    """Switch the speaker's Quran override before broadcasting its state."""
    async with runtime.publish_lock:
        if runtime.recitation_active == active:
            return
        runtime.recitation_active = active
        runtime.resume_pending = not active
        runtime.resume_deadline = time.monotonic() + 2.5 if not active else 0.0
        runtime.quranic_chunk_id = None
        runtime.recitation_epoch += 1
        await redis_pubsub.publish(
            runtime.session.id,
            ServerRecitationState(
                type="recitation.state", sessionId=runtime.session.id, active=active
            ),
        )


async def _pump(runtime: SessionRuntime) -> None:
    """Consume ASR transcripts, assemble clauses, publish captions to Redis."""
    assembler = ClauseAssembler()
    clause_id = uuid.uuid4().hex
    try:
        async for t in runtime.asr.transcripts():
            if runtime.recitation_active:
                assembler = ClauseAssembler()
                clause_id = uuid.uuid4().hex
                continue
            if runtime.resume_pending:
                # Delayed ASR finals from the recitation must not leak into
                # translation when the operator releases the override.
                if t.ends_utterance or time.monotonic() >= runtime.resume_deadline:
                    runtime.resume_pending = False
                    assembler = ClauseAssembler()
                    clause_id = uuid.uuid4().hex
                continue
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
                    await _publish_partial(runtime, clause_id, assembler.current)
            else:
                tail = t.text.strip()
                live = f"{assembler.current} {tail}".strip()
                await _publish_partial(runtime, clause_id, live)
        # stream ended cleanly — flush any buffered clause
        if not runtime.recitation_active and not runtime.resume_pending:
            clause = assembler.flush()
            if clause is not None:
                await _publish_final(runtime, clause_id, clause)
    except Exception as exc:
        # The speaker handler sees `failed`, tells the operator, and closes the
        # runtime without ending the session; viewers then see "connecting".
        runtime.failed = True
        logger.error("Session caption pump failed (%s)", type(exc).__name__)


async def _publish_partial(runtime: SessionRuntime, clause_id: str, text: str) -> None:
    quranic = runtime.quranic_chunk_id == clause_id or is_quranic_candidate(text)
    async with runtime.publish_lock:
        if runtime.recitation_active or runtime.resume_pending:
            return
        if quranic:
            runtime.quranic_chunk_id = clause_id
        await redis_pubsub.publish(
            runtime.session.id,
            ServerCaptionPartial(
                type="caption.partial",
                sessionId=runtime.session.id,
                chunkId=clause_id,
                text="" if quranic else text,
                lang=runtime.session.sourceLanguage,
                timestamp=_now_ms(),
                isQuranicCandidate=quranic,
            ),
        )


async def _publish_final(runtime: SessionRuntime, clause_id: str, clause: str) -> None:
    session = runtime.session
    quranic = runtime.quranic_chunk_id == clause_id or is_quranic_candidate(clause)
    epoch = runtime.recitation_epoch
    if runtime.recitation_active or runtime.resume_pending:
        return
    translations = (
        {}
        if quranic
        else await runtime.router.translate_to_all(
            clause, session.sourceLanguage, session.targetLanguages
        )
    )
    async with runtime.publish_lock:
        if runtime.recitation_active or runtime.resume_pending or runtime.recitation_epoch != epoch:
            return
        await redis_pubsub.publish(
            session.id,
            ServerCaptionFinal(
                type="caption.final",
                sessionId=session.id,
                chunkId=clause_id,
                source="" if quranic else clause,
                sourceLang=session.sourceLanguage,
                translations=translations,
                timestamp=_now_ms(),
                isQuranicHadithCandidate=quranic,
                isQuranicCandidate=quranic,
            ),
        )
        if runtime.quranic_chunk_id == clause_id:
            runtime.quranic_chunk_id = None


def _now_ms() -> int:
    return int(time.time() * 1000)
