"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { Language, ServerCaptionFinal, ServerMessage, Session } from "@contract";

import CaptionRenderer from "@/components/CaptionRenderer";
import { browserEndpoints } from "@/lib/endpoints";
import { nextPartialCaptionState, selectPublicCaption } from "@/lib/public-caption";
import { useScreenWakeLock } from "@/lib/wake-lock";
import { CaptionStream } from "@/lib/ws-client";


type ViewerState = "connecting" | "reconnecting" | "waiting" | "live" | "ended" | "error";

const languageNames: Record<string, string> = { en: "English", ur: "Urdu", fr: "French", tr: "Turkish", so: "Somali" };
function languageName(language: string): string {
  return languageNames[language.toLowerCase()] ?? language.toUpperCase();
}

function stateLabel(state: ViewerState): string {
  if (state === "connecting") return "Connecting";
  if (state === "reconnecting") return "Reconnecting";
  if (state === "waiting") return "Waiting for the khutbah";
  if (state === "live") return "Live";
  if (state === "ended") return "Session ended";
  return "Unavailable";
}

// A- / A+ scale the caption typography for readability across the hall.
const SCALES = [0.85, 1, 1.15, 1.32, 1.5];
const DEFAULT_SCALE_INDEX = 1;

export default function MobileViewerPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<Session | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [viewerState, setViewerState] = useState<ViewerState>("connecting");
  const [partialState, setPartialState] = useState<"none" | "listening" | "quran">("none");
  const [manualQuran, setManualQuran] = useState(false);
  const [captions, setCaptions] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [scaleIndex, setScaleIndex] = useState(DEFAULT_SCALE_INDEX);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stream: CaptionStream | null = null;
    let cancelled = false;
    let ended = false;
    let terminalError = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    function handleMessage(message: ServerMessage) {
      if (message.type === "caption.partial") {
        setPartialState((current) => nextPartialCaptionState(current, Boolean(message.isQuranicCandidate)));
        setViewerState("live");
      } else if (message.type === "caption.final") {
        setCaptions((current) => current.some((caption) => caption.chunkId === message.chunkId) ? current : [...current.slice(-19), message]);
        setPartialState("none");
        setViewerState("live");
      } else if (message.type === "recitation.state") {
        setManualQuran(message.active);
        setCaptions([]);
        setPartialState("none");
      } else if (message.state === "ended") {
        ended = true;
        setViewerState("ended");
      } else if (message.state === "error") {
        terminalError = true;
        setError(message.error ?? "This session encountered an error.");
        setViewerState("error");
      } else if (message.state === "live") {
        setViewerState("live");
      } else if (message.state === "connecting") {
        // The operator's connection dropped; the server keeps the session for them.
        setViewerState("reconnecting");
      }
    }

    function retry(owner?: CaptionStream) {
      if (owner && owner !== stream) return;
      if (cancelled || ended || terminalError || retryTimer) return;
      const old = stream;
      stream = null;
      old?.close();
      setPartialState("listening");
      setViewerState("reconnecting");
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
        setLanguage(nextSession.targetLanguages[0] ?? "en");
        if (nextSession.status === "ended") { ended = true; setViewerState("ended"); return; }
        const nextStream = new CaptionStream(endpoints.ws, sessionId, "viewer");
        stream = nextStream;
        nextStream.connect({
          onOpen: () => { if (stream !== nextStream) return; attempts = 0; setError(""); setViewerState(nextSession.status === "live" ? "live" : "waiting"); },
          onMessage: (message) => { if (stream === nextStream) handleMessage(message); },
          onError: () => retry(nextStream),
          onClose: () => retry(nextStream),
        });
      } catch (caught) {
        if (!cancelled) {
          if (terminalError) {
            setError(caught instanceof Error ? caught.message : "Could not join this session.");
            setViewerState("error");
          } else retry();
        }
      }
    }

    void connect();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); stream?.close(); };
  }, [sessionId]);

  // Dismiss the language menu on outside click.
  useEffect(() => {
    if (!langMenuOpen) return;
    function onDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setLangMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [langMenuOpen]);

  const latest = captions.at(-1);
  const previous = useMemo(() => captions.slice(0, -1).reverse(), [captions]);
  const publicCaption = selectPublicCaption(latest ?? null, partialState, manualQuran);
  const visibleCaption = publicCaption.caption;
  const isQuran = publicCaption.isQuranActive;
  const isScripture = visibleCaption?.isQuranicHadithCandidate;
  const languages = session?.targetLanguages ?? [];
  const scale = SCALES[scaleIndex];
  const isLive = viewerState === "live";
  // Phones auto-lock within a minute; keep captions readable while they're live.
  useScreenWakeLock(isLive || viewerState === "reconnecting");

  return (
    <div className="min-h-[100dvh] bg-[#0b1512] text-[#f5f2ea]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">

        {/* Header --------------------------------------------------------- */}
        <header className="flex items-center justify-between gap-3 border-b border-[#1e332c] px-5 py-3.5">
          <div>
            <div className="text-[15px] font-bold leading-tight text-[#f5f2ea]">Tadabbur · Friday khutbah</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full bg-[#e5533d] ${isLive ? "livepulse" : "opacity-40"}`} />
              <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#e5533d]">{stateLabel(viewerState)}</span>
            </div>
          </div>

          <div ref={menuRef} className="relative">
            {languages.length <= 1 ? (
              <span className="flex items-center rounded-full border border-[#2a4139] bg-[#16241f] px-3.5 py-2 text-[13px] font-semibold text-[#d4a94f]" aria-label={`Caption language: ${languageName(language)}`}>
                {languageName(language)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setLangMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-full border border-[#2a4139] bg-[#16241f] px-3.5 py-2 text-[13px] font-semibold text-[#d4a94f] transition hover:border-[#3a5648]"
                aria-haspopup="listbox"
                aria-expanded={langMenuOpen}
              >
                <span>{languageName(language)}</span>
                <span className="text-[9px]">▾</span>
              </button>
            )}
            {langMenuOpen && languages.length > 1 && (
              <div
                role="listbox"
                className="absolute right-0 top-[42px] z-10 w-40 rounded-xl border border-[#2a4139] bg-[#16241f] p-1.5 shadow-[0_20px_40px_-10px_rgba(0,0,0,.6)]"
              >
                {languages.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    role="option"
                    aria-selected={lang === language}
                    onClick={() => { setLanguage(lang); setLangMenuOpen(false); }}
                    className={`block w-full rounded-lg px-2.5 py-2.5 text-left text-[13px] font-medium transition ${lang === language ? "bg-[#0e1a16] text-[#d4a94f]" : "text-[#e6ded0] hover:bg-[#0e1a16]"}`}
                  >
                    {languageName(lang)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* Body ----------------------------------------------------------- */}
        <main className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 pt-4 scroll-quiet">
          {error ? (
            <div role="alert" className="rounded-2xl border border-[#3a1f1c] bg-[#1c110f] p-5 text-sm leading-relaxed text-[#f2b6ab]">
              {error}
            </div>
          ) : viewerState === "ended" ? (
            <div className="rounded-2xl border border-[#2a4139] bg-[#12201b] p-6">
              <p dir="rtl" className="font-arabic text-3xl text-[#f7ead0]">جزاكم الله خيراً</p>
              <p className="mt-4 text-base leading-relaxed text-[#9db3aa]">This live translation session has ended.</p>
            </div>
          ) : (
            <>
              <CaptionRenderer
                key={latest?.chunkId ?? "pending"}
                variant="attendee"
                scale={scale}
                caption={visibleCaption ?? null}
                targetLanguage={language}
                isQuranActive={publicCaption.isQuranActive}
                waitingText={viewerState === "connecting" ? "Connecting to live captions…" : viewerState === "waiting" ? "Captions begin when the Arabic khutbah starts." : viewerState === "reconnecting" ? "Reconnecting to live captions…" : "Listening for the next phrase…"}
              />

              {/* Faded history */}
              {!isQuran && !isScripture && previous.map((caption, index) => (
                <div key={caption.chunkId} className="px-1" style={{ opacity: Math.max(0.28, 0.62 - index * 0.16) }}>
                  <div className="text-[13px] leading-relaxed text-[#c9d6cf]">
                    {caption.isQuranicCandidate ? "Quran being read" : caption.isQuranicHadithCandidate ? "Scriptural passage being read" : caption.translations[language] || "Translation unavailable for this phrase."}
                  </div>
                </div>
              ))}
            </>
          )}
        </main>

        {/* Footer --------------------------------------------------------- */}
        <footer className="flex items-center justify-between gap-4 border-t border-[#1e332c] px-5 py-4">
          <div className="text-[11px] leading-relaxed text-[#9db3aa]">
            <div>{isLive ? "Live captions" : stateLabel(viewerState)}</div>
            <a href="https://tanzil.net" target="_blank" rel="noreferrer" className="text-[#9db3aa] underline underline-offset-2">Quran text reference: Tanzil Project</a>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setScaleIndex((i) => Math.max(0, i - 1))}
              disabled={scaleIndex === 0}
              aria-label="Decrease text size"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[#2a4139] bg-[#16241f] text-xs font-semibold text-[#c9d6cf] transition hover:border-[#3a5648] disabled:opacity-40"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setScaleIndex((i) => Math.min(SCALES.length - 1, i + 1))}
              disabled={scaleIndex === SCALES.length - 1}
              aria-label="Increase text size"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[#2a4139] bg-[#16241f] text-sm font-semibold text-[#c9d6cf] transition hover:border-[#3a5648] disabled:opacity-40"
            >
              A+
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
