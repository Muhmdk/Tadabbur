"""Server → viewer WebSocket. Subscribes the client to the session's Redis
channel and streams ServerMessage frames.

Viewers are read-only. Fan-out is unbounded — this is the cheap side of the
pipeline (see CLAUDE.md §2).
"""

import asyncio

from fastapi import WebSocket, WebSocketDisconnect

from app.broadcast import redis_pubsub
from app.models.contract import ClientStop
from app.store import sessions as session_store
from app.ws.attach import parse_client_message, read_attach, reject


async def handler(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        attach = await read_attach(websocket, session_id, "viewer")
        if attach is None:
            return  # read_attach already sent an error and closed the socket

        if await session_store.get(session_id) is None:
            await reject(websocket, session_id, "unknown session")
            return

        await _stream(websocket, session_id)
    except WebSocketDisconnect:
        return  # subscription teardown happens in _stream's finally


async def _stream(websocket: WebSocket, session_id: str) -> None:
    """Forward captions until the viewer leaves, then tear both sides down."""
    forward = asyncio.create_task(_forward(websocket, session_id))
    watch = asyncio.create_task(_watch_client(websocket))
    try:
        await asyncio.wait({forward, watch}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        forward.cancel()
        watch.cancel()
        # Cancelling `forward` closes the subscribe() generator, which
        # unsubscribes and releases the Redis connection in its finally.
        await asyncio.gather(forward, watch, return_exceptions=True)


async def _forward(websocket: WebSocket, session_id: str) -> None:
    async for message in redis_pubsub.subscribe(session_id):
        await websocket.send_text(message.model_dump_json())


async def _watch_client(websocket: WebSocket) -> None:
    # Viewers are read-only; we read only to notice a disconnect or an explicit
    # session.stop, which ends this viewer's stream.
    while True:
        raw = await websocket.receive_text()
        if isinstance(parse_client_message(raw), ClientStop):
            return
