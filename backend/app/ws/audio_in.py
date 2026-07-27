"""Speaker → server WebSocket. Receives one `session.attach` JSON frame, then
raw binary audio chunks. Chunks are forwarded to the session's ASR stream.

Only one speaker may be attached to a session at a time.
"""

from fastapi import WebSocket, WebSocketDisconnect

from app.models.contract import ClientStop
from app.pipeline import session as session_pipeline
from app.store import sessions as session_store
from app.ws.attach import parse_client_message, read_attach, reject


async def handler(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    opened = False
    try:
        attach = await read_attach(websocket, session_id, "speaker")
        if attach is None:
            return  # read_attach already sent an error and closed the socket

        session = await session_store.get(session_id)
        if session is None:
            await reject(websocket, session_id, "unknown session")
            return
        if session_pipeline.has_runtime(session_id):
            await reject(websocket, session_id, "a speaker is already attached")
            return

        try:
            runtime = await session_pipeline.open_session(session)
        except Exception as exc:  # ASR failed to start — tell the speaker why
            await reject(websocket, session_id, f"failed to start transcription: {exc}")
            return
        opened = True

        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if (data := msg.get("bytes")) is not None:
                await runtime.asr.feed_audio(data)
            elif (text := msg.get("text")) is not None and isinstance(
                parse_client_message(text), ClientStop
            ):
                break
    except WebSocketDisconnect:
        pass
    finally:
        if opened:
            await session_pipeline.close_session(session_id)
