"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { Language, ServerCaptionFinal, ServerMessage, Session } from "@contract";

import { CaptionStream } from "@/lib/ws-client";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";

type ViewerState = "connecting" | "waiting" | "live" | "ended" | "error";

const languageNames: Record<string, string> = { en: "English", ur: "Urdu", fr: "French", tr: "Turkish", so: "Somali" };
function languageName(language: string): string {
  return languageNames[language.toLowerCase()] ?? language.toUpperCase();
}

function stateLabel(state: ViewerState): string {
  if (state === "connecting") return "Connecting";
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
  const [partial, setPartial] = useState("");
  const [captions, setCaptions] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [scaleIndex, setScaleIndex] = useState(DEFAULT_SCALE_INDEX);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stream: CaptionStream | null = null;
    let cancelled = false;

    function handleMessage(message: ServerMessage) {
      if (message.type === "caption.partial") {
        setPartial(message.text);
        setViewerState("live");
      } else if (message.type === "caption.final") {
        setCaptions((current) => [...current.slice(-19), message]);
        setPartial("");
        setViewerState("live");
      } else if (message.state === "ended") {
        setViewerState("ended");
      } else if (message.state === "error") {
        setError(message.error ?? "This session encountered an error.");
        setViewerState("error");
      } else if (message.state === "live") {
        setViewerState("live");
      }
    }

    async function connect() {
      try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionId}`);
        if (!response.ok) throw new Error(response.status === 404 ? "This session is unavailable." : "Could not load this session.");
        const nextSession = (await response.json()) as Session;
        if (cancelled) return;
        setSession(nextSession);
        setLanguage(nextSession.targetLanguages[0] ?? "en");
        stream = new CaptionStream(WS_URL, sessionId, "viewer");
        stream.connect({
          onOpen: () => setViewerState("waiting"),
          onMessage: handleMessage,
          onError: () => { setError("The live caption connection failed."); setViewerState("error"); },
          onClose: () => setViewerState((current) => current === "ended" || current === "error" ? current : "error"),
        });
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not join this session.");
          setViewerState("error");
        }
      }
    }

    void connect();
    return () => { cancelled = true; stream?.close(); };
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
  const isScripture = latest?.isQuranicHadithCandidate;
  const languages = session?.targetLanguages ?? [];
  const scale = SCALES[scaleIndex];
  const isLive = viewerState === "live";

  return (
    <div className="min-h-[100dvh] bg-[#0b1512] text-[#f5f2ea]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">

        {/* Header --------------------------------------------------------- */}
        <header className="flex items-center justify-between gap-3 border-b border-[#1e332c] px-5 py-3.5">
          <div>
            <div className="text-[15px] font-bold leading-tight text-[#f5f2ea]">Al-Noor Masjid</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full bg-[#e5533d] ${isLive ? "livepulse" : "opacity-40"}`} />
              <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#e5533d]">{stateLabel(viewerState)}</span>
            </div>
          </div>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setLangMenuOpen((open) => !open)}
              disabled={languages.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-[#2a4139] bg-[#16241f] px-3.5 py-2 text-[13px] font-semibold text-[#d4a94f] transition hover:border-[#3a5648] disabled:opacity-60"
              aria-haspopup="listbox"
              aria-expanded={langMenuOpen}
            >
              <span>{languageName(language)}</span>
              <span className="text-[9px]">▾</span>
            </button>
            {langMenuOpen && languages.length > 0 && (
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
          ) : viewerState === "ended" && !latest ? (
            <div className="rounded-2xl border border-[#2a4139] bg-[#12201b] p-6">
              <p dir="rtl" className="font-arabic text-3xl text-[#f7ead0]">جزاكم الله خيراً</p>
              <p className="mt-4 text-base leading-relaxed text-[#9db3aa]">This live translation session has ended.</p>
            </div>
          ) : (
            <>
              {/* Current phrase card */}
              <div
                key={latest?.chunkId ?? "pending"}
                className="rise-in rounded-2xl border border-[#2a4139] p-5"
                style={{ background: "linear-gradient(180deg,#182b24,#12201b)" }}
              >
                <div
                  dir="rtl"
                  lang="ar"
                  aria-live="polite"
                  className="font-arabic font-medium text-[#f5f2ea]"
                  style={{ fontSize: `${1.4 * scale}rem`, lineHeight: 1.7 }}
                >
                  {partial || latest?.source || <span className="text-[#5c6f65]">بانتظار الخطبة</span>}
                </div>
                {isScripture ? (
                  <div
                    className="mt-3 border-l-2 border-[#d4a94f] pl-3 font-medium text-[#e6c374]"
                    style={{ fontSize: `${1.0 * scale}rem`, lineHeight: 1.5 }}
                  >
                    This may be Quranic or hadith content — machine translation is intentionally withheld.
                  </div>
                ) : (
                  <div
                    aria-live="polite"
                    className="mt-3 font-medium text-[#d4a94f]"
                    style={{ fontSize: `${1.06 * scale}rem`, lineHeight: 1.5 }}
                  >
                    {latest?.translations[language] || (
                      <span className="text-[#5c6f65]">{partial ? "Listening… translation appears once the phrase is complete." : "Waiting for a complete phrase…"}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Faded history */}
              {previous.map((caption, index) => (
                <div key={caption.chunkId} className="px-1" style={{ opacity: Math.max(0.28, 0.62 - index * 0.16) }}>
                  <div className="text-[13px] leading-relaxed text-[#c9d6cf]">
                    {caption.isQuranicHadithCandidate ? "Translation withheld for Quranic or hadith content." : caption.translations[language] || caption.source}
                  </div>
                </div>
              ))}
            </>
          )}
        </main>

        {/* Footer --------------------------------------------------------- */}
        <footer className="flex items-center justify-between border-t border-[#1e332c] px-5 py-4">
          <div className="text-[11px] text-[#5c6f65]">
            {isLive ? "Connected · low latency" : stateLabel(viewerState)}
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
