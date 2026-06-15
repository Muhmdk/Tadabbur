"""FastAPI entrypoint. Registers REST routers and WebSocket endpoints.

Lifespan hook is where Redis pools and provider clients should be
initialized — kept as TODO during scaffolding.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, sessions
from app.config import settings
from app.ws import audio_in, captions_out


@asynccontextmanager
async def lifespan(app: FastAPI):
    # TODO: open Redis pool, warm provider clients, register shutdown hooks.
    yield
    # TODO: drain in-flight sessions, close Redis pool.


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
