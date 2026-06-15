# backend

FastAPI gateway for Tadabbur. Owns audio ingestion, ASR/translation orchestration, and Redis fan-out. See root `CLAUDE.md` for the bigger picture.

## Run

```bash
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Redis must be running. From repo root: `docker compose up -d redis`.

## Layout

```
app/
  main.py            FastAPI entrypoint + route/WS registration
  config.py          Settings (env-backed, Pydantic)
  api/               REST endpoints
  ws/                WebSocket handlers (audio in, captions out)
  pipeline/
    asr/             ASRProvider interface + Speechmatics impl
    translation/     Translator interface + DeepL/Google impls
    session.py       Session lifecycle + pre-connect hooks
  broadcast/         Redis pub/sub fan-out
  models/            Pydantic mirror of shared/contract
tests/               pytest skeleton
```

## Rules

- **Provider abstraction:** never import a vendor SDK outside its provider module. See `CLAUDE.md` §7.
- **Contract sync:** `app/models/contract.py` mirrors `shared/contract/index.ts`. Update both, or you create drift. See `CLAUDE.md` §4.
