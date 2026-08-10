"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Language, ServerCaptionFinal, ServerMessage, Session } from "@contract";

import CaptionRenderer from "@/components/CaptionRenderer";
import { CaptionStream } from "@/lib/ws-client";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";

type DisplayState = "connecting" | "waiting" | "live" | "ended" | "error";

function displayStatus(state: DisplayState): string {
  if (state === "connecting") return "Connecting to session";
  if (state === "waiting") return "Waiting for the khutbah";
  if (state === "live") return "Live translation";
  if (state === "ended") return "Session has ended";
  return "Connection unavailable";
}

export default function DisplayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<DisplayState>("connecting");
  const [partial, setPartial] = useState("");
  const [latest, setLatest] = useState<ServerCaptionFinal | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: CaptionStream | null = null;
    let cancelled = false;

    const handleMessage = (message: ServerMessage) => {
      if (message.type === "caption.partial") {
        setPartial(message.text);
        setState("live");
      } else if (message.type === "caption.final") {
        setLatest(message);
        setPartial("");
        setState("live");
      } else if (message.state === "ended") {
        setState("ended");
      } else if (message.state === "error") {
        setError(message.error ?? "The caption stream encountered an error.");
        setState("error");
      } else if (message.state === "live") {
        setState("live");
      }
    };

    async function connect() {
      try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionId}`);
        if (!response.ok) throw new Error(response.status === 404 ? "This session is unavailable." : "Could not load this session.");
        const nextSession = (await response.json()) as Session;
        if (cancelled) return;
        setSession(nextSession);
        stream = new CaptionStream(WS_URL, sessionId, "viewer");
        stream.connect({
          onMessage: handleMessage,
          onOpen: () => setState("waiting"),
          onError: () => { setError("The display could not connect to the live caption stream."); setState("error"); },
          onClose: () => setState((current) => current === "ended" || current === "error" ? current : "error"),
        });
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not open this display.");
          setState("error");
        }
      }
    }

    void connect();
    return () => { cancelled = true; stream?.close(); };
  }, [sessionId]);

  const targetLanguage: Language = session?.targetLanguages[0] ?? "en";

  return (
    <main className="min-h-screen overflow-hidden bg-[#10291f] text-white">
      <div className="relative flex min-h-screen flex-col overflow-hidden px-7 py-7 sm:px-12 lg:px-16 lg:py-10">
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 12% 12%, rgba(215,176,101,.32), transparent 22rem), linear-gradient(30deg, transparent 49%, rgba(255,255,255,.035) 50%, transparent 51%)", backgroundSize: "auto, 64px 64px" }} />
        <header className="relative z-10 flex items-center justify-between gap-4 border-b border-white/15 pb-5">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#d7b065] text-xl text-[#163529]">ت</div><div><p className="text-lg font-semibold tracking-tight">Tadabbur</p><p className="text-xs text-white/55">Live khutbah translation</p></div></div>
          <div className="flex items-center gap-3"><div className="flex items-center gap-2 text-sm text-white/75"><span className={`h-2.5 w-2.5 rounded-full ${state === "live" ? "status-pulse bg-[#65bd91]" : state === "error" ? "bg-[#e47b6b]" : "bg-white/30"}`} />{displayStatus(state)}</div><button type="button" onClick={() => void document.documentElement.requestFullscreen?.()} className="hidden rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 sm:block">Full screen</button></div>
        </header>

        <section className="relative z-10 flex flex-1 items-center py-10 lg:py-14">
          {error ? (
            <div className="max-w-2xl border-l-2 border-[#e47b6b] pl-6 text-2xl leading-relaxed text-[#f2cfca]">{error}</div>
          ) : state === "ended" && !latest ? (
            <div className="max-w-2xl"><p className="font-arabic text-5xl text-[#f7ead0]">جزاكم الله خيراً</p><p className="mt-6 text-3xl leading-relaxed text-white/80">This live translation session has ended.</p></div>
          ) : (
            <CaptionRenderer sessionId={sessionId} source={partial || latest?.source || ""} sourceLang="ar" translations={latest?.translations ?? {}} targetLanguage={targetLanguage} isQuranicHadithCandidate={latest?.isQuranicHadithCandidate} />
          )}
        </section>

        <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-5 text-xs text-white/45"><span>Arabic → {targetLanguage.toUpperCase()}</span><span>Translation is displayed after each complete phrase.</span></footer>
      </div>
    </main>
  );
}
