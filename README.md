# Tadabbur

Tadabbur provides real-time Arabic sermon transcription and translation. Audio
from a speaker's browser is transcribed by Speechmatics, translated by DeepL,
and broadcast to projector and read-only mobile viewers.

## Requirements

- Python 3.11+
- Node.js 20 or 22
- Redis 7, locally or through Docker
- Speechmatics API key
- DeepL API key

## Local Setup

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Add `SPEECHMATICS_API_KEY` and `DEEPL_API_KEY` to `backend/.env`.

Install dependencies:

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .

# Frontend
cd ../frontend
npm install
```

Run Redis:

```bash
docker compose up -d redis
```

Run the backend and frontend in separate terminals:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), start the microphone, and
speak Arabic. The control screen shows live Arabic and English captions.

## Architecture

```text
Browser microphone
  -> FastAPI speaker WebSocket
  -> Speechmatics streaming ASR
  -> clause assembly
  -> DeepL translation
  -> Redis pub/sub
  -> projector and mobile viewer WebSockets
```

Each session uses one ASR and translation pipeline. Redis fans the resulting
captions out to any number of read-only viewers.

The browser sends 16 kHz mono signed 16-bit PCM in 40 ms frames. The shared
wire contract is defined in `shared/contract/index.ts` and mirrored by the
backend Pydantic models.

## Repository

```text
backend/   FastAPI API, WebSockets, Redis, ASR and translation pipeline
frontend/  Next.js control screen, projector display and mobile viewer
shared/    REST and WebSocket contract shared by both applications
```

Important paths:

- `/` - session control and microphone
- `/display/{sessionId}` - projector display
- `/join/{sessionId}` - read-only attendee viewer
- `/health` - backend health check

## Phone Testing

The laptop and phone must use the same Wi-Fi network. Configure
`frontend/.env.local` with the laptop's LAN address and include the LAN frontend
origin in `backend/.env`:

```env
# frontend/.env.local
NEXT_PUBLIC_API_BASE_URL=http://192.168.1.20:8000
NEXT_PUBLIC_WS_BASE_URL=ws://192.168.1.20:8000
NEXT_PUBLIC_JOIN_BASE_URL=http://192.168.1.20:3000

# backend/.env
ALLOWED_ORIGINS=http://localhost:3000,http://192.168.1.20:3000
```

Start FastAPI with `--host 0.0.0.0` and Next.js with
`npm run dev -- --hostname 0.0.0.0`, then scan the QR code shown on the control
screen. No attendee account, app installation, or personal information is
required.

## Notes

- API keys and `.env` files must never be committed.
- Quranic verses and hadith must not rely on machine translation. Candidate
  content is suppressed until verified source matching and published
  translations are integrated.
- This is a working development prototype, not a production deployment.
- See [`AGENTS.md`](./AGENTS.md) for engineering rules and
  [`BACKLOG.md`](./BACKLOG.md) for deferred product work.
