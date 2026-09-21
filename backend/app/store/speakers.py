"""A short Redis lease prevents two workers from owning one speaker stream."""

import uuid

from app.redis_client import get_redis

_LEASE_SECONDS = 30
_KEY = "tadabbur:session:{id}:speaker"
_RENEW = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
"""
_RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


def _key(session_id: str) -> str:
    return _KEY.format(id=session_id)


async def acquire(session_id: str) -> str | None:
    token = uuid.uuid4().hex
    claimed = await get_redis().set(_key(session_id), token, ex=_LEASE_SECONDS, nx=True)
    return token if claimed else None


async def renew(session_id: str, token: str) -> bool:
    result = await get_redis().eval(_RENEW, 1, _key(session_id), token, _LEASE_SECONDS)
    return bool(result)


async def release(session_id: str, token: str) -> None:
    await get_redis().eval(_RELEASE, 1, _key(session_id), token)
