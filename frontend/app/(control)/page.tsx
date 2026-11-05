"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ServerCaptionFinal, ServerMessage, Session } from "@contract";

import AppearancePicker from "@/components/AppearancePicker";
import { useAppearance, withAppearance } from "@/lib/appearance";
import { DEMO_SESSION_ID } from "@/lib/demo";
import { PcmMicrophone } from "@/lib/microphone";
import { browserEndpoints } from "@/lib/endpoints";
import { selectPublicCaption } from "@/lib/public-caption";
import { CaptionStream } from "@/lib/ws-client";

const SIMULATION = process.env.NEXT_PUBLIC_SIMULATION === "1";

type RunState = "idle" | "preparing" | "starting" | "live" | "stopping" | "error";

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string | { msg?: string }[] };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((issue) => issue.msg).filter(Boolean).join("; ");
  } catch {
    // The HTTP status remains useful when the backend has no JSON error body.
  }
  return `Could not start the session (HTTP ${response.status}).`;
}

export default function ControlPage() {
  const { appearance, chooseAppearance } = useAppearance();
  const [runState, setRunState] = useState<RunState>("idle");
  const [sessionId, setSessionId] = useState("");
  const [partial, setPartial] = useState("");
  const [partialQuran, setPartialQuran] = useState(false);
  const [finals, setFinals] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [bytesSent, setBytesSent] = useState(0);
  const [copied, setCopied] = useState(false);
  const [recitationMode, setRecitationMode] = useState(false);
  const [recitationArmed, setRecitationArmed] = useState(false);
  const [recitationPending, setRecitationPending] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [siteOrigin, setSiteOrigin] = useState("");
  const speakerRef = useRef<CaptionStream | null>(null);
  const viewerRef = useRef<CaptionStream | null>(null);
  const microphoneRef = useRef<PcmMicrophone | null>(null);
  const activeRef = useRef(false);
  const endedResolverRef = useRef<(() => void) | null>(null);
  const liveResolverRef = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const recitationResolverRef = useRef<{ desired: boolean; resolve: () => void } | null>(null);
  const recitationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setSiteOrigin(browserEndpoints().join); }, []);

  const cleanUp = useCallback(async (sendStop: boolean) => {
    activeRef.current = false;
    if (recitationTimerRef.current) clearTimeout(recitationTimerRef.current);
    recitationTimerRef.current = null;
    await microphoneRef.current?.stop();
    microphoneRef.current = null;
    speakerRef.current?.close(sendStop);
    viewerRef.current?.close();
    speakerRef.current = null;
    viewerRef.current = null;
  }, []);

  useEffect(() => () => { void cleanUp(false); }, [cleanUp]);
  useEffect(() => {
    if (runState !== "live") return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [runState]);

  function failSession(message: string) {
    liveResolverRef.current?.reject(new Error(message));
    liveResolverRef.current = null;
    if (activeRef.current) {
      void cleanUp(false);
      setError(message);
      setRunState("error");
    }
  }

  function handleMessage(message: ServerMessage) {
    if (message.type === "caption.partial") {
      setPartial(message.text);
      setPartialQuran((current) => current || Boolean(message.isQuranicCandidate));
    } else if (message.type === "caption.final") {
      setFinals((current) => [...current.slice(-29), message]);
      setPartial("");
      setPartialQuran(false);
    } else if (message.type === "recitation.state") {
      setRecitationMode(message.active);
      setRecitationPending(null);
      if (recitationResolverRef.current?.desired === message.active) {
        recitationResolverRef.current.resolve();
        recitationResolverRef.current = null;
      }
      if (message.active) setRecitationArmed(false);
      if (recitationTimerRef.current) clearTimeout(recitationTimerRef.current);
      recitationTimerRef.current = null;
      if (!message.active) { setFinals([]); setPartial(""); setPartialQuran(false); }
    } else if (message.state === "live" || message.state === "ready") {
      liveResolverRef.current?.resolve();
      liveResolverRef.current = null;
    } else if (message.state === "error") {
      failSession(message.error ?? "The transcription session could not continue.");
    } else if (message.state === "ended") {
      endedResolverRef.current?.();
      endedResolverRef.current = null;
      if (activeRef.current) failSession("The live session ended unexpectedly.");
    }
  }

  async function prepare() {
    if (sessionId || runState === "preparing" || runState === "starting" || runState === "live") return;
    setRunState("preparing");
    setError("");
    setSessionId("");
    setFinals([]);
    setPartial("");
    setPartialQuran(false);
    setElapsed(0);
    setMicLevel(0);
    setBytesSent(0);
    try {
      if (!SIMULATION && (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode)) {
        throw new Error("A secure browser with microphone and AudioWorklet support is required.");
      }
      if (!SIMULATION) {
        const microphoneCheck = await navigator.mediaDevices.getUserMedia({ audio: true });
        microphoneCheck.getTracks().forEach((track) => track.stop());
      }
      const endpoints = browserEndpoints();
      const response = await fetch(`${endpoints.api}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceLanguage: "ar", targetLanguages: ["en"] }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const session = (await response.json()) as Session;
      setSessionId(session.id);
      setRunState("idle");
    } catch (caught) {
      setSessionId("");
      setError(caught instanceof Error ? caught.message : "Unable to prepare a session.");
      setRunState("error");
    }
  }

  async function start() {
    if (!sessionId || runState === "starting" || runState === "stopping" || runState === "live") return;
    setRunState("starting");
    setError("");
    setFinals([]);
    setPartial("");
    setPartialQuran(false);
    setRecitationMode(false);
    setRecitationPending(null);
    setElapsed(0);
    setMicLevel(0);
    setBytesSent(0);
    try {
      if (!SIMULATION && !navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires a secure browser connection.");
      const endpoints = browserEndpoints();
      const session = { id: sessionId };
      const viewer = new CaptionStream(endpoints.ws, session.id, "viewer");
      const speaker = new CaptionStream(endpoints.ws, session.id, "speaker");
      viewerRef.current = viewer;
      speakerRef.current = speaker;

      let acknowledge = false;
      const liveSignal = new Promise<void>((resolve, reject) => {
        liveResolverRef.current = { resolve: () => { acknowledge = true; resolve(); }, reject };
      });
      // A rejection that arrives while the sockets are opening is handled when awaited below.
      void liveSignal.catch(() => undefined);
      const connect = (stream: CaptionStream) => new Promise<void>((resolve, reject) => {
        let opened = false;
        stream.connect({
          onMessage: handleMessage,
          onOpen: () => { opened = true; resolve(); },
          onError: () => { if (!opened) reject(new Error("A live connection could not be established.")); else failSession("The live connection was interrupted."); },
          onClose: () => { if (!opened) reject(new Error("The live connection closed during setup.")); else if (activeRef.current) failSession("The live connection was interrupted."); },
        });
      });
      await connect(viewer);
      await connect(speaker);
      await Promise.race([
        liveSignal,
        new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error("Timed out waiting for transcription to start.")), 15000)),
      ]).catch(async (caught: unknown) => {
        if (!(caught instanceof Error) || caught.message !== "Timed out waiting for transcription to start.") throw caught;
        // The viewer can miss an early broadcast; the session record is authoritative.
        const statusResponse = await fetch(`${endpoints.api}/api/sessions/${session.id}`);
        if (!statusResponse.ok || (await statusResponse.json() as Session).status !== "live") throw caught;
      });
      if (!acknowledge) liveResolverRef.current = null;
      if (recitationArmed) {
        setRecitationPending(true);
        const confirmed = new Promise<void>((resolve) => {
          recitationResolverRef.current = { desired: true, resolve };
        });
        if (!speaker.send({ type: "session.recitation", sessionId: session.id, active: true })) {
          throw new Error("Could not arm Quran mode before microphone capture.");
        }
        await Promise.race([
          confirmed,
          new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error("Quran mode was not confirmed before microphone capture.")), 5000)),
        ]);
      }
      if (!SIMULATION) {
        const microphone = new PcmMicrophone();
        microphoneRef.current = microphone;
        await microphone.start(
          (chunk) => { if (!speaker.sendAudio(chunk)) failSession("Audio stopped reaching the transcription server."); },
          (stats) => { setMicLevel(stats.level); setBytesSent(stats.bytesSent); },
        );
      }
      activeRef.current = true;
      setRunState("live");
    } catch (caught) {
      liveResolverRef.current = null;
      recitationResolverRef.current = null;
      setRecitationPending(null);
      await cleanUp(true);
      setSessionId("");
      setError(caught instanceof Error ? caught.message : "Unable to start the Arabic translation.");
      setRunState("error");
    }
  }

  async function stop() {
    if (runState !== "live") return;
    activeRef.current = false;
    setRunState("stopping");
    try {
      await microphoneRef.current?.stop();
      microphoneRef.current = null;
      const ended = new Promise<void>((resolve) => { endedResolverRef.current = resolve; });
      speakerRef.current?.close(true);
      speakerRef.current = null;
      await Promise.race([ended, new Promise<void>((resolve) => window.setTimeout(resolve, 10000))]);
      viewerRef.current?.close();
      viewerRef.current = null;
      endedResolverRef.current = null;
      setRunState("idle");
      setSessionId("");
      setFinals([]);
      setPartial("");
      setPartialQuran(false);
      setElapsed(0);
      setMicLevel(0);
      setRecitationMode(false);
      setRecitationArmed(false);
      setRecitationPending(null);
    } catch (caught) {
      await cleanUp(false);
      setError(caught instanceof Error ? caught.message : "Could not end the session cleanly.");
      setRunState("error");
    }
  }

  function toggleRecitation() {
    if (recitationPending !== null) return;
    if (!isLive) { setRecitationArmed((armed) => !armed); return; }
    const requested = !recitationMode;
    if (!speakerRef.current?.send({ type: "session.recitation", sessionId, active: requested })) {
      setError("Quran mode could not reach the live session. Check the connection.");
      return;
    }
    setError("");
    setRecitationPending(requested);
    recitationTimerRef.current = setTimeout(() => {
      setRecitationPending(null);
      setError("Quran mode was not confirmed by the server. Please try again.");
      recitationTimerRef.current = null;
    }, 5000);
  }

  async function copyLink(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the link. Please select it manually.");
    }
  }

  const isLive = runState === "live";
  const isBusy = runState === "preparing" || runState === "starting" || runState === "stopping";
  const latest = finals.at(-1);
  const previous = finals.at(-2);
  const publicPreview = selectPublicCaption(
    latest ?? null,
    partialQuran ? "quran" : partial ? "listening" : "none",
    recitationMode,
  );
  const publicQuranActive = publicPreview.isQuranActive;
  const attendeeUrl = siteOrigin && sessionId ? withAppearance(`${siteOrigin}/join/${sessionId}`, appearance) : "";
  const displayUrl = siteOrigin && sessionId ? withAppearance(`${siteOrigin}/display/${sessionId}`, appearance) : "";
  const isLoopback = siteOrigin ? /https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(siteOrigin) : false;
  const activeStep = isLive ? 3 : sessionId ? 2 : 1;
  const stepHint = activeStep === 1
    ? "Prepare checks the microphone without broadcasting audio."
    : activeStep === 2
      ? isLoopback
        ? "Open Tadabbur at a network address before sharing the phone link."
        : "Open the projector and share the attendee link before Arabic begins."
      : "Arabic translation is live. End it when the khutbah finishes.";

  return (
    <main className="control-shell" data-appearance={appearance}>
      <header className="site-nav">
        <a href="/" className="wordmark">Tadabbur<span className="brand-arabic" lang="ar">تدبّر</span></a>
        <nav aria-label="Main navigation"><a href="#session">Session control ↗</a><a href="#how-it-works">The Friday flow ↗</a></nav>
        <span className="nav-note">One khutbah. Every heart.</span>
      </header>

      <section className="editorial-hero" aria-labelledby="hero-title">
        <img className="hero-photo" src="/images/prayer-hall.jpg" alt="Sunlight falling through the windows of a mosque prayer hall" />
        <div className="hero-shade" />
        <div className="hero-top mono"><span>Live Arabic khutbah translation</span><span>Made for the masjid</span></div>
        <div className="hero-center"><p className="hero-arabic" lang="ar" dir="rtl">نستمع. نفهم. نتدبّر.</p><p className="mono">Listen. Understand. Reflect.</p></div>
        <div className="hero-bottom"><h1 id="hero-title">Closer to<br />every word.</h1><div className="hero-caption"><p>One shared moment.<br />A deeper understanding.</p><a href="#session" className="hero-link mono">Prepare your session <span>↓</span></a></div></div>
      </section>

      <section id="session" className="session-workspace">
        <div className="section-kicker mono"><span>01 / The live session</span><span>Arabic → English</span></div>
        <div className="workspace-heading"><h2>A space for<br />understanding.</h2><div><span className={`status-label mono ${isLive ? "is-live" : ""}`} role="status"><i />{isLive ? SIMULATION ? "Simulation live" : "Microphone live" : isBusy ? "Connecting…" : runState === "error" ? "Needs attention" : sessionId ? "Prepared · mic off" : "Ready when you are"}</span><p>Prepare during the English khutbah.<br />Go live when the Arabic khutbah begins.</p></div></div>
        <AppearancePicker appearance={appearance} onChange={chooseAppearance} />
        {SIMULATION && <a className="demo-launch" href={withAppearance(`${siteOrigin || ""}/display/${DEMO_SESSION_ID}`, appearance)} target="_blank" rel="noreferrer"><span><span className="mono">Experience Tadabbur</span><strong>Simulate live demo</strong></span><span className="demo-launch-copy">Step into the prayer hall view.<br />Arabic and English, unfolding together.</span><span className="demo-launch-arrow" aria-hidden="true">↗</span></a>}
        <div className="operator-grid">
          <aside className="session-controls">
            <div className="panel-label mono"><span>Session control</span><span>{formatElapsed(elapsed)}</span></div>
            <ol className="setup-steps" aria-label="Friday setup steps">{["Prepare", "Share", "Translate"].map((title,index) => <li key={title} aria-current={activeStep === index + 1 ? "step" : undefined}><span>0{index+1}</span>{title}<i>{activeStep > index + 1 ? "✓" : activeStep === index + 1 ? "↗" : "—"}</i></li>)}</ol>
            <p className="step-hint">{SIMULATION ? "Prepare, open the audience views, then start the scripted simulation. No microphone is used." : stepHint}</p>
            <button type="button" onClick={() => void (isLive ? stop() : sessionId ? start() : prepare())} disabled={isBusy} className={`primary-action mono ${isLive ? "end-action" : ""}`}>
              <span>{isLive ? SIMULATION ? "End simulation" : "End translation" : runState === "preparing" ? "Preparing session…" : runState === "starting" ? "Starting transcription…" : runState === "stopping" ? "Ending session…" : sessionId ? SIMULATION ? "Start simulation" : "Start Arabic translation" : "Prepare session"}</span><span aria-hidden="true">{isLive ? "■" : "↗"}</span>
            </button>
            {error && <p role="alert" className="error-note">{error}</p>}
            <div className="recitation-control"><div><h3>Quran mode</h3><button type="button" role="switch" aria-checked={recitationMode || recitationArmed} aria-label="Quran mode" onClick={toggleRecitation} disabled={isBusy || recitationPending !== null} className="quran-switch"><span /></button></div><p>Switch on before recitation to pause translation on public screens.</p><p className="mono recitation-status" role="status">{recitationPending !== null ? "Awaiting confirmation…" : recitationMode ? "Active · Quran being read" : recitationArmed ? "Armed for the start" : "Off · ready to arm"}</p></div>
            <details className="share-details" open={Boolean(attendeeUrl)}><summary className="mono">Projector & attendee access <span>↗</span></summary>{attendeeUrl ? <div className="share-content">{!isLoopback && <QRCodeSVG value={attendeeUrl} size={112} marginSize={2} level="M" />}<p className="share-url">{attendeeUrl}</p>{isLoopback && <p>Phone access needs a network address. This link works on this computer.</p>}<button type="button" onClick={() => void copyLink(attendeeUrl)} className="text-action mono">{copied ? "Link copied ✓" : "Copy attendee link ↗"}</button><a href={displayUrl} target="_blank" rel="noreferrer" className="text-action mono">Open projector ↗</a><a href={attendeeUrl} target="_blank" rel="noreferrer" className="text-action mono">Open phone view ↗</a></div> : <p>Prepare the session to create your projector and attendee links.</p>}</details>
          </aside>

          <section className="caption-monitor" aria-label="Live captions">
            <div className="panel-label mono"><span>Live monitor</span><span>Source / translation</span></div>
            <div className="source-caption"><div className="caption-label mono"><span>01 / Arabic</span><span>Live transcript</span></div><p dir="rtl" lang="ar" className={`arabic-caption ${partial || latest?.source ? "" : "empty-caption"}`} aria-live="polite">{partial || latest?.source || "بانتظار بداية الخطبة العربية"}</p>{partial && <p className="mono partial-label">Listening · phrase in progress</p>}</div>
            <div className="translation-caption"><div className="caption-label mono"><span>02 / English</span><span>Public preview</span></div><div className="english-caption" aria-live="polite">{publicQuranActive ? <p>Quran being read</p> : publicPreview.caption?.isQuranicHadithCandidate ? <p>Scriptural passage being read</p> : publicPreview.caption?.translations.en ? <p>{publicPreview.caption.translations.en}</p> : <div className="waiting-caption"><span className="waiting-mark" aria-hidden="true">↳</span><p>Translation follows the speaker.</p><span>English captions will appear after each complete Arabic phrase.</span></div>}</div></div>
            <div className="monitor-bottom"><div className="audio-meter" aria-label={SIMULATION ? "Scripted audio simulation" : isLive ? "Microphone activity" : "Microphone off"}>{Array.from({length:32},(_,index)=><span key={index} className={isLive && micLevel * 8 > (index+1)/32 ? "active" : ""} style={{height:`${6+(index%6)*3}px`}} />)}</div><span className="mono">{SIMULATION ? "Scripted audio simulation" : isLive ? `${Math.round(bytesSent/1024)} KB sent` : "Microphone off"}</span></div>
          </section>
        </div>
        {previous && !publicQuranActive && !previous.isQuranicHadithCandidate && !previous.isQuranicCandidate && <div className="previous-caption"><span className="mono">Previous phrase</span><p>{previous.translations.en}</p></div>}
      </section>

      <section id="how-it-works" className="friday-flow"><div className="section-kicker mono"><span>02 / A considered Friday flow</span><span>Simple by intention</span></div><h2>Less to manage.<br />More to reflect on.</h2><div className="flow-grid">{[["01", "Prepare quietly.", "Check the microphone during the English khutbah. No audio is broadcast until you go live."],["02", "Bring everyone in.", "Open the prayer hall projector. Share the attendee link for captions on individual phones."],["03", "Let the words reach.", "Begin translation with the Arabic khutbah. Pause for Quran recitation, and end when the khutbah finishes."]].map(([number,title,copy])=><article key={number}><span className="mono">{number} /</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
      <footer className="site-footer"><div className="footer-top mono"><span>Built around the khutbah.</span><a href="https://tanzil.net" target="_blank" rel="noreferrer">Quran text reference / Tanzil ↗</a></div><p className="footer-wordmark">Tadabbur</p><div className="footer-bottom mono"><span>Listen. Understand. Reflect.</span><a href="#session">Back to your session ↑</a></div></footer>
    </main>
  );
}
