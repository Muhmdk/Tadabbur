"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { Language, ServerCaptionFinal, ServerMessage, Session } from "@contract";

import AppearancePicker from "@/components/AppearancePicker";
import { useAppearance } from "@/lib/appearance";
import { DEMO_SESSION_ID } from "@/lib/demo";
import CaptionRenderer from "@/components/CaptionRenderer";
import { browserEndpoints } from "@/lib/endpoints";
import { nextPartialCaptionState, selectPublicCaption } from "@/lib/public-caption";
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
  const { appearance, chooseAppearance } = useAppearance();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<Session | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [viewerState, setViewerState] = useState<ViewerState>("connecting");
  const [partialText, setPartialText] = useState("");
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
        setPartialText(message.text);
        setPartialState((current) => nextPartialCaptionState(current, Boolean(message.isQuranicCandidate)));
        setViewerState("live");
      } else if (message.type === "caption.final") {
        setCaptions((current) => current.some((caption) => caption.chunkId === message.chunkId) ? current : [...current.slice(-19), message]);
        setPartialState("none");
        setPartialText("");
        setViewerState("live");
      } else if (message.type === "recitation.state") {
        setManualQuran(message.active);
        setCaptions([]);
        setPartialState("none");
        setPartialText("");
      } else if (message.state === "ended") {
        ended = true;
        setViewerState("ended");
      } else if (message.state === "error") {
        terminalError = true;
        setError(message.error ?? "This session encountered an error.");
        setViewerState("error");
      } else if (message.state === "live") {
        setViewerState("live");
      }
    }

    function retry(owner?: CaptionStream) {
      if (owner && owner !== stream) return;
      if (cancelled || ended || terminalError || retryTimer) return;
      const old = stream;
      stream = null;
      old?.close();
      setPartialText("");
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
        const response = await fetch(`${endpoints.api}${process.env.NEXT_PUBLIC_SIMULATION === "1" && sessionId === DEMO_SESSION_ID ? "/api/demo" : `/api/sessions/${sessionId}`}`);
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
  const publicCaption = selectPublicCaption(latest ?? null, partialState, manualQuran, partialText);
  const visibleCaption = publicCaption.caption;
  const isQuran = publicCaption.isQuranActive;
  const isScripture = visibleCaption?.isQuranicHadithCandidate;
  const languages = session?.targetLanguages ?? [];
  const scale = SCALES[scaleIndex];
  const isLive = viewerState === "live";

  return (
    <div className="attendee-surface min-h-[100dvh] bg-[#e3e3db] text-[#0f0f0f]" data-appearance={appearance}>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">

        {/* Header --------------------------------------------------------- */}
        <header className="flex items-center justify-between gap-3 border-b border-[#b5b5a8] px-5 py-3.5">
          <div>
            <div className="text-[15px] font-bold leading-tight text-[#0f0f0f]">Tadabbur · Friday khutbah</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full bg-[#e5533d] ${isLive ? "livepulse" : "opacity-40"}`} />
              <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-[#e5533d]">{process.env.NEXT_PUBLIC_SIMULATION === "1" ? "Simulation" : stateLabel(viewerState)}</span>
            </div>
          </div>

          <div ref={menuRef} className="relative">
            {languages.length <= 1 ? (
              <span className="flex items-center rounded-full border border-[#aaa99b] bg-[#d5d5ca] px-3.5 py-2 text-[13px] font-semibold text-[#25251f]" aria-label={`Caption language: ${languageName(language)}`}>
                {languageName(language)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setLangMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-full border border-[#aaa99b] bg-[#d5d5ca] px-3.5 py-2 text-[13px] font-semibold text-[#25251f] transition hover:border-[#8c8c80]"
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
                className="absolute right-0 top-[42px] z-10 w-40 rounded-xl border border-[#aaa99b] bg-[#d5d5ca] p-1.5 shadow-[0_20px_40px_-10px_rgba(0,0,0,.6)]"
              >
                {languages.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    role="option"
                    aria-selected={lang === language}
                    onClick={() => { setLanguage(lang); setLangMenuOpen(false); }}
                    className={`block w-full rounded-lg px-2.5 py-2.5 text-left text-[13px] font-medium transition ${lang === language ? "bg-[#d9d9d0] text-[#25251f]" : "text-[#292923] hover:bg-[#d9d9d0]"}`}
                  >
                    {languageName(lang)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="attendee-appearance"><AppearancePicker appearance={appearance} onChange={chooseAppearance} compact /></div>
        {/* Body ----------------------------------------------------------- */}
        <main className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-4 pt-4 scroll-quiet">
          {error ? (
            <div role="alert" className="rounded-2xl border border-[#b9776a] bg-[#e9d4cc] p-5 text-sm leading-relaxed text-[#803426]">
              {error}
            </div>
          ) : viewerState === "ended" ? (
            <div className="rounded-2xl border border-[#aaa99b] bg-[#dadad1] p-6">
              <p dir="rtl" className="font-arabic text-3xl text-[#0f0f0f]">جزاكم الله خيراً</p>
              <p className="mt-4 text-base leading-relaxed text-[#626256]">This live translation session has ended.</p>
            </div>
          ) : (
            <>
              <CaptionRenderer
                variant="attendee"
                scale={scale}
                caption={visibleCaption ?? null}
                targetLanguage={language}
                isQuranActive={publicCaption.isQuranActive} interimSource={publicCaption.interimSource}
                waitingText={viewerState === "connecting" ? "Connecting to live captions…" : viewerState === "waiting" ? "Captions begin when the Arabic khutbah starts." : viewerState === "reconnecting" ? "Reconnecting to live captions…" : "Listening for the next phrase…"}
              />

              {/* Faded history */}
              {!isQuran && !isScripture && previous.map((caption, index) => (
                <div key={caption.chunkId} className="caption-history px-1" style={{ opacity: Math.max(0.28, 0.62 - index * 0.16) }}>
                  <div className="text-[13px] leading-relaxed text-[#3e3e35]">
                    {caption.isQuranicCandidate ? "Quran being read" : caption.isQuranicHadithCandidate ? "Scriptural passage being read" : caption.translations[language] || "Translation unavailable for this phrase."}
                  </div>
                </div>
              ))}
            </>
          )}
        </main>

        {/* Footer --------------------------------------------------------- */}
        <footer className="flex items-center justify-between gap-4 border-t border-[#b5b5a8] px-5 py-4">
          <div className="text-[11px] leading-relaxed text-[#626256]">
            <div>{isLive ? "Live captions" : stateLabel(viewerState)}</div>
            <a href="https://tanzil.net" target="_blank" rel="noreferrer" className="text-[#626256] underline underline-offset-2">Quran text reference: Tanzil Project</a>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setScaleIndex((i) => Math.max(0, i - 1))}
              disabled={scaleIndex === 0}
              aria-label="Decrease text size"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[#aaa99b] bg-[#d5d5ca] text-xs font-semibold text-[#3e3e35] transition hover:border-[#8c8c80] disabled:opacity-40"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setScaleIndex((i) => Math.min(SCALES.length - 1, i + 1))}
              disabled={scaleIndex === SCALES.length - 1}
              aria-label="Increase text size"
              className="grid h-8 w-8 place-items-center rounded-lg border border-[#aaa99b] bg-[#d5d5ca] text-sm font-semibold text-[#3e3e35] transition hover:border-[#8c8c80] disabled:opacity-40"
            >
              A+
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
