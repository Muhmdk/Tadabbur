"""Speaker WebSocket: one leased ASR owner, PCM audio, and Quran override."""

import asyncio
import time

from fastapi import WebSocket, WebSocketDisconnect

from app.models.contract import (
    ClientRecitationMode,
    ClientStop,
    ServerRecitationState,
    ServerSessionState,
)
from app.pipeline import session as session_pipeline
from app.store import sessions as session_store
from app.store import speakers
from app.ws.attach import parse_client_message, read_attach, reject


async def handler(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    opened = False
    stopped = False  # only an explicit session.stop ends the session
    lease_token: str | None = None
    try:
        attach = await read_attach(websocket, session_id, "speaker")
        if attach is None:
            return  # read_attach already sent an error and closed the socket

        session = await session_store.get(session_id)
        if session is None:
            await reject(websocket, session_id, "unknown session")
            return
        if session.status == "ended":
            await reject(websocket, session_id, "this session has ended")
            return
        if not await session_store.is_operator(session_id, attach.operatorToken):
            await reject(websocket, session_id, "only the operator's device can speak")
            return
        lease_token = await speakers.acquire(session_id)
        if lease_token is None:
            await reject(websocket, session_id, "a speaker is already attached")
            return
        if session_pipeline.has_runtime(session_id):
            await reject(websocket, session_id, "a speaker is already attached")
            return

        try:
            runtime = await session_pipeline.open_session(session, lease_token=lease_token)
        except Exception:  # provider details must not reach public UI
            await reject(websocket, session_id, "failed to start transcription")
            return
        opened = True
        last_renewed = time.monotonic()
        await websocket.send_text(
            ServerSessionState(
                type="session.state", sessionId=session_id, state="live"
            ).model_dump_json()
        )

        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive(), timeout=10)
            except TimeoutError:
                msg = None
            if runtime.failed:
                await reject(websocket, session_id, "live captions stopped; reconnecting")
                break
            if time.monotonic() - last_renewed >= 10:
                if not await speakers.renew(session_id, lease_token):
                    await reject(websocket, session_id, "speaker connection was interrupted")
                    break
                last_renewed = time.monotonic()
            if msg is None:
                continue
            if msg["type"] == "websocket.disconnect":
                break
            if (data := msg.get("bytes")) is not None:
                try:
                    await runtime.asr.feed_audio(data)
                except Exception:
                    await reject(websocket, session_id, "audio connection failed")
                    break
            elif (text := msg.get("text")) is not None:
                command = parse_client_message(text)
                if isinstance(command, ClientStop) and command.sessionId == session_id:
                    stopped = True
                    break
                if isinstance(command, ClientRecitationMode) and command.sessionId == session_id:
                    await session_pipeline.set_recitation_mode(runtime, command.active)
                    await websocket.send_text(
                        ServerRecitationState(
                            type="recitation.state",
                            sessionId=session_id,
                            active=command.active,
                        ).model_dump_json()
                    )
                else:
                    await reject(websocket, session_id, "unsupported speaker command")
                    break
    except WebSocketDisconnect:
        pass
    finally:
        if opened:
            await session_pipeline.close_session(session_id, end=stopped)
        elif lease_token is not None:
            await speakers.release(session_id, lease_token)
