"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ServerCaptionFinal, ServerMessage, Session } from "@contract";

import { PcmMicrophone } from "@/lib/microphone";
import { browserEndpoints } from "@/lib/endpoints";
import {
  clearOperatorSession,
  loadOperatorSession,
  reconnectDelayMs,
  saveOperatorSession,
} from "@/lib/operator-session";
import { selectPublicCaption } from "@/lib/public-caption";
import { CaptionStream } from "@/lib/ws-client";

type RunState = "idle" | "preparing" | "starting" | "live" | "reconnecting" | "stopping" | "error";
type SocketSource = "speaker" | "viewer";

const LIVE_TIMEOUT_MS = 15000;

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

/** "gone" means the session ended or expired; anything else may still resume. */
async function sessionStatus(apiBase: string, id: string): Promise<Session["status"] | "gone" | "unknown"> {
  try {
    const response = await fetch(`${apiBase}/api/sessions/${id}`);
    if (response.status === 404) return "gone";
    if (!response.ok) return "unknown";
    const session = (await response.json()) as Session;
    return session.status === "ended" ? "gone" : session.status;
  } catch {
    return "unknown";
  }
}

export default function ControlPage() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [sessionId, setSessionId] = useState("");
  const [resumable, setResumable] = useState(false);
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
  const sessionIdRef = useRef("");
  const activeRef = useRef(false);
  const stoppingRef = useRef(false);
  const startedAtRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const endedResolverRef = useRef<(() => void) | null>(null);
  const liveResolverRef = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const recitationResolverRef = useRef<{ desired: boolean; resolve: () => void } | null>(null);
  const recitationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setSiteOrigin(browserEndpoints().join); }, []);

  // Resume a session that a refresh, crash, or closed tab interrupted.
  useEffect(() => {
    const stored = loadOperatorSession(window.localStorage);
    if (!stored) return;
    let cancelled = false;
    void sessionStatus(browserEndpoints().api, stored.id).then((status) => {
      if (cancelled) return;
      if (status === "gone") { clearOperatorSession(window.localStorage); return; }
      sessionIdRef.current = stored.id;
      setSessionId(stored.id);
      setResumable(status === "live");
    });
    return () => { cancelled = true; };
  }, []);

  const closeSockets = useCallback((sendStop: boolean) => {
    speakerRef.current?.close(sendStop);
    viewerRef.current?.close();
    speakerRef.current = null;
    viewerRef.current = null;
  }, []);

  const cleanUp = useCallback(async (sendStop: boolean) => {
    activeRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    if (recitationTimerRef.current) clearTimeout(recitationTimerRef.current);
    recitationTimerRef.current = null;
    await microphoneRef.current?.stop();
    microphoneRef.current = null;
    closeSockets(sendStop);
  }, [closeSockets]);

  useEffect(() => () => { void cleanUp(false); }, [cleanUp]);
  useEffect(() => {
    if (runState !== "live" && runState !== "reconnecting") return;
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAtRef.current) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [runState]);

  function forgetSession() {
    clearOperatorSession(window.localStorage);
    sessionIdRef.current = "";
    setSessionId("");
    setResumable(false);
  }

  /** Stop for good: the session ended elsewhere or can no longer be resumed. */
  function failSession(message: string) {
    liveResolverRef.current?.reject(new Error(message));
    liveResolverRef.current = null;
    if (activeRef.current) {
      void cleanUp(false);
      setError(message);
      setRunState("error");
    }
  }

  /** A dropped socket while live: keep the microphone and links, reconnect. */
  function connectionLost() {
    if (!activeRef.current || stoppingRef.current || reconnectTimerRef.current) return;
    closeSockets(false);
    setRunState("reconnecting");
    setError("");
    const delay = reconnectDelayMs(reconnectAttemptRef.current++);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void reconnect();
    }, delay);
  }

  async function reconnect() {
    if (!activeRef.current || stoppingRef.current) return;
    const id = sessionIdRef.current;
    const status = await sessionStatus(browserEndpoints().api, id);
    if (status === "gone") {
      failSession("This session has ended. Prepare a new session to continue.");
      forgetSession();
      return;
    }
    try {
      await openSockets(id);
      if (!activeRef.current || stoppingRef.current) { closeSockets(false); return; }
      reconnectAttemptRef.current = 0;
      setRunState("live");
    } catch {
      closeSockets(false);
      connectionLost();
    }
  }

  function handleMessage(message: ServerMessage, source: SocketSource) {
    if (message.type === "caption.partial") {
      setPartial(message.text);
      setPartialQuran((current) => current || Boolean(message.isQuranicCandidate));
    } else if (message.type === "caption.final") {
      setFinals((current) => current.some((caption) => caption.chunkId === message.chunkId) ? current : [...current.slice(-29), message]);
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
    } else if (message.state === "live") {
      // Only the speaker socket confirms that this device owns the live stream.
      if (source === "speaker") {
        liveResolverRef.current?.resolve();
        liveResolverRef.current = null;
      }
    } else if (message.state === "error") {
      if (source !== "speaker") return;
      if (liveResolverRef.current) {
        liveResolverRef.current.reject(new Error(message.error ?? "The transcription session could not start."));
        liveResolverRef.current = null;
      } else {
        connectionLost();
      }
    } else if (message.state === "ended") {
      endedResolverRef.current?.();
      endedResolverRef.current = null;
      if (activeRef.current && !stoppingRef.current) {
        failSession("The live session was ended.");
        forgetSession();
      }
    }
  }

  /** Attach the preview viewer and the speaker; resolve once the speaker is live. */
  async function openSockets(id: string): Promise<CaptionStream> {
    const endpoints = browserEndpoints();
    const viewer = new CaptionStream(endpoints.ws, id, "viewer");
    const speaker = new CaptionStream(endpoints.ws, id, "speaker");
    viewerRef.current = viewer;
    speakerRef.current = speaker;

    const liveSignal = new Promise<void>((resolve, reject) => {
      liveResolverRef.current = { resolve, reject };
    });
    // A rejection that arrives while the sockets are opening is handled when awaited below.
    void liveSignal.catch(() => undefined);
    const connect = (stream: CaptionStream, source: SocketSource) => new Promise<void>((resolve, reject) => {
      let opened = false;
      const lost = () => { if (stream === speakerRef.current || stream === viewerRef.current) connectionLost(); };
      stream.connect({
        onMessage: (message) => handleMessage(message, source),
        onOpen: () => { opened = true; resolve(); },
        onError: () => { if (!opened) reject(new Error("A live connection could not be established.")); else lost(); },
        onClose: () => { if (!opened) reject(new Error("The live connection closed during setup.")); else lost(); },
      });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await connect(viewer, "viewer");
      await connect(speaker, "speaker");
      await Promise.race([
        liveSignal,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Timed out waiting for transcription to start.")), LIVE_TIMEOUT_MS);
        }),
      ]);
      return speaker;
    } finally {
      clearTimeout(timer);
      liveResolverRef.current = null;
    }
  }

  async function prepare() {
    if (sessionId || runState === "preparing" || runState === "starting" || runState === "live") return;
    setRunState("preparing");
    setError("");
    setFinals([]);
    setPartial("");
    setPartialQuran(false);
    setElapsed(0);
    setMicLevel(0);
    setBytesSent(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
        throw new Error("A secure browser with microphone and AudioWorklet support is required.");
      }
      const microphoneCheck = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneCheck.getTracks().forEach((track) => track.stop());
      const endpoints = browserEndpoints();
      const response = await fetch(`${endpoints.api}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceLanguage: "ar", targetLanguages: ["en"] }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const session = (await response.json()) as Session;
      saveOperatorSession(window.localStorage, { id: session.id });
      sessionIdRef.current = session.id;
      setSessionId(session.id);
      setResumable(false);
      setRunState("idle");
    } catch (caught) {
      forgetSession();
      setError(caught instanceof Error ? caught.message : "Unable to prepare a session.");
      setRunState("error");
    }
  }

  async function start() {
    if (!sessionId || runState === "starting" || runState === "stopping" || runState === "live" || runState === "reconnecting") return;
    setRunState("starting");
    setError("");
    setFinals([]);
    setPartial("");
    setPartialQuran(false);
    setRecitationPending(null);
    setElapsed(0);
    setMicLevel(0);
    setBytesSent(0);
    stoppingRef.current = false;
    reconnectAttemptRef.current = 0;
    sessionIdRef.current = sessionId;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires a secure browser connection.");
      const speaker = await openSockets(sessionId);
      if (recitationArmed) {
        setRecitationPending(true);
        const confirmed = new Promise<void>((resolve) => {
          recitationResolverRef.current = { desired: true, resolve };
        });
        if (!speaker.send({ type: "session.recitation", sessionId, active: true })) {
          throw new Error("Could not arm Quran mode before microphone capture.");
        }
        await Promise.race([
          confirmed,
          new Promise<void>((_, reject) => window.setTimeout(() => reject(new Error("Quran mode was not confirmed before microphone capture.")), 5000)),
        ]);
      }
      const microphone = new PcmMicrophone();
      microphoneRef.current = microphone;
      await microphone.start(
        // While reconnecting there is no speaker socket; audio is dropped, not queued.
        (chunk) => { const live = speakerRef.current; if (live && !live.sendAudio(chunk)) connectionLost(); },
        (stats) => { setMicLevel(stats.level); setBytesSent(stats.bytesSent); },
      );
      activeRef.current = true;
      startedAtRef.current = Date.now();
      setResumable(false);
      setRunState("live");
    } catch (caught) {
      liveResolverRef.current = null;
      recitationResolverRef.current = null;
      setRecitationPending(null);
      await cleanUp(false);
      // Keep the prepared session (and its shared links) unless it is gone.
      if ((await sessionStatus(browserEndpoints().api, sessionId)) === "gone") forgetSession();
      setError(caught instanceof Error ? caught.message : "Unable to start the Arabic translation.");
      setRunState("error");
    }
  }

  async function stop() {
    if (runState !== "live" && runState !== "reconnecting") return;
    stoppingRef.current = true;
    activeRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    setRunState("stopping");
    try {
      await microphoneRef.current?.stop();
      microphoneRef.current = null;
      const ended = new Promise<void>((resolve) => { endedResolverRef.current = resolve; });
      if (!speakerRef.current) {
        // Reconnecting: attach once more so the server can end the session for viewers.
        await openSockets(sessionIdRef.current).catch(() => undefined);
      }
      speakerRef.current?.close(true);
      speakerRef.current = null;
      await Promise.race([ended, new Promise<void>((resolve) => window.setTimeout(resolve, 10000))]);
      viewerRef.current?.close();
      viewerRef.current = null;
      endedResolverRef.current = null;
      forgetSession();
      setRunState("idle");
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
    } finally {
      stoppingRef.current = false;
    }
  }

  function toggleRecitation() {
    if (recitationPending !== null || runState === "reconnecting") return;
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
  const isReconnecting = runState === "reconnecting";
  const isOnAir = isLive || isReconnecting;
  const isBusy = runState === "preparing" || runState === "starting" || runState === "stopping";
  const latest = finals.at(-1);
  const previous = finals.at(-2);
  const publicPreview = selectPublicCaption(
    latest ?? null,
    partialQuran ? "quran" : partial ? "listening" : "none",
    recitationMode,
  );
  const publicQuranActive = publicPreview.isQuranActive;
  const attendeeUrl = siteOrigin && sessionId ? `${siteOrigin}/join/${sessionId}` : "";
  const displayUrl = siteOrigin && sessionId ? `${siteOrigin}/display/${sessionId}` : "";
  const isLoopback = siteOrigin ? /https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(siteOrigin) : false;
  const activeStep = isOnAir ? 3 : sessionId ? 2 : 1;
  const stepHint = isReconnecting
    ? "Connection lost. Reconnecting automatically; the projector and phone links stay the same."
    : activeStep === 1
      ? "Prepare checks the microphone without broadcasting audio."
      : activeStep === 2
        ? resumable
          ? "This session was interrupted. Resume to continue on the same projector and phone links."
          : isLoopback
            ? "Open Tadabbur at a network address before sharing the phone link."
            : "Open the projector and share the attendee link before Arabic begins."
        : "Arabic translation is live. End it when the khutbah finishes.";

  return (
    <main className="min-h-[100dvh] bg-[#0b1512] text-[#f5f2ea]">
      <div className="mx-auto grid min-h-[100dvh] max-w-[1500px] lg:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5 border-b border-[#2a4139] bg-[#0e1a16] p-5 lg:h-[100dvh] lg:overflow-y-auto lg:overscroll-contain lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#d4a94f] font-arabic text-2xl font-bold text-[#12201b]" aria-hidden="true">ت</div>
            <div><p className="text-lg font-bold">Tadabbur</p><p className="text-xs text-[#9db3aa]">Friday khutbah translation</p></div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-[#d4a94f]">Operator controls</p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight">Bridge the Arabic khutbah</h1>
            <p className="mt-2 text-sm leading-relaxed text-[#b4c5bc]">Set up during the English khutbah. Start the microphone only when the Arabic khutbah begins.</p>
          </div>
          <ol aria-label="Friday setup steps" className="grid grid-cols-3 gap-2">
            {[
              ["Prepare", "Check the microphone; audio stays off."],
              ["Share", isLoopback ? "Open Tadabbur at a network address for phone links." : "Open the projector and share the attendee link."],
              ["Translate", "Start when Arabic speech begins."],
            ].map(([title, description], index) => (
              <li key={title} aria-label={`${title}: ${description}`} aria-current={activeStep === index + 1 ? "step" : undefined} className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl border p-2 text-center ${activeStep === index + 1 ? "border-[#d4a94f]/55 bg-[#d4a94f]/10" : "border-[#2a4139] bg-[#12201b]"}`}>
                <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${activeStep === index + 1 ? "bg-[#d4a94f] text-[#12201b]" : "bg-[#2a4139] text-[#c9d6cf]"}`}>{index + 1}</span>
                <strong className="text-xs text-[#f5f2ea]">{title}</strong>
              </li>
            ))}
          </ol>
          <p className="-mt-3 text-xs leading-relaxed text-[#b4c5bc]">{stepHint}</p>
          <div className="flex flex-col gap-3 lg:sticky lg:bottom-0 lg:z-10 lg:-mx-6 lg:border-y lg:border-[#2a4139] lg:bg-[#0e1a16] lg:px-6 lg:py-4">
            <button
              type="button"
              onClick={() => void (isOnAir ? stop() : sessionId ? start() : prepare())}
              disabled={isBusy}
              className={`min-h-12 rounded-xl px-4 py-3 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a94f] disabled:cursor-wait disabled:opacity-70 ${isOnAir ? "bg-[#5a302b] text-[#fff1ed] hover:bg-[#734039]" : "bg-[#d4a94f] text-[#12201b] hover:bg-[#e6c374]"}`}
            >
              {isOnAir ? "End Arabic translation" : runState === "preparing" ? "Preparing session…" : runState === "starting" ? "Starting transcription…" : runState === "stopping" ? "Ending session…" : sessionId ? resumable ? "Resume Arabic translation" : "Start Arabic translation" : "Prepare session"}
            </button>
            <div className="rounded-xl border border-[#d4a94f]/40 bg-[#d4a94f]/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#f5f2ea]">Quran mode</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#c9d6cf]">Switch on before expected Quran recitation. Automatic detection can miss verses.</p>
                </div>
                <button type="button" role="switch" aria-checked={recitationMode || recitationArmed} aria-label="Quran mode" onClick={toggleRecitation} disabled={isBusy || isReconnecting || recitationPending !== null} className={`relative h-8 w-14 shrink-0 rounded-full border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4a94f] disabled:cursor-not-allowed disabled:opacity-50 ${recitationMode || recitationArmed ? "border-[#d4a94f] bg-[#d4a94f]" : "border-[#4b6258] bg-[#2a4139]"}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-[#0b1512] transition-all ${recitationMode || recitationArmed ? "left-7" : "left-1"}`} />
                </button>
              </div>
              <p role="status" className="mt-3 text-xs font-medium text-[#e6c374]">{recitationPending !== null ? "Waiting for server confirmation…" : recitationMode ? "Active · public screens show “Quran being read”" : recitationArmed ? "Armed · Quran mode starts before the microphone" : isLive ? "Off · switch on before the next recitation" : "Off · arm now if recitation begins the Arabic khutbah"}</p>
            </div>
          </div>
          {error && <p role="alert" className="rounded-xl border border-[#a85d4f] bg-[#2a1715] p-3 text-sm leading-relaxed text-[#ffd9d1]">{error}</p>}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[.1em] text-[#9db3aa]">Share live captions</p>
            {attendeeUrl ? (
              <div className="rounded-xl border border-[#2a4139] bg-[#12201b] p-4">
                {!isLoopback && <div className="mb-4 inline-block rounded-lg bg-white p-2"><QRCodeSVG value={attendeeUrl} size={96} marginSize={0} level="M" /></div>}
                <p className="break-all text-xs leading-relaxed text-[#c9d6cf]">{attendeeUrl}</p>
                {isLoopback && <p className="mt-3 text-xs leading-relaxed text-[#e6c374]">This localhost link only works on this computer. Open Tadabbur using a network address or set a public join URL before sharing it with attendees.</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void copyLink(attendeeUrl)} className="rounded-lg border border-[#3a5648] px-3 py-2 text-xs font-semibold text-[#e6c374] hover:bg-[#1c332a]">{copied ? "Copied" : "Copy attendee link"}</button>
                  <a href={displayUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-[#3a5648] px-3 py-2 text-xs font-semibold text-[#e6ded0] hover:bg-[#1c332a]">Open projector ↗</a>
                </div>
              </div>
            ) : <p className="rounded-xl border border-[#2a4139] bg-[#12201b] p-3 text-xs leading-relaxed text-[#b4c5bc]">The projector and attendee links appear here after preparation.</p>}
          </div>
          <a href="https://tanzil.net" target="_blank" rel="noreferrer" className="text-xs text-[#9db3aa] underline underline-offset-2">Quran text reference: Tanzil Project</a>
        </aside>

        <section className="flex min-w-0 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e332c] px-5 py-5 sm:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.13em] text-[#9db3aa]">Live monitor</p>
              <h2 className="mt-1 text-xl font-semibold">Arabic → English</h2>
            </div>
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${isLive ? "bg-[#e5533d] livepulse" : isReconnecting ? "bg-[#e6c374] livepulse" : runState === "error" ? "bg-[#e5533d]" : "bg-[#7c9186]"}`} aria-hidden="true" />
              <span role="status" className="text-sm font-semibold text-[#c9d6cf]">{isLive ? "Microphone live" : isReconnecting ? "Reconnecting…" : isBusy ? runState === "preparing" ? "Preparing" : runState === "starting" ? "Connecting" : "Ending" : runState === "error" ? "Needs attention" : sessionId ? "Prepared · mic off" : "Ready to prepare"}</span>
              <span className="ml-2 font-mono text-sm tabular-nums text-[#9db3aa]">{formatElapsed(elapsed)}</span>
            </div>
          </header>
          <div className="grid flex-1 md:grid-cols-2">
            <div className="flex min-h-[280px] flex-col border-b border-[#1e332c] p-5 md:border-b-0 md:border-r sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[.13em] text-[#9db3aa]">Arabic · operator monitor</p>
              <div dir="rtl" lang="ar" className="mt-9 font-arabic text-[clamp(1.55rem,2.6vw,2.8rem)] leading-[1.8] text-[#f5f2ea]" aria-live="polite">
                {partial || latest?.source || <span className="text-[#9db3aa]">بانتظار بداية الخطبة العربية</span>}
              </div>
              {partial && <p className="mt-3 text-xs text-[#e6c374]">In progress · visible to operator only</p>}
              {!partial && previous && <p dir="rtl" lang="ar" className="mt-8 border-t border-[#2a4139] pt-6 font-arabic text-xl leading-[1.8] text-[#9db3aa]">{previous.source}</p>}
              <div className="mt-auto pt-8">
                <div className="flex h-7 items-end gap-1" aria-label={isLive ? "Microphone activity" : "Microphone off"}>
                  {Array.from({ length: 20 }, (_, index) => <span key={index} className={`w-1.5 rounded-full transition-all duration-100 ${isLive && micLevel * 8 > (index + 1) / 20 ? "bg-[#d4a94f]" : "bg-[#2a4139]"}`} style={{ height: `${8 + (index % 5) * 4}px` }} />)}
                </div>
                <p className="mt-2 text-xs text-[#9db3aa]">{isLive ? `Microphone connected · ${Math.round(bytesSent / 1024)} KB sent` : "Microphone starts when you go live"}</p>
              </div>
            </div>
            <div className="flex min-h-[280px] flex-col p-5 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[.13em] text-[#9db3aa]">English · public preview</p>
              {publicQuranActive ? (
                <div className="mt-9 rounded-2xl border border-[#d4a94f]/40 bg-[#d4a94f]/10 p-7 text-center text-2xl font-semibold text-[#f5f2ea]">Quran being read</div>
              ) : publicPreview.caption?.isQuranicHadithCandidate ? (
                <div className="mt-9 rounded-2xl border border-[#d4a94f]/40 bg-[#d4a94f]/10 p-7 text-center text-xl font-semibold text-[#f5f2ea]">Scriptural passage being read</div>
              ) : (
                <div className="mt-9 rounded-2xl border border-[#2a4139] bg-[#12201b] p-6 text-[clamp(1.2rem,2vw,2rem)] font-medium leading-[1.5] text-[#f5f2ea]">
                  {publicPreview.caption ? publicPreview.caption.translations.en || <span className="text-[#9db3aa]">Translation unavailable for this phrase.</span> : <span className="text-[#9db3aa]">{partial ? "Listening for the next phrase…" : "English captions appear here after each complete Arabic phrase."}</span>}
                </div>
              )}
              {!publicQuranActive && publicPreview.caption && !publicPreview.caption.isQuranicHadithCandidate && previous && !previous.isQuranicHadithCandidate && <p className="mt-7 border-t border-[#2a4139] pt-6 text-lg leading-relaxed text-[#9db3aa]">{previous.translations.en}</p>}
              <p className="mt-auto pt-8 text-xs leading-relaxed text-[#9db3aa]">Public screens show completed, checked phrases only. Partial Arabic is shown here for the operator.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
