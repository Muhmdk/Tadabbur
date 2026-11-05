# Tadabbur

Tadabbur helps attendees follow the Arabic portion of a Friday khutbah after
the English portion. A volunteer starts the Arabic session from a browser;
Speechmatics transcribes the speaker, a translation provider translates
completed phrases, and the projector and optional phones receive the same
live captions.

When Quran recitation is identified, the public display shows **“Quran being
read”** without machine translation. The operator can also turn on Quran mode
manually for short or misheard verses. Automatic transcript matching is an aid,
not a guarantee: use Quran mode whenever recitation is expected.

## Requirements

- Python 3.11+
- Node.js 20 or 22
- Redis 7, locally or through Docker
- Speechmatics API key
- DeepL API key or Google Cloud Translate service account

## Local Setup

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Add `SPEECHMATICS_API_KEY` and either `DEEPL_API_KEY` or
`GOOGLE_APPLICATION_CREDENTIALS` to `backend/.env`. A live session cannot start
without speech recognition and a translation provider.

Install dependencies (from the repository root):

```bash
# Backend
cd backend
python -m venv .venv
.venv/bin/python -m pip install -e .   # macOS / Linux
# .venv\Scripts\python.exe -m pip install -e .   # Windows PowerShell

# Frontend
cd ../frontend
npm ci
```

Run Redis:

```bash
docker compose up -d redis
```

Run the backend and frontend in separate terminals:

```bash
cd backend
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
# Windows: .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). During the English part of
the khutbah, prepare the projector and attendee link. Start Arabic translation
when the Arabic portion begins. Turn on Quran mode before expected recitation;
turn it off when ordinary Arabic speech resumes. End the session when the
khutbah finishes.

## Architecture

```text
Browser microphone
  -> FastAPI speaker WebSocket
  -> Speechmatics streaming ASR
  -> clause assembly
  -> Quran matching / operator Quran mode
  -> DeepL translation (Google fallback when configured)
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
- The Quran matcher uses the [Tanzil Project](https://tanzil.net/) Simple Clean
  Arabic text as a reference. Its source license and copyright notice are
  included with the corpus. A transcript can miss or alter a verse, especially
  when it is short, so an operator should use Quran mode for known recitation.
- Hadith identification and approved published translations are not yet
  available. The existing candidate flag suppresses machine translation if a
  future detector marks such content.
- This is a working development prototype, not a production deployment.
- See [`AGENTS.md`](./AGENTS.md) for engineering rules and
  [`BACKLOG.md`](./BACKLOG.md) for deferred product work.

## Local scripted simulation

The **Simulate live demo** link opens a shared projector fixture. It starts on
demand in the simulation backend and keeps running without an operator tab.
When opened through an HTTPS tunnel, the phone link uses that public address.
The frontend proxies both the API and caption WebSockets to the backend.

This mode exercises the real REST API, clause assembly, Quran detection, session
controls, and WebSocket fan-out using scripted Arabic/English and the existing
in-memory test Redis implementation. It makes no paid provider calls and does
not capture microphone audio. The script repeats until **End simulation**.
Simulation banners identify the content on every screen. Session state resets
when this backend stops. Ordinary startup remains provider-backed.

In PowerShell, start the backend:

```powershell
cd C:/Users/jasim/Tadabbur/backend
$env:ALLOWED_ORIGINS='http://localhost:3000,http://127.0.0.1:3000,http://192.168.86.99:3000'
./.venv/Scripts/python.exe -m uvicorn simulate:app --host 0.0.0.0 --port 8000
```

Start the frontend in another terminal:

```powershell
cd C:/Users/jasim/Tadabbur/frontend
$env:NEXT_PUBLIC_SIMULATION='1'
$env:NEXT_PUBLIC_JOIN_BASE_URL='http://192.168.86.99:3000'
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Open the control screen, select **Prepare session**, open the audience links,
and select **Start simulation**. A phone on the same Wi-Fi can use the QR code.
Replace the LAN address above if the computer's network address changes.
The script includes a Quran passage to demonstrate suppression, and manual
Quran mode also works. The fixture is illustrative prose, not an actual sermon.

Verify the scripted provider with:

```powershell
cd C:/Users/jasim/Tadabbur/backend
./.venv/Scripts/python.exe simulate.py --check
```
