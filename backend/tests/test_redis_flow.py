"""Verify fan-out replay and cross-worker ownership against in-memory Redis."""

import fakeredis.aioredis
import pytest

from app import redis_client
from app.broadcast import redis_pubsub
from app.models.contract import (
    ServerCaptionFinal,
    ServerRecitationState,
    ServerSessionState,
)
from app.store import speakers


@pytest.fixture
async def fake_redis(monkeypatch):
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(redis_client, "_client", client)
    yield client
    await client.aclose()


@pytest.mark.asyncio
async def test_late_viewer_gets_live_state_and_latest_caption(fake_redis) -> None:
    await redis_pubsub.publish(
        "s1", ServerSessionState(type="session.state", sessionId="s1", state="live")
    )
    await redis_pubsub.publish(
        "s1",
        ServerCaptionFinal(
            type="caption.final",
            sessionId="s1",
            chunkId="c1",
            source="هذا كلام الخطبة",
            sourceLang="ar",
            translations={"en": "Sermon words"},
            timestamp=1,
        ),
    )
    stream = redis_pubsub.subscribe("s1")
    try:
        assert (await anext(stream)).state == "live"
        latest = await anext(stream)
        assert isinstance(latest, ServerCaptionFinal)
        assert latest.translations["en"] == "Sermon words"
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_recitation_mode_clears_replay_of_previous_sermon(fake_redis) -> None:
    await redis_pubsub.publish(
        "s1",
        ServerCaptionFinal(
            type="caption.final",
            sessionId="s1",
            chunkId="c1",
            source="old sermon",
            sourceLang="ar",
            translations={"en": "Old sermon"},
            timestamp=1,
        ),
    )
    await redis_pubsub.publish(
        "s1", ServerRecitationState(type="recitation.state", sessionId="s1", active=True)
    )
    assert await fake_redis.get("tadabbur:session:s1:latest:caption") is None
    stream = redis_pubsub.subscribe("s1")
    try:
        replay = await anext(stream)
        assert isinstance(replay, ServerRecitationState)
        assert replay.active is True
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_ended_session_never_replays_a_live_caption(fake_redis) -> None:
    await redis_pubsub.publish(
        "s1",
        ServerCaptionFinal(
            type="caption.final",
            sessionId="s1",
            chunkId="c1",
            source="old sermon",
            sourceLang="ar",
            translations={"en": "Old sermon"},
            timestamp=1,
        ),
    )
    await redis_pubsub.publish(
        "s1", ServerSessionState(type="session.state", sessionId="s1", state="ended")
    )
    assert await fake_redis.get("tadabbur:session:s1:latest:caption") is None
    stream = redis_pubsub.subscribe("s1")
    try:
        assert (await anext(stream)).state == "ended"
        with pytest.raises(StopAsyncIteration):
            await anext(stream)
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_only_lease_owner_can_renew_or_release(fake_redis) -> None:
    owner = await speakers.acquire("s1")
    assert owner is not None
    assert await speakers.acquire("s1") is None
    assert not await speakers.renew("s1", "someone-else")
    await speakers.release("s1", "someone-else")
    assert await speakers.acquire("s1") is None
    assert await speakers.renew("s1", owner)
    await speakers.release("s1", owner)
    assert await speakers.acquire("s1") is not None
