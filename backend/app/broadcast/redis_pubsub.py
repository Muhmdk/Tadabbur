"""Redis pub/sub fan-out.

One channel per session: `tadabbur:session:{session_id}:captions`. Producers
are the pipeline (one per session). Consumers are viewer WebSockets (many per
session). This is the cheap side — see CLAUDE.md §2.
"""

from collections.abc import AsyncIterator

from app.models.contract import ServerMessage


def _channel(session_id: str) -> str:
    return f"tadabbur:session:{session_id}:captions"


async def publish(session_id: str, message: ServerMessage) -> None:
    """Serialize and publish a ServerMessage to the session channel."""
    # TODO: redis.publish(_channel(session_id), message.model_dump_json())
    raise NotImplementedError


async def subscribe(session_id: str) -> AsyncIterator[ServerMessage]:
    """Subscribe to a session's channel. Yields parsed ServerMessage frames."""
    # TODO: open pubsub, listen on _channel(session_id), parse and yield.
    raise NotImplementedError
    yield  # pragma: no cover  (keeps type as async generator)
