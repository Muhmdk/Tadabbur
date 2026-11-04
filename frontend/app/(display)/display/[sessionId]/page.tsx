"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { Language, ServerCaptionFinal, ServerMessage, Session } from "@contract";

import CaptionRenderer from "@/components/CaptionRenderer";
import { browserEndpoints } from "@/lib/endpoints";
import { nextPartialCaptionState, selectPublicCaption } from "@/lib/public-caption";
import { useScreenWakeLock } from "@/lib/wake-lock";
import { CaptionStream } from "@/lib/ws-client";


type DisplayState = "connecting" | "reconnecting" | "waiting" | "live" | "ended" | "error";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ur: "Urdu", fr: "French", tr: "Turkish", so: "Somali", ar: "Arabic",
};
function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

function statusLabel(state: DisplayState): string {
  if (state === "connecting") return "Connecting";
  if (state === "reconnecting") return "Reconnecting";
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
  const [partialState, setPartialState] = useState<"none" | "listening" | "quran">("none");
  const [latest, setLatest] = useState<ServerCaptionFinal | null>(null);
  const [manualQuran, setManualQuran] = useState(false);
  const [error, setError] = useState("");
  const [joinBaseUrl, setJoinBaseUrl] = useState("");

  useEffect(() => { setJoinBaseUrl(browserEndpoints().join); }, []);

  useEffect(() => {
    let stream: CaptionStream | null = null;
    let cancelled = false;
    let ended = false;
    let terminalError = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const handleMessage = (message: ServerMessage) => {
      if (message.type === "caption.partial") {
        setPartialState((current) => nextPartialCaptionState(current, Boolean(message.isQuranicCandidate)));
        setState("live");
      } else if (message.type === "caption.final") {
        setLatest(message);
        setPartialState("none");
        setState("live");
      } else if (message.type === "recitation.state") {
        setManualQuran(message.active);
        setLatest(null);
        setPartialState("none");
      } else if (message.state === "ended") {
        ended = true;
        setState("ended");
      } else if (message.state === "error") {
        terminalError = true;
        setError(message.error ?? "The caption stream encountered an error.");
        setState("error");
      } else if (message.state === "live") {
        setState("live");
      } else if (message.state === "connecting") {
        // The operator's connection dropped; the server keeps the session for them.
        setState("reconnecting");
      }
    };

    function retry(owner?: CaptionStream) {
      if (owner && owner !== stream) return;
      if (cancelled || ended || terminalError || retryTimer) return;
      const old = stream;
      stream = null;
      old?.close();
      setPartialState("listening");
      setState("reconnecting");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, Math.min(8000, 1000 * 2 ** attempts++));
    }

    async function connect() {
      try {
        const endpoints = browserEndpoints();
        const response = await fetch(`${endpoints.api}/api/sessions/${sessionId}`);
        if (response.status === 404) { terminalError = true; throw new Error("This session is unavailable."); }
        if (!response.ok) throw new Error("Could not load this session.");
        const nextSession = (await response.json()) as Session;
        if (cancelled) return;
        setSession(nextSession);
        if (nextSession.status === "ended") { ended = true; setState("ended"); return; }
        const nextStream = new CaptionStream(endpoints.ws, sessionId, "viewer");
        stream = nextStream;
        nextStream.connect({
          onMessage: (message) => { if (stream === nextStream) handleMessage(message); },
          onOpen: () => { if (stream !== nextStream) return; attempts = 0; setError(""); setState(nextSession.status === "live" ? "live" : "waiting"); },
          onError: () => retry(nextStream),
          onClose: () => retry(nextStream),
        });
      } catch (caught) {
        if (!cancelled) {
          if (terminalError) {
            setError(caught instanceof Error ? caught.message : "Could not open this display.");
            setState("error");
          } else retry();
        }
      }
    }

    void connect();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); stream?.close(); };
  }, [sessionId]);

  const targetLanguage: Language = session?.targetLanguages[0] ?? "en";
  const followUrl = joinBaseUrl ? `${joinBaseUrl}/join/${sessionId}` : "";
  const isLive = state === "live";
  // Keep the projector from blanking or starting a screen saver mid-khutbah.
  useScreenWakeLock(state !== "ended" && state !== "error");
  const publicCaption = selectPublicCaption(latest, partialState, manualQuran);

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
          <div className="truncate text-[clamp(.9rem,1.3vw,1.1rem)] font-semibold text-[#e6ded0]">Tadabbur</div>
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
        ) : state === "ended" ? (
          <div className="text-center">
            <p className="font-arabic text-[clamp(2rem,5vw,4rem)] text-[#f7ead0]">جزاكم الله خيراً</p>
            <p className="mt-6 text-[clamp(1.1rem,2.4vw,1.9rem)] leading-relaxed text-white/75">This live translation session has ended.</p>
          </div>
        ) : (
          <CaptionRenderer
            caption={publicCaption.caption}
            targetLanguage={targetLanguage}
            isQuranActive={publicCaption.isQuranActive}
            waitingText={state === "connecting" ? "Connecting to live captions…" : state === "waiting" ? "Captions begin when the Arabic khutbah starts." : state === "reconnecting" ? "Reconnecting to live captions…" : "Listening for the next phrase…"}
          />
        )}
      </main>

      {/* Footer ------------------------------------------------------------ */}
      <footer className="flex shrink-0 items-end justify-between gap-4 px-[clamp(1.25rem,4vw,3rem)] pb-[clamp(1.25rem,3.5vh,1.75rem)]">
        <div className="text-[clamp(.68rem,1vw,.78rem)] text-[#54655c]">
          Arabic → {languageName(targetLanguage)} · shown after each complete phrase
        </div>
        {followUrl && !/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(followUrl) && <div className="flex items-center gap-3 rounded-xl border border-[#1e332c] bg-[#12201b] p-2 pr-3">
          <div className="rounded-md bg-white p-1.5">
            <QRCodeSVG value={followUrl} size={40} marginSize={0} level="M" />
          </div>
          <div className="text-[clamp(.62rem,.85vw,.72rem)] leading-tight text-[#7c9186]">
            Scan to follow<br />on your phone
          </div>
        </div>}
      </footer>
    </div>
  );
}
