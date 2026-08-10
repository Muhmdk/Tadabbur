"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { Language, ServerCaptionFinal, ServerMessage, Session } from "@contract";

import CaptionRenderer from "@/components/CaptionRenderer";
import { CaptionStream } from "@/lib/ws-client";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";
const JOIN_URL = process.env.NEXT_PUBLIC_JOIN_BASE_URL ?? "http://localhost:3000";

type DisplayState = "connecting" | "waiting" | "live" | "ended" | "error";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ur: "Urdu", fr: "French", tr: "Turkish", so: "Somali", ar: "Arabic",
};
function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

function statusLabel(state: DisplayState): string {
  if (state === "connecting") return "Connecting";
  if (state === "waiting") return "Waiting for the khutbah";
  if (state === "live") return "Live";
  if (state === "ended") return "Session ended";
  return "Connection unavailable";
}

function formatDate(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
  const followUrl = `${JOIN_URL}/join/${sessionId}`;
  const isLive = state === "live";

  return (
    <div
      className="flex h-full w-full flex-col text-[#f5f2ea]"
      style={{ background: "radial-gradient(120% 140% at 50% 0%, #152621 0%, #0b1512 62%)" }}
    >
      {/* Header ------------------------------------------------------------ */}
      <header className="flex shrink-0 items-start justify-between gap-4 px-[clamp(1.25rem,4vw,3rem)] pt-[clamp(1.25rem,3.5vh,2rem)]">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full bg-[#e5533d] ${isLive ? "livepulse" : "opacity-40"}`} />
          <span className="text-[clamp(.7rem,1vw,.85rem)] font-bold uppercase tracking-[.12em] text-[#e5533d]">
            {isLive ? "Live" : statusLabel(state)}
          </span>
        </div>

        <div className="min-w-0 text-center">
          <div className="truncate text-[clamp(.9rem,1.3vw,1.1rem)] font-semibold text-[#e6ded0]">Al-Noor Masjid</div>
          <div className="mt-1 text-[clamp(.7rem,1vw,.8rem)] text-[#6d8177]">Jummah Khutbah · {formatDate(session?.createdAt)}</div>
        </div>

        <div className="flex items-center gap-1.5 text-[clamp(.7rem,1vw,.8rem)] font-medium text-[#6d8177]">
          <span className="hidden sm:inline">Translating to</span>
          <span className="font-semibold text-[#d4a94f]">{languageName(targetLanguage)}</span>
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            className="ml-3 hidden rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 lg:inline-block"
          >
            Full screen
          </button>
        </div>
      </header>

      {/* Stage ------------------------------------------------------------- */}
      <main className="flex min-h-0 flex-1 items-center justify-center px-[clamp(1.5rem,7vw,5.5rem)] py-[clamp(1rem,3vh,2rem)]">
        {error ? (
          <div className="max-w-2xl border-l-2 border-[#e5533d] pl-6 text-[clamp(1.1rem,2.4vw,1.75rem)] leading-relaxed text-[#f2cfca]">
            {error}
          </div>
        ) : state === "ended" && !latest ? (
          <div className="text-center">
            <p className="font-arabic text-[clamp(2rem,5vw,4rem)] text-[#f7ead0]">جزاكم الله خيراً</p>
            <p className="mt-6 text-[clamp(1.1rem,2.4vw,1.9rem)] leading-relaxed text-white/75">This live translation session has ended.</p>
          </div>
        ) : (
          <CaptionRenderer
            sessionId={sessionId}
            source={partial || latest?.source || ""}
            sourceLang="ar"
            translations={latest?.translations ?? {}}
            targetLanguage={targetLanguage}
            isQuranicHadithCandidate={latest?.isQuranicHadithCandidate}
          />
        )}
      </main>

      {/* Footer ------------------------------------------------------------ */}
      <footer className="flex shrink-0 items-end justify-between gap-4 px-[clamp(1.25rem,4vw,3rem)] pb-[clamp(1.25rem,3.5vh,1.75rem)]">
        <div className="text-[clamp(.68rem,1vw,.78rem)] text-[#54655c]">
          Arabic → {languageName(targetLanguage)} · translation shown after each complete phrase
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-[#1e332c] bg-[#12201b] p-2 pr-3">
          <div className="rounded-md bg-white p-1.5">
            <QRCodeSVG value={followUrl} size={40} marginSize={0} level="M" />
          </div>
          <div className="text-[clamp(.62rem,.85vw,.72rem)] leading-tight text-[#7c9186]">
            Scan to follow<br />on your phone
          </div>
        </div>
      </footer>
    </div>
  );
}
