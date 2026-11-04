"""Exercise real clause publication decisions with fake external providers."""

import asyncio
from collections.abc import AsyncIterator

import pytest

from app.models.contract import (
    ServerCaptionFinal,
    ServerRecitationState,
    ServerSessionState,
    Session,
)
from app.pipeline import session as pipeline
from app.pipeline.asr.base import ASRTranscript


class FakeASR:
    def __init__(self, events: list[ASRTranscript] | None = None) -> None:
        self.events = events or []

    async def open(self, source_language: str) -> None:
        pass

    async def feed_audio(self, chunk: bytes) -> None:
        pass

    async def transcripts(self) -> AsyncIterator[ASRTranscript]:
        for event in self.events:
            yield event

    async def close(self) -> None:
        pass


class FakeRouter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def translate_to_all(
        self, text: str, source_lang: str, targets: list[str]
    ) -> dict[str, str]:
        self.calls.append(text)
        return {target: "English meaning" for target in targets}


def _runtime(
    asr: FakeASR | None = None, router: FakeRouter | None = None
) -> pipeline.SessionRuntime:
    return pipeline.SessionRuntime(
        session=Session(
            id="s1",
            sourceLanguage="ar",
            targetLanguages=["en"],
            status="live",
            createdAt="2026-09-21T00:00:00Z",
        ),
        asr=asr or FakeASR(),
        router=router or FakeRouter(),
    )


@pytest.mark.asyncio
async def test_quran_final_never_calls_translation_and_contains_no_source(monkeypatch) -> None:
    published = []

    async def capture(session_id, message):
        published.append(message)

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    router = FakeRouter()
    runtime = _runtime(router=router)
    await pipeline._publish_final(runtime, "chunk", "قل هو الله أحد")
    assert router.calls == []
    assert len(published) == 1
    final = published[0]
    assert isinstance(final, ServerCaptionFinal)
    assert final.isQuranicCandidate is True
    assert final.source == ""
    assert final.translations == {}


@pytest.mark.asyncio
async def test_quran_partial_latches_protection_through_later_asr_revision(monkeypatch) -> None:
    published = []

    async def capture(session_id, message):
        published.append(message)

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    router = FakeRouter()
    runtime = _runtime(router=router)
    await pipeline._publish_partial(runtime, "chunk", "قل هو الله أحد")
    await pipeline._publish_partial(runtime, "chunk", "قل هو الله احل")
    await pipeline._publish_final(runtime, "chunk", "قل هو الله احل")
    assert [message.text for message in published[:2]] == ["", ""]
    assert published[2].source == ""
    assert published[2].translations == {}
    assert router.calls == []


@pytest.mark.asyncio
async def test_ordinary_clause_is_translated_and_published(monkeypatch) -> None:
    published = []

    async def capture(session_id, message):
        published.append(message)

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    router = FakeRouter()
    await pipeline._publish_final(_runtime(router=router), "chunk", "هذا شرح لموضوع الخطبة")
    assert router.calls == ["هذا شرح لموضوع الخطبة"]
    assert published[0].translations == {"en": "English meaning"}
    assert published[0].isQuranicCandidate is False


@pytest.mark.asyncio
async def test_manual_mode_cancels_in_flight_translation_before_publication(monkeypatch) -> None:
    published = []
    translating = asyncio.Event()
    continue_translation = asyncio.Event()

    async def capture(session_id, message):
        published.append(message)

    class SlowRouter(FakeRouter):
        async def translate_to_all(self, text, source_lang, targets):
            translating.set()
            await continue_translation.wait()
            return {"en": "Should never appear"}

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    runtime = _runtime(router=SlowRouter())
    publication = asyncio.create_task(
        pipeline._publish_final(runtime, "chunk", "هذا كلام من الخطبة اليوم")
    )
    await translating.wait()
    await pipeline.set_recitation_mode(runtime, True)
    continue_translation.set()
    await publication
    assert len(published) == 1
    assert isinstance(published[0], ServerRecitationState)
    assert published[0].active is True


@pytest.mark.asyncio
async def test_mode_discards_delayed_ayah_and_resumes_after_utterance(monkeypatch) -> None:
    published = []

    async def capture(session_id, message):
        published.append(message)

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    runtime = _runtime()
    await pipeline.set_recitation_mode(runtime, True)
    await pipeline.set_recitation_mode(runtime, False)
    runtime.asr = FakeASR(
        [
            ASRTranscript("قل هو الله أحد", "ar", True, "1", 1),
            ASRTranscript("", "ar", True, "1", 2, ends_utterance=True),
            ASRTranscript("هذه كلمة من الخطبة", "ar", True, "2", 3),
        ]
    )
    await pipeline._pump(runtime)
    captions = [message for message in published if isinstance(message, ServerCaptionFinal)]
    assert len(captions) == 1
    assert captions[0].source == "هذه كلمة من الخطبة"


@pytest.mark.asyncio
async def test_close_failure_on_stop_still_ends_session_and_releases_lease(monkeypatch) -> None:
    published = []
    saved = []
    released = []

    async def capture(session_id, message):
        published.append(message)

    async def save(session):
        saved.append(session)

    async def release(session_id, token):
        released.append((session_id, token))

    class BrokenCloseASR(FakeASR):
        async def close(self):
            raise RuntimeError("provider failed")

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    monkeypatch.setattr(pipeline.session_store, "save", save)
    monkeypatch.setattr(pipeline.speakers, "release", release)
    runtime = _runtime(asr=BrokenCloseASR())
    runtime.lease_token = "owner"
    pipeline._runtimes["s1"] = runtime
    await pipeline.close_session("s1", end=True)
    assert saved[0].status == "ended"
    assert released == [("s1", "owner")]
    assert any(
        isinstance(message, ServerSessionState) and message.state == "ended"
        for message in published
    )


@pytest.mark.asyncio
async def test_unexpected_close_keeps_session_live_for_reconnect(monkeypatch) -> None:
    published = []
    saved = []
    released = []

    async def capture(session_id, message):
        published.append(message)

    async def save(session):
        saved.append(session)

    async def release(session_id, token):
        released.append((session_id, token))

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    monkeypatch.setattr(pipeline.session_store, "save", save)
    monkeypatch.setattr(pipeline.speakers, "release", release)
    runtime = _runtime()
    runtime.lease_token = "owner"
    runtime.recitation_active = True
    pipeline._runtimes["s1"] = runtime
    await pipeline.close_session("s1", end=False)
    assert saved == []  # status stays "live"
    assert released == [("s1", "owner")]
    states = [m for m in published if isinstance(m, ServerSessionState)]
    assert [m.state for m in states] == ["connecting"]
    # Quran mode is not lifted while the speaker is away.
    assert not any(isinstance(m, ServerRecitationState) for m in published)


@pytest.mark.asyncio
async def test_translation_failure_publishes_untranslated_phrase_and_keeps_going(
    monkeypatch,
) -> None:
    published = []

    async def capture(session_id, message):
        published.append(message)

    class FlakyRouter(FakeRouter):
        async def translate_to_all(self, text, source_lang, targets):
            self.calls.append(text)
            if len(self.calls) == 1:
                raise RuntimeError("provider outage")
            return {"en": "English meaning"}

    monkeypatch.setattr(pipeline.redis_pubsub, "publish", capture)
    runtime = _runtime(
        asr=FakeASR(
            [
                ASRTranscript("هذه كلمة من الخطبة", "ar", True, "1", 1),
                ASRTranscript("", "ar", True, "1", 2, ends_utterance=True),
                ASRTranscript("نتحدث اليوم عن الصدق", "ar", True, "2", 3),
                ASRTranscript("", "ar", True, "2", 4, ends_utterance=True),
            ]
        ),
        router=FlakyRouter(),
    )
    await pipeline._pump(runtime)
    assert runtime.failed is False
    finals = [message for message in published if isinstance(message, ServerCaptionFinal)]
    assert [final.translations for final in finals] == [{}, {"en": "English meaning"}]
    assert finals[0].source == "هذه كلمة من الخطبة"  # Arabic still shown, marked untranslated
