"""Redis pub/sub fan-out.

One channel per session: `tadabbur:session:{session_id}:captions`. Producers
are the pipeline (one per session). Consumers are viewer WebSockets (many per
session). This is the cheap side — see CLAUDE.md §2.
"""

from collections.abc import AsyncIterator
from typing import Annotated

from pydantic import Field, TypeAdapter

from app.models.contract import ServerMessage
from app.redis_client import get_redis

# ServerMessage is a union; parse incoming JSON back to the right variant by
# its `type` discriminator instead of trying each member.
_MESSAGE_ADAPTER: TypeAdapter[ServerMessage] = TypeAdapter(
    Annotated[ServerMessage, Field(discriminator="type")]
)


def _channel(session_id: str) -> str:
    return f"tadabbur:session:{session_id}:captions"


async def publish(session_id: str, message: ServerMessage) -> None:
    """Serialize and publish a ServerMessage to the session channel."""
    await get_redis().publish(_channel(session_id), message.model_dump_json())


async def subscribe(session_id: str) -> AsyncIterator[ServerMessage]:
    """Subscribe to a session's channel. Yields parsed ServerMessage frames.

    The pubsub connection and subscription are torn down when the caller stops
    iterating (e.g. the viewer WebSocket disconnects).
    """
    pubsub = get_redis().pubsub(ignore_subscribe_messages=True)
    channel = _channel(session_id)
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message is None or message.get("type") != "message":
                continue
            yield _MESSAGE_ADAPTER.validate_json(message["data"])
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
