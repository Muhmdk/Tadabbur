"""Session persistence in Redis.

The session is the unit everything else hangs off: the speaker attaches to
`/ws/audio/{id}`, viewers to `/ws/captions/{id}`, and the Redis fan-out
channel is named per session. Records carry a TTL so abandoned sessions
self-clean during the quiet week between Friday bursts.
"""

from app.models.contract import Session
from app.redis_client import get_redis

# Session record: a string key holding the JSON-serialized Session.
_RECORD_KEY = "tadabbur:session:{id}"
# Index of all known session ids, so listing avoids a keyspace SCAN.
_INDEX_KEY = "tadabbur:sessions"
# Sermons run a few hours; 12h covers setup-to-teardown with margin.
_TTL_SECONDS = 12 * 60 * 60


def _record_key(session_id: str) -> str:
    return _RECORD_KEY.format(id=session_id)


async def save(session: Session) -> None:
    """Persist a session and add it to the index. Atomic via MULTI/EXEC."""
    redis = get_redis()
    async with redis.pipeline(transaction=True) as pipe:
        pipe.set(_record_key(session.id), session.model_dump_json(), ex=_TTL_SECONDS)
        pipe.sadd(_INDEX_KEY, session.id)
        await pipe.execute()


async def get(session_id: str) -> Session | None:
    """Load a session by id, or None if it doesn't exist / has expired."""
    raw = await get_redis().get(_record_key(session_id))
    if raw is None:
        return None
    return Session.model_validate_json(raw)


async def list_all() -> list[Session]:
    """Return every live session. Ids whose records expired are pruned."""
    redis = get_redis()
    ids = list(await redis.smembers(_INDEX_KEY))
    if not ids:
        return []

    raws = await redis.mget([_record_key(i) for i in ids])
    sessions: list[Session] = []
    expired: list[str] = []
    for session_id, raw in zip(ids, raws, strict=True):
        if raw is None:
            expired.append(session_id)
        else:
            sessions.append(Session.model_validate_json(raw))

    if expired:
        await redis.srem(_INDEX_KEY, *expired)
    return sessions
