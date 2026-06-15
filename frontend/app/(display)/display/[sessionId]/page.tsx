/**
 * Projector display. Subscribes to the session caption stream as a viewer and
 * renders the latest source + translation pair full-screen.
 *
 * TODO: wire WSClient from lib/ws-client.ts, drive CaptionRenderer with the
 * latest ServerCaptionFinal (and ServerCaptionPartial for source-side tail).
 */

import CaptionRenderer from "@/components/CaptionRenderer";

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return (
    <div className="flex h-full w-full flex-col items-stretch justify-center gap-12 px-16 py-12">
      {/* TODO: replace with live state from ws-client */}
      <CaptionRenderer
        sessionId={sessionId}
        source=""
        sourceLang="ar"
        translations={{}}
      />
    </div>
  );
}
