/**
 * Control screen. Mosque staff create a session here, choose target
 * languages, and start the speaker stream.
 *
 * TODO: list existing sessions (GET /api/sessions), POST a new one, link to
 * /display/[id] for the projector and to a speaker-attach view.
 */

export default function ControlPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Tadabbur — control</h1>
      <p className="mt-2 text-sm text-white/60">
        Session setup will live here. See <code>CLAUDE.md</code> for scope.
      </p>
    </main>
  );
}
