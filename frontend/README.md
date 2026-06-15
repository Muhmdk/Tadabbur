# frontend

Next.js (App Router) UI for Tadabbur. Two surfaces:

- **Projector display** (`/display/[sessionId]`) — full-screen, big type, RTL Arabic source + LTR translation.
- **Control screen** (`/`) — session setup, language selection, start/stop.

See root `CLAUDE.md` for the bigger picture.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Layout

```
app/
  layout.tsx              Root layout (html/body, globals.css)
  (control)/page.tsx      Control screen
  (display)/
    layout.tsx            Full-screen layout for projector
    display/[sessionId]/page.tsx
components/
  CaptionRenderer.tsx     RTL source + LTR translation rendering
lib/
  ws-client.ts            Typed WebSocket client (shared contract)
types/
  contract.ts             Re-exports shared/contract for path stability
```

## Rules

- **Contract:** all wire types come from `shared/contract` via `@contract` (see `tsconfig.json`). Never invent message shapes locally.
- **RTL:** any element rendering Arabic must set `dir="rtl"` and use a font with proper Arabic glyph coverage. Latin and Arabic must NOT share the same `dir` block.
- See root `CLAUDE.md` §4 (contract is sacred) and §6 (conventions).
