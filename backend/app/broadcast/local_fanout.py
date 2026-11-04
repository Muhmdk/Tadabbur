"""Per-worker fan-out: one Redis subscription per session, shared by local viewers.

A Redis pub/sub subscriber holds its own connection, so subscribing once per
viewer would need one Redis connection per phone (100 mosques x 100 phones hits
Redis's default 10,000-client limit). Instead each worker subscribes once per
session it serves and copies every message into its viewers' in-memory queues.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from redis.asyncio.client import PubSub

from app.redis_client import get_redis

logger = logging.getLogger(__name__)

# Messages buffered per viewer. A viewer that falls this far behind (a stalled
# phone) is disconnected; it reconnects and resumes from the replay keys.
VIEWER_BUFFER = 256
CLOSED = object()  # queued to a viewer whose feed has stopped


@dataclass
class _Feed:
    pubsub: PubSub
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    reader: asyncio.Task[None] | None = None
    listeners: set[asyncio.Queue[Any]] = field(default_factory=set)


# All access happens on the worker's event loop; the `ready` event lets viewers
# that join while the subscription is being set up wait for it instead of
# subscribing a second time.
_feeds: dict[str, _Feed] = {}
_closing: set[asyncio.Task[None]] = set()


def subscription_count() -> int:
    """Redis subscriptions this worker holds (one per session with viewers here)."""
    return len(_feeds)


def _close_listener(queue: asyncio.Queue[Any]) -> None:
    while not queue.empty():
        queue.get_nowait()
    queue.put_nowait(CLOSED)


async def _read(channel: str, feed: _Feed) -> None:
    try:
        async for message in feed.pubsub.listen():
            if message is None or message.get("type") != "message":
                continue
            for queue in list(feed.listeners):
                try:
                    queue.put_nowait(message["data"])
                except asyncio.QueueFull:
                    logger.warning("dropping a viewer that fell behind on %s", channel)
                    feed.listeners.discard(queue)
                    _close_listener(queue)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.error("caption subscription failed (%s)", type(exc).__name__)
    # The subscription ended: viewers reconnect and get a fresh one.
    if _feeds.get(channel) is feed:
        del _feeds[channel]
    for queue in list(feed.listeners):
        _close_listener(queue)
    feed.listeners.clear()
    try:
        await feed.pubsub.aclose()
    except Exception as exc:
        logger.warning("closing a failed caption subscription failed (%s)", type(exc).__name__)


async def join(channel: str) -> asyncio.Queue[Any]:
    """Register a local viewer on `channel`, subscribing to Redis if needed.

    The returned queue receives raw message payloads, then `CLOSED` if the
    feed stops. The subscription is active once this returns.
    """
    queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=VIEWER_BUFFER)
    feed = _feeds.get(channel)
    if feed is None:
        feed = _Feed(pubsub=get_redis().pubsub(ignore_subscribe_messages=True))
        _feeds[channel] = feed
        try:
            await feed.pubsub.subscribe(channel)
        except BaseException:
            del _feeds[channel]
            feed.ready.set()
            await feed.pubsub.aclose()
            raise
        feed.reader = asyncio.create_task(_read(channel, feed))
        feed.ready.set()
    else:
        await feed.ready.wait()
        if feed.reader is None:  # its setup failed; start over
            return await join(channel)
    feed.listeners.add(queue)
    return queue


def leave(channel: str, queue: asyncio.Queue[Any]) -> None:
    """Unregister a viewer; drop the Redis subscription with the last one.

    Synchronous, so a viewer's teardown cannot be interrupted halfway; the
    Redis unsubscribe runs in the background.
    """
    feed = _feeds.get(channel)
    if feed is None or queue not in feed.listeners:
        return
    feed.listeners.discard(queue)
    if feed.listeners:
        return
    del _feeds[channel]
    task = asyncio.create_task(_shut_down(channel, feed))
    _closing.add(task)
    task.add_done_callback(_closing.discard)


async def _shut_down(channel: str, feed: _Feed) -> None:
    if feed.reader is not None:
        feed.reader.cancel()
        await asyncio.wait([feed.reader])
    try:
        await feed.pubsub.unsubscribe(channel)
    except Exception as exc:
        logger.warning("caption unsubscribe failed (%s)", type(exc).__name__)
    finally:
        await feed.pubsub.aclose()


async def drain() -> None:
    """Finish background unsubscribes; call on shutdown."""
    if _closing:
        await asyncio.wait(set(_closing))
