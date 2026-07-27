"""Session REST endpoints.

Sessions are created by the control screen before the speaker starts. The
WebSocket layer attaches to an existing session by id.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from app.models.contract import CreateSessionRequest, Session
from app.store import sessions as session_store

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=Session, status_code=201)
async def create_session(body: CreateSessionRequest) -> Session:
    session = Session(
        id=uuid.uuid4().hex,
        sourceLanguage=body.sourceLanguage,
        targetLanguages=body.targetLanguages,
        status="pending",
        createdAt=datetime.now(UTC).isoformat(),
    )
    await session_store.save(session)
    # TODO: pre-connect ASR here so the speaker has zero cold-start latency on
    # the first audio frame (see CLAUDE.md §2).
    return session


@router.get("/{session_id}", response_model=Session)
async def get_session(session_id: str) -> Session:
    session = await session_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.get("", response_model=list[Session])
async def list_sessions() -> list[Session]:
    return await session_store.list_all()
