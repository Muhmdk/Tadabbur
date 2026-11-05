"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { Language, ServerCaptionFinal, ServerMessage, Session } from "@contract";

import AppearancePicker from "@/components/AppearancePicker";
import { useAppearance, withAppearance } from "@/lib/appearance";
import { DEMO_SESSION_ID } from "@/lib/demo";
import CaptionRenderer from "@/components/CaptionRenderer";
import { browserEndpoints } from "@/lib/endpoints";
import { nextPartialCaptionState, selectPublicCaption } from "@/lib/public-caption";
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
  const { appearance, chooseAppearance } = useAppearance();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<DisplayState>("connecting");
  const [partialText, setPartialText] = useState("");
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
        setPartialText(message.text);
        setPartialState((current) => nextPartialCaptionState(current, Boolean(message.isQuranicCandidate)));
        setState("live");
      } else if (message.type === "caption.final") {
        setLatest(message);
        setPartialState("none");
        setPartialText("");
        setState("live");
      } else if (message.type === "recitation.state") {
        setManualQuran(message.active);
        setLatest(null);
        setPartialState("none");
        setPartialText("");
      } else if (message.state === "ended") {
        ended = true;
        setState("ended");
      } else if (message.state === "error") {
        terminalError = true;
        setError(message.error ?? "The caption stream encountered an error.");
        setState("error");
      } else if (message.state === "live") {
        setState("live");
      }
    };

    function retry(owner?: CaptionStream) {
      if (owner && owner !== stream) return;
      if (cancelled || ended || terminalError || retryTimer) return;
      const old = stream;
      stream = null;
      old?.close();
      setPartialText("");
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
        const response = await fetch(`${endpoints.api}${process.env.NEXT_PUBLIC_SIMULATION === "1" && sessionId === DEMO_SESSION_ID ? "/api/demo" : `/api/sessions/${sessionId}`}`);
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
  const followUrl = joinBaseUrl ? withAppearance(`${joinBaseUrl}/join/${sessionId}`, appearance) : "";
  const isLive = state === "live";
  const publicCaption = selectPublicCaption(latest, partialState, manualQuran, partialText);

  return (
    <div className="projector-surface" data-appearance={appearance}>
      <header className="projector-masthead">
        <a href="/" className="wordmark">Tadabbur<span className="brand-arabic" lang="ar">تدبّر</span></a>
        <span className="projector-occasion mono">Jummah Khutbah · {formatDate(session?.createdAt)}</span>
        <AppearancePicker appearance={appearance} onChange={chooseAppearance} compact />
        <span className={`status-label mono ${isLive ? "is-live" : ""}`} role="status"><i />{process.env.NEXT_PUBLIC_SIMULATION === "1" ? "Simulation" : statusLabel(state)}</span>
      </header>
      <section className="projector-stage" aria-label="Khutbah captions">
        <div className="projector-panel-heading mono"><span>Listen. Understand. Reflect.</span><span>{languageName(targetLanguage)}</span></div>
        <div className="projector-caption-area">
          {error ? <p className="projector-notice" role="alert">{error}</p> : state === "ended" ? (
            <div className="projector-notice"><p dir="rtl" lang="ar" className="font-arabic">جزاكم الله خيراً</p><h1>This session has ended.</h1></div>
          ) : <CaptionRenderer caption={publicCaption.caption} targetLanguage={targetLanguage} isQuranActive={publicCaption.isQuranActive} interimSource={publicCaption.interimSource} waitingText={state === "connecting" ? "Connecting to the khutbah…" : state === "reconnecting" ? "Reconnecting…" : "Waiting for the speaker"} />}
        </div>
        <footer className="projector-panel-footer">
          <button type="button" className="projector-fullscreen mono" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>Full screen ↗</button>
          {followUrl && !/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(followUrl) && <a href={followUrl} className="projector-qr"><span className="mono">Follow on<br />your phone ↗</span><span className="qr-paper"><QRCodeSVG value={followUrl} size={52} marginSize={0} level="M" /></span></a>}
        </footer>
      </section>
    </div>
  );
}
