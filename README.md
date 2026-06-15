# Tadabbur

Real-time translation for Friday sermons. Captures Arabic audio, transcribes and translates it live, and broadcasts captions to a projector display (and optionally to congregants' phones).

For agents and contributors: **read [`CLAUDE.md`](./CLAUDE.md) first.** It defines the architecture, the team split, and the contract rule that keeps the two halves of the codebase in sync.

## Layout

```
backend/   FastAPI gateway, ASR + translation pipeline, Redis fan-out
frontend/  Next.js projector display and control screens
shared/    Wire contract (WebSocket + REST). Source of truth for both sides.
```

## Stack

- **Backend:** Python 3.11+, FastAPI, WebSockets, Redis, Speechmatics (ASR), DeepL / Google (translation).
- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind.
- **Infra (local):** Docker Compose for Redis.

## Quickstart

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

docker compose up -d redis

# Backend
cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

Projector display: `http://localhost:3000/display/<sessionId>`
Control screen: `http://localhost:3000/`

## Status

Scaffolding only. No business logic yet. See `CLAUDE.md` §8 for what is intentionally out of scope.
