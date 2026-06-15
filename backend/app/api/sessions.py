"""Session REST endpoints.

Sessions are created by the control screen before the speaker starts. The
WebSocket layer attaches to an existing session by id.
"""

from fastapi import APIRouter, HTTPException

from app.models.contract import CreateSessionRequest, Session

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=Session, status_code=201)
async def create_session(body: CreateSessionRequest) -> Session:
    # TODO: persist to Redis, return a real session. Pre-connect ASR here so
    # the speaker has zero cold-start latency on first audio frame.
    raise NotImplementedError


@router.get("/{session_id}", response_model=Session)
async def get_session(session_id: str) -> Session:
    # TODO: load from Redis.
    raise HTTPException(status_code=404, detail="not implemented")


@router.get("", response_model=list[Session])
async def list_sessions() -> list[Session]:
    # TODO: scan Redis for active sessions.
    return []
