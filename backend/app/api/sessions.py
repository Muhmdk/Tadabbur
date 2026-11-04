"""Session REST endpoints.

Sessions are created by the control screen before the speaker starts. The
WebSocket layer attaches to an existing session by id. There is deliberately no
endpoint that lists sessions: ids are only shared by the mosque that made them.
"""

import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.models.contract import CreateSessionRequest, CreateSessionResponse, Session
from app.store import sessions as session_store

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=CreateSessionResponse, status_code=201)
async def create_session(body: CreateSessionRequest) -> CreateSessionResponse:
    if body.sourceLanguage != "ar" or body.targetLanguages != ["en"]:
        raise HTTPException(
            status_code=422,
            detail="This deployment currently supports Arabic audio with English captions.",
        )
    if not settings.speechmatics_api_key:
        raise HTTPException(status_code=503, detail="Speech transcription is not configured.")
    if not (settings.deepl_api_key or settings.google_application_credentials):
        raise HTTPException(status_code=503, detail="Translation is not configured.")
    session = Session(
        id=uuid.uuid4().hex,
        sourceLanguage=body.sourceLanguage,
        targetLanguages=body.targetLanguages,
        status="pending",
        createdAt=datetime.now(UTC).isoformat(),
    )
    operator_token = secrets.token_urlsafe(32)
    await session_store.create(session, operator_token)
    return CreateSessionResponse(**session.model_dump(), operatorToken=operator_token)


@router.get("/{session_id}", response_model=Session)
async def get_session(session_id: str) -> Session:
    session = await session_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session
