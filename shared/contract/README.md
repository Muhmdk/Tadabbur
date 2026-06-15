# shared/contract

The wire contract between backend and frontend. **`index.ts` is the source of truth.**

## Keeping Pydantic in sync

The backend mirrors these types as Pydantic models in `backend/app/models/contract.py`. The two files must stay aligned by hand for now (we may codegen later, but not yet — see `CLAUDE.md` §8 on dependencies).

Workflow for a contract change:

1. Edit `index.ts`. Bump `CONTRACT_VERSION` if the change is breaking.
2. Mirror the change in `backend/app/models/contract.py` (and bump the constant there).
3. Update both sides' usage.
4. Reference the contract version in any session-start logs so we can correlate.

If you find yourself adding a field on one side only, stop. See `CLAUDE.md` §4.
