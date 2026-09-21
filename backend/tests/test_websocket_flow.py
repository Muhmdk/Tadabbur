"""In-process mic-to-viewer proof with fake ASR, translation, and Redis."""

import asyncio
from collections.abc import AsyncIterator

import fakeredis.aioredis
from fastapi.testclient import TestClient

from app import main, redis_client
from app.config import settings
from app.models.contract import Session
from app.pipeline import session as pipeline
from app.pipeline.asr.base import ASRTranscript
from app.store import sessions as session_store


class FrameASR:
    def __init__(self, api_key: str) -> None:
        self.queue: asyncio.Queue[ASRTranscript | None] = asyncio.Queue()

    async def open(self, source_language: str) -> None:
        pass

    async def feed_audio(self, chunk: bytes) -> None:
        # The fake converts a test binary frame into a finalized ASR clause.
        text = chunk.decode("utf-8")
        await self.queue.put(ASRTranscript(text, "ar", True, "test", 1))
        await self.queue.put(ASRTranscript("", "ar", True, "test", 2, ends_utterance=True))

    async def transcripts(self) -> AsyncIterator[ASRTranscript]:
        while (event := await self.queue.get()) is not None:
            yield event

    async def close(self) -> None:
        await self.queue.put(None)


class FrameTranslator:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def translate_to_all(
        self, text: str, source_lang: str, targets: list[str]
    ) -> dict[str, str]:
        self.calls.append(text)
        return {"en": "Translated sermon"}


def _read_until(socket, message_type: str) -> dict:
    for _ in range(5):
        message = socket.receive_json()
        if message["type"] == message_type:
            return message
    raise AssertionError(f"No {message_type} message arrived")


def test_rest_speaker_asr_translation_viewer_and_manual_override(monkeypatch) -> None:
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(redis_client, "_client", redis)
    monkeypatch.setattr(main, "init_redis", lambda: redis)

    async def noop_close() -> None:
        await redis.aclose()

    monkeypatch.setattr(main, "close_redis", noop_close)
    monkeypatch.setattr(settings, "speechmatics_api_key", "test-key")
    monkeypatch.setattr(settings, "deepl_api_key", "test-key")
    translator = FrameTranslator()
    monkeypatch.setattr(pipeline, "SpeechmaticsASR", FrameASR)
    monkeypatch.setattr(pipeline, "_build_router", lambda: translator)

    with TestClient(main.app) as client:
        response = client.post(
            "/api/sessions", json={"sourceLanguage": "ar", "targetLanguages": ["en"]}
        )
        assert response.status_code == 201
        session_id = response.json()["id"]
        assert response.json()["status"] == "pending"

        with client.websocket_connect(f"/ws/audio/{session_id}") as speaker:
            speaker.send_json(
                {"type": "session.attach", "sessionId": session_id, "role": "speaker"}
            )
            assert speaker.receive_json()["state"] == "live"
            assert client.get(f"/api/sessions/{session_id}").json()["status"] == "live"

            with client.websocket_connect(f"/ws/audio/{session_id}") as duplicate:
                duplicate.send_json(
                    {"type": "session.attach", "sessionId": session_id, "role": "speaker"}
                )
                rejected = duplicate.receive_json()
                assert rejected["state"] == "error"
                assert "already attached" in rejected["error"]

            with client.websocket_connect(f"/ws/captions/{session_id}") as viewer:
                viewer.send_json(
                    {"type": "session.attach", "sessionId": session_id, "role": "viewer"}
                )
                assert _read_until(viewer, "session.state")["state"] == "live"
                speaker.send_bytes("هذا شرح لموضوع الخطبة".encode())
                final = _read_until(viewer, "caption.final")
                assert final["translations"] == {"en": "Translated sermon"}
                assert translator.calls == ["هذا شرح لموضوع الخطبة"]

                with client.websocket_connect(f"/ws/captions/{session_id}") as late_viewer:
                    late_viewer.send_json(
                        {"type": "session.attach", "sessionId": session_id, "role": "viewer"}
                    )
                    assert _read_until(late_viewer, "session.state")["state"] == "live"
                    assert _read_until(late_viewer, "caption.final")["chunkId"] == final["chunkId"]
                    late_viewer.send_json({"type": "session.stop", "sessionId": session_id})

                speaker.send_json(
                    {"type": "session.recitation", "sessionId": session_id, "active": True}
                )
                assert speaker.receive_json() == {
                    "type": "recitation.state",
                    "sessionId": session_id,
                    "active": True,
                }
                assert _read_until(viewer, "recitation.state")["active"] is True
                speaker.send_bytes("قل هو الله أحد".encode())
                assert translator.calls == ["هذا شرح لموضوع الخطبة"]
                viewer.send_json({"type": "session.stop", "sessionId": session_id})

            speaker.send_json({"type": "session.stop", "sessionId": session_id})

        assert client.get(f"/api/sessions/{session_id}").json()["status"] == "ended"
        assert translator.calls == ["هذا شرح لموضوع الخطبة"]

        # Simulate a crashed worker: its Redis record says live, but its
        # short speaker lease is gone. The mosque can reclaim the session.
        stale = Session.model_validate(client.get(f"/api/sessions/{session_id}").json())
        client.portal.call(session_store.save, stale.model_copy(update={"status": "live"}))
        with client.websocket_connect(f"/ws/audio/{session_id}") as recovered:
            recovered.send_json(
                {"type": "session.attach", "sessionId": session_id, "role": "speaker"}
            )
            assert recovered.receive_json()["state"] == "live"
            recovered.send_json({"type": "session.stop", "sessionId": session_id})
        assert client.get(f"/api/sessions/{session_id}").json()["status"] == "ended"
