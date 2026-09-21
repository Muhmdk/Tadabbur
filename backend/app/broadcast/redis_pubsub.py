"""Redis pub/sub fan-out.

One channel per session: `tadabbur:session:{session_id}:captions`. Producers
are the pipeline (one per session). Consumers are viewer WebSockets (many per
session). This is the cheap side — see CLAUDE.md §2.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from pydantic import Field, TypeAdapter

from app.models.contract import (
    ServerCaptionFinal,
    ServerCaptionPartial,
    ServerMessage,
    ServerRecitationState,
    ServerSessionState,
)
from app.redis_client import get_redis

# ServerMessage is a union; parse incoming JSON back to the right variant by
# its `type` discriminator instead of trying each member.
_MESSAGE_ADAPTER: TypeAdapter[ServerMessage] = TypeAdapter(
    Annotated[ServerMessage, Field(discriminator="type")]
)
_REPLAY_TTL_SECONDS = 12 * 60 * 60


def _channel(session_id: str) -> str:
    return f"tadabbur:session:{session_id}:captions"


def _replay_key(session_id: str, kind: str) -> str:
    return f"tadabbur:session:{session_id}:latest:{kind}"


async def publish(session_id: str, message: ServerMessage) -> None:
    """Publish and retain enough context for viewers arriving mid-sermon."""
    redis = get_redis()
    payload = message.model_dump_json()
    async with redis.pipeline(transaction=True) as pipe:
        if isinstance(message, ServerSessionState):
            pipe.set(_replay_key(session_id, "state"), payload, ex=_REPLAY_TTL_SECONDS)
            if message.state in ("ended", "error"):
                pipe.delete(
                    _replay_key(session_id, "recitation"),
                    _replay_key(session_id, "caption"),
                )
        elif isinstance(message, ServerRecitationState):
            pipe.set(_replay_key(session_id, "recitation"), payload, ex=_REPLAY_TTL_SECONDS)
            pipe.delete(_replay_key(session_id, "caption"))
        elif isinstance(message, (ServerCaptionPartial, ServerCaptionFinal)):
            pipe.set(_replay_key(session_id, "caption"), payload, ex=_REPLAY_TTL_SECONDS)
        pipe.publish(_channel(session_id), payload)
        await pipe.execute()


async def subscribe(session_id: str) -> AsyncIterator[ServerMessage]:
    """Subscribe to a session's channel. Yields parsed ServerMessage frames.

    The pubsub connection and subscription are torn down when the caller stops
    iterating (e.g. the viewer WebSocket disconnects).
    """
    pubsub = get_redis().pubsub(ignore_subscribe_messages=True)
    channel = _channel(session_id)
    await pubsub.subscribe(channel)
    try:
        state, recitation, caption = await get_redis().mget(
            [
                _replay_key(session_id, "state"),
                _replay_key(session_id, "recitation"),
                _replay_key(session_id, "caption"),
            ]
        )
        session_state = ServerSessionState.model_validate_json(state) if state is not None else None
        if session_state is not None:
            yield session_state
        if session_state is not None and session_state.state in ("ended", "error"):
            return
        recitation_state = (
            ServerRecitationState.model_validate_json(recitation)
            if recitation is not None
            else None
        )
        if recitation_state is not None:
            yield recitation_state
        if caption is not None and not (recitation_state and recitation_state.active):
            yield _MESSAGE_ADAPTER.validate_json(caption)
        async for message in pubsub.listen():
            if message is None or message.get("type") != "message":
                continue
            yield _MESSAGE_ADAPTER.validate_json(message["data"])
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
