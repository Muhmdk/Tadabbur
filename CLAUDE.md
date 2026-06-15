# CLAUDE.md — Tadabbur

> Map for AI agents and humans. Read this first.

## 1. Project overview

Tadabbur is a real-time translation platform for Friday sermons (khutbahs). A sermon is delivered in Arabic; many attendees don't speak Arabic. Tadabbur captures the speaker's audio, transcribes it in real time, translates the transcript into one or more target languages, and broadcasts live captions to a projector display (and optionally to congregants' phones).

**Scale reality:** ~100 mosques, each running ~3–4 hours every Friday. Load is extremely spiky — near-zero all week, ~100 concurrent live streams on Friday. The system is designed for burst autoscaling, not steady-state.

**Optimize for, in order:** latency, transcription/translation quality, developer experience.

## 2. Architecture summary

```
Mosque mic (browser)
  └─ WS audio in ──▶ Backend gateway (FastAPI)
                       ├─ ASR worker     (Speechmatics, streaming)
                       ├─ Translation    (DeepL primary, Google fallback)
                       └─ Redis pub/sub  (fan-out per session)
                                  │
                                  └─ WS captions out ──▶ Projector display
                                                    └─▶ Congregant phones (optional)
```

Core principle: **one ASR stream per session, cheap fan-out via Redis to unlimited viewers.** Transcription is the expensive resource; the display layer is a dumb subscriber.

Workers are stateless; all shared session state lives in Redis so the backend scales horizontally for the Friday burst.

## 3. Repo map

```
backend/   FastAPI + ASR/translation pipeline + Redis broadcast  (Dev A)
frontend/  Next.js projector display + control screens           (Dev B)
shared/    The WS + REST contract — source of truth for both
```

**Hard rule:** backend and frontend communicate **only** through the message and request shapes defined in `shared/contract/`. No backchannels. No "just this once."

## 4. The contract is sacred

`shared/contract/index.ts` is the source of truth for every WebSocket message and REST payload that crosses the network boundary.

Workflow for any change to the wire format:

1. Update `shared/contract/index.ts` first.
2. Update `backend/app/models/contract.py` to mirror the change (Pydantic).
3. Update both sides' usage.
4. Bump `CONTRACT_VERSION` if the change is breaking.

If you find yourself adding a field on one side only, stop — you are creating drift. Drift will break a live mosque on Friday.

## 5. Team boundaries

- **Developer A — Backend:** owns `backend/` end-to-end. Audio ingestion, ASR/translation orchestration, Redis fan-out.
- **Developer B — Frontend:** owns `frontend/` end-to-end. Projector display, caption rendering, session setup UI.

Agents working on one side **must not** modify the other side without going through `shared/contract/`. If a feature requires a contract change, do step 1 of section 4 before touching either side.

## 6. Conventions

**Python (backend)**
- Type hints required. Pydantic models at all boundaries.
- `ruff` for lint + format. No untyped public functions.
- Small modules, single responsibility. Async by default for I/O.

**TypeScript (frontend)**
- `strict: true`. No `any` at module boundaries.
- All WebSocket messages typed against `shared/contract`.
- Tailwind for styling. No CSS modules unless there's a reason.

**Both**
- Keep files short. If a module is doing two things, split it.
- No silent error swallowing. Surface failures.

## 7. Provider abstraction rule

Speechmatics, DeepL, and Google are **implementation details** behind interfaces:

- `backend/app/pipeline/asr/base.py` defines `ASRProvider`.
- `backend/app/pipeline/translation/base.py` defines `Translator`.

Never import a vendor SDK outside its provider module. If you need a feature the interface doesn't expose, extend the interface — don't reach around it. We will swap vendors; this is the seam that makes that cheap.

## 8. What NOT to do (during scaffolding and early build)

- **No auth, billing, analytics, telemetry, multi-tenancy** until explicitly requested.
- **No new dependencies** without a one-line justification in the PR.
- **No business logic during scaffolding** — stubs and TODOs only.
- **No additional languages** beyond what's in the contract until asked.
- **No demo pages, example components, or "just in case" folders.** Lean over complete.

## 9. Domain sensitivity

Quranic verses and prophetic narrations (hadith) **must not** be naively machine-translated. The output is read in a place of worship; a mistranslation of scripture is unacceptable.

For now: treat this as a known gap. When the pipeline detects likely Quranic/hadith content (heuristic TBD), flag it in the caption payload (`isQuranicHadithCandidate`) so the display can render it differently or suppress translation. Later we will integrate established published translations (e.g. Saheeh International, Pickthall). Do not implement detection or substitution during scaffolding — leave the flag in the contract and the stub in the pipeline.

Sermon content is sacred to its audience. Treat it that way in logs, UI copy, and error messages.

## 10. Local dev quickstart

```bash
# 1. Copy env templates
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 2. Start backend + Redis
docker compose up -d redis
cd backend
uv sync                       # or: pip install -e .
uv run uvicorn app.main:app --reload --port 8000

# 3. Start frontend (separate terminal)
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

Required env vars are listed in each `.env.example`. Real keys live in 1Password — never commit them.
