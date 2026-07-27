"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type {
  Language,
  ServerCaptionFinal,
  ServerMessage,
  Session,
} from "@contract";

import { CaptionStream } from "@/lib/ws-client";

const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const WS_URL =
  process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";

type ViewerState = "connecting" | "waiting" | "live" | "ended" | "error";

export default function MobileViewerPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<Session | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [viewerState, setViewerState] = useState<ViewerState>("connecting");
  const [partial, setPartial] = useState("");
  const [captions, setCaptions] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: CaptionStream | null = null;
    let cancelled = false;

    async function connect() {
      try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionId}`);
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "This session is unavailable."
              : "Could not load this session.",
          );
        }
        const nextSession = (await response.json()) as Session;
        if (cancelled) return;

        setSession(nextSession);
        setLanguage(nextSession.targetLanguages[0] ?? "en");
        stream = new CaptionStream(WS_URL, sessionId, "viewer");
        stream.connect({
          onOpen: () => setViewerState("waiting"),
          onMessage: handleMessage,
          onError: () => {
            setError("The live caption connection failed.");
            setViewerState("error");
          },
          onClose: () => {
            setViewerState((current) =>
              current === "ended" || current === "error" ? current : "error",
            );
          },
        });
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error ? caught.message : "Could not join this session.",
        );
        setViewerState("error");
      }
    }

    function handleMessage(message: ServerMessage) {
      if (message.type === "caption.partial") {
        setPartial(message.text);
        setViewerState("live");
        return;
      }
      if (message.type === "caption.final") {
        setCaptions((current) => [...current.slice(-19), message]);
        setPartial("");
        setViewerState("live");
        return;
      }
      if (message.state === "ended") {
        setViewerState("ended");
      } else if (message.state === "error") {
        setError(message.error ?? "This session encountered an error.");
        setViewerState("error");
      } else if (message.state === "live") {
        setViewerState("live");
      }
    }

    void connect();
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [sessionId]);

  const latest = captions.at(-1);
  const previous = useMemo(() => captions.slice(0, -1).reverse(), [captions]);

  return (
    <main className="min-h-screen bg-[#101311] px-5 py-6 text-[#f4f6f4]">
      <div className="mx-auto max-w-xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <h1 className="text-lg font-semibold">Tadabbur</h1>
          <div className="flex items-center gap-2 text-xs text-white/60">
            <span
              className={`h-2 w-2 rounded-full ${
                viewerState === "live" ? "bg-[#55c982]" : "bg-white/25"
              }`}
            />
            {viewerState === "connecting" && "Connecting"}
            {viewerState === "waiting" && "Waiting for speaker"}
            {viewerState === "live" && "Live"}
            {viewerState === "ended" && "Session ended"}
            {viewerState === "error" && "Unavailable"}
          </div>
        </header>

        {session && session.targetLanguages.length > 1 && (
          <label className="mt-5 block text-xs font-medium uppercase text-white/45">
            Translation
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="mt-2 block w-full border border-white/15 bg-[#171b18] px-3 py-3 text-base text-white"
            >
              {session.targetLanguages.map((target) => (
                <option key={target} value={target}>
                  {target.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        )}

        {error ? (
          <p className="mt-8 border-l-2 border-[#e35b55] pl-3 text-sm text-[#ffaaa5]">
            {error}
          </p>
        ) : (
          <>
            <section className="border-b border-white/10 py-8">
              <p className="text-xs font-medium uppercase text-white/45">Arabic</p>
              <p
                dir="rtl"
                lang="ar"
                className="mt-4 min-h-24 text-right font-arabic text-3xl leading-relaxed"
              >
                {partial || latest?.source || (
                  <span className="text-white/20">بانتظار الخطبة</span>
                )}
              </p>
            </section>

            <section className="py-8">
              <p className="text-xs font-medium uppercase text-white/45">
                Translation
              </p>
              <p className="mt-4 min-h-20 text-xl leading-relaxed text-white/90">
                {latest?.isQuranicHadithCandidate
                  ? "Scripture detected. Machine translation is unavailable."
                  : latest?.translations[language] || (
                      <span className="text-white/20">
                        Waiting for a complete phrase
                      </span>
                    )}
              </p>
            </section>

            {previous.length > 0 && (
              <section className="border-t border-white/10 pt-6">
                <p className="mb-5 text-xs font-medium uppercase text-white/45">
                  Earlier
                </p>
                <div className="space-y-6">
                  {previous.map((caption) => (
                    <article key={caption.chunkId} className="text-white/55">
                      <p dir="rtl" lang="ar" className="text-right text-lg">
                        {caption.source}
                      </p>
                      <p className="mt-2 text-sm">
                        {caption.isQuranicHadithCandidate
                          ? "Scripture detected. Machine translation is unavailable."
                          : caption.translations[language]}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
