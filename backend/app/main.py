"""FastAPI entrypoint. Registers REST routers and WebSocket endpoints."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, sessions
from app.config import settings
from app.pipeline import quran
from app.pipeline.session import close_all_sessions
from app.redis_client import close_redis, init_redis
from app.ws import audio_in, captions_out


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = init_redis()
    await redis.ping()  # fail fast if Redis is unreachable
    # Build the Quran index now rather than on the first caption of a khutbah.
    await asyncio.to_thread(quran.warm)
    yield
    await close_all_sessions()
    await close_redis()


app = FastAPI(title="Tadabbur", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(sessions.router, prefix="/api")

app.add_api_websocket_route("/ws/audio/{session_id}", audio_in.handler)
app.add_api_websocket_route("/ws/captions/{session_id}", captions_out.handler)
