"""Speaker → server WebSocket. Receives one `session.attach` JSON frame, then
raw binary audio chunks. Chunks are forwarded to the ASR provider for the
session.

Only one speaker should be attached to a session at a time.
"""

from fastapi import WebSocket, WebSocketDisconnect


async def handler(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        # TODO: parse ClientAttach, validate role == "speaker".
        # TODO: resolve session from Redis; reject if not pending/live.
        # TODO: hand off to pipeline.session.attach_speaker(session_id, websocket).
        while True:
            _ = await websocket.receive()
            # TODO: route binary frames to ASRProvider.feed_audio,
            # JSON frames to session control (e.g. session.stop).
    except WebSocketDisconnect:
        # TODO: notify session manager so the ASR stream can be closed gracefully.
        return
