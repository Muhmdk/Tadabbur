"""Session persistence in Redis.

The session is the unit everything else hangs off: the speaker attaches to
`/ws/audio/{id}`, viewers to `/ws/captions/{id}`, and the Redis fan-out
channel is named per session. Records carry a TTL so abandoned sessions
self-clean during the quiet week between Friday bursts.

Each session also has an operator token. The session id is public (it is in
the projector URL and the attendee QR code), so only the token lets a device
attach as the speaker. Only its SHA-256 digest is stored.
"""

import hashlib
import hmac

from app.models.contract import Session
from app.redis_client import get_redis

# Session record: a string key holding the JSON-serialized Session.
_RECORD_KEY = "tadabbur:session:{id}"
_OPERATOR_KEY = "tadabbur:session:{id}:operator"
# Sermons run a few hours; 12h covers setup-to-teardown with margin.
_TTL_SECONDS = 12 * 60 * 60


def _record_key(session_id: str) -> str:
    return _RECORD_KEY.format(id=session_id)


def _operator_key(session_id: str) -> str:
    return _OPERATOR_KEY.format(id=session_id)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create(session: Session, operator_token: str) -> None:
    """Persist a new session with its operator token. Atomic via MULTI/EXEC."""
    async with get_redis().pipeline(transaction=True) as pipe:
        pipe.set(_record_key(session.id), session.model_dump_json(), ex=_TTL_SECONDS)
        pipe.set(_operator_key(session.id), _digest(operator_token), ex=_TTL_SECONDS)
        await pipe.execute()


async def save(session: Session) -> None:
    """Update a session record, keeping its operator token alive as long."""
    async with get_redis().pipeline(transaction=True) as pipe:
        pipe.set(_record_key(session.id), session.model_dump_json(), ex=_TTL_SECONDS)
        pipe.expire(_operator_key(session.id), _TTL_SECONDS)
        await pipe.execute()


async def get(session_id: str) -> Session | None:
    """Load a session by id, or None if it doesn't exist / has expired."""
    raw = await get_redis().get(_record_key(session_id))
    if raw is None:
        return None
    return Session.model_validate_json(raw)


async def is_operator(session_id: str, token: str | None) -> bool:
    """Whether `token` is this session's operator token (constant-time compare)."""
    if not token:
        return False
    stored = await get_redis().get(_operator_key(session_id))
    return stored is not None and hmac.compare_digest(stored, _digest(token))
