"""Shared Redis client.

Owns the single async Redis connection (pool) for this worker. Both the
session store and the pub/sub fan-out talk to Redis through here, so the
connection lifecycle lives in one place — opened in the app lifespan, closed
on shutdown.
"""

import redis.asyncio as redis

from app.config import settings

_client: redis.Redis | None = None


def init_redis() -> redis.Redis:
    """Create the shared client. Call once from the app lifespan."""
    global _client
    _client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def get_redis() -> redis.Redis:
    """Return the shared client. Raises if the lifespan hasn't initialized it."""
    if _client is None:
        raise RuntimeError("Redis client not initialized; is the app lifespan running?")
    return _client


async def close_redis() -> None:
    """Close the shared client and its connection pool."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
