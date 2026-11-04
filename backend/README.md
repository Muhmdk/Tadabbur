# backend

FastAPI gateway for Tadabbur. Owns audio ingestion, ASR/translation orchestration, and Redis fan-out. See root `CLAUDE.md` for the bigger picture.

## Run

```bash
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Redis must be running. From repo root: `docker compose up -d redis`.

Session creation currently accepts Arabic speech with English captions. Set a
Speechmatics key and either a DeepL key or a Google Cloud service-account JSON
path before starting a session. DeepL is tried first; Google is the fallback.
If both fail, viewers receive an error instead of an untranslated caption.

## Quran protection

The detector compares normalized ASR output with the locally bundled,
**verbatim** Tanzil Quran Text (Simple Clean, version 1.1). Source:
<https://tanzil.net/pub/download/index.php?quranType=simple-clean&outType=txt-2&agree=true>.
Its copyright and CC BY 3.0 terms are included at the end of
`app/pipeline/quran-simple-clean.txt`; source and updates are at
<https://tanzil.net/>. SHA-256 of the downloaded file:
`228df2a717671aeb9d2ff573002bd28d6b3f973f4bc7153554e3a81663d67610`.

Translation and Arabic display are suppressed when a clause matches six
consecutive corpus words, a complete short ayah of three to five words (alone or
after a Quran introduction), the continuation of the previous Quran clause (so
the end of a long ayah that arrives after a pause or the word cap is caught),
or mostly lines up in order with one passage despite ASR mistakes. The operator
can also switch Quran mode on manually. Transcript matching cannot identify every
recitation: very short fragments, alternate wording, and ASR errors can be
missed. Operators should use Quran mode whenever recitation begins.

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
