# frontend

Next.js (App Router) UI for Tadabbur. Three surfaces:

- **Control screen** (`/`) — prepare and share a session during the English khutbah, then start Arabic translation and control Quran mode.
- **Projector display** (`/display/[sessionId]`) — large final captions and recitation notices.
- **Attendee view** (`/join/[sessionId]`) — phone-sized final captions.

See root `CLAUDE.md` for the bigger picture.

## Run

```bash
npm install
npm run dev
```

Open the control page at `http://localhost:3000` on the operator computer. To
let phones join on the same Wi-Fi, open it through the computer's LAN address,
such as `http://192.168.1.50:3000`, and share the generated link. With no
frontend environment overrides, the browser uses that same host on port 8000
for the backend. The browser may require HTTPS before it allows microphone
access from a non-localhost address. A production HTTPS site needs
`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_WS_BASE_URL` pointed at its
reachable secure backend, or a reverse proxy for same-origin `/api` and
`/ws`. See `.env.example`.

Run `npm test`, `npm run typecheck`, and `npm run build` before release.

## Layout

```
app/
  layout.tsx              Root layout (html/body, globals.css)
  (control)/page.tsx      Control screen
  (display)/
    layout.tsx            Full-screen layout for projector
    display/[sessionId]/page.tsx
components/
  CaptionRenderer.tsx     Shared public rendering and Quran suppression
lib/
  endpoints.ts            Browser-aware API, WebSocket, and join URLs
  ws-client.ts            Typed WebSocket client (shared contract)
types/
  contract.ts             Re-exports shared/contract for path stability
```

## Rules

- **Contract:** all wire types come from `shared/contract` via `@contract` (see `tsconfig.json`). Never invent message shapes locally.
- **RTL:** any element rendering Arabic must set `dir="rtl"` and use a font with proper Arabic glyph coverage. Latin and Arabic must NOT share the same `dir` block.
- See root `CLAUDE.md` §4 (contract is sacred) and §6 (conventions).
