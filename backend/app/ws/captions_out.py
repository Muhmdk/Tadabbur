"""Server → viewer WebSocket. Subscribes the client to the session's Redis
channel and streams ServerMessage frames.

Viewers are read-only. Fan-out is unbounded — this is the cheap side of the
pipeline (see CLAUDE.md §2).
"""

from fastapi import WebSocket, WebSocketDisconnect


async def handler(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        # TODO: parse ClientAttach, validate role == "viewer".
        # TODO: subscribe via broadcast.redis_pubsub.subscribe(session_id).
        # TODO: forward each ServerMessage as JSON to the websocket.
        while True:
            _ = await websocket.receive_text()
            # Viewers may send `session.stop` but otherwise we expect silence.
    except WebSocketDisconnect:
        # TODO: unsubscribe from Redis channel.
        return
