"""Shared WebSocket attach handshake.

Both the speaker (`audio_in`) and viewer (`captions_out`) endpoints open with a
single `session.attach` frame. This module parses client→server frames against
the contract and validates the opening handshake, so neither handler reaches
around the wire format.
"""

from typing import Annotated

from fastapi import WebSocket
from pydantic import Field, TypeAdapter, ValidationError

from app.models.contract import (
    ClientAttach,
    ClientMessage,
    ServerSessionState,
    SpeakerRole,
)

# ClientMessage is a union; route by the `type` discriminator.
_CLIENT_ADAPTER: TypeAdapter[ClientMessage] = TypeAdapter(
    Annotated[ClientMessage, Field(discriminator="type")]
)


def parse_client_message(raw: str) -> ClientMessage | None:
    """Parse a client→server frame, or None if it doesn't match the contract."""
    try:
        return _CLIENT_ADAPTER.validate_json(raw)
    except ValidationError:
        return None


async def read_attach(
    websocket: WebSocket, session_id: str, expected_role: SpeakerRole
) -> ClientAttach | None:
    """Read and validate the opening `session.attach` frame.

    On any problem, send an error `session.state` to the client, close the
    socket, and return None. On success, return the validated ClientAttach.
    """
    raw = await websocket.receive_text()
    msg = parse_client_message(raw)
    if not isinstance(msg, ClientAttach):
        await reject(websocket, session_id, "expected session.attach as the first frame")
        return None
    if msg.role != expected_role:
        await reject(websocket, session_id, f"expected role '{expected_role}'")
        return None
    if msg.sessionId != session_id:
        await reject(websocket, session_id, "sessionId does not match the connection")
        return None
    return msg


async def reject(websocket: WebSocket, session_id: str, error: str) -> None:
    await websocket.send_text(
        ServerSessionState(
            type="session.state", sessionId=session_id, state="error", error=error
        ).model_dump_json()
    )
    await websocket.close()
