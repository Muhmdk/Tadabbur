"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ServerCaptionFinal, ServerMessage, Session } from "@contract";

import { PcmMicrophone } from "@/lib/microphone";
import { CaptionStream } from "@/lib/ws-client";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";
const JOIN_URL = process.env.NEXT_PUBLIC_JOIN_BASE_URL ?? "http://localhost:3000";

type RunState = "idle" | "starting" | "live" | "stopping" | "error";

const languageNames: Record<string, string> = { en: "English", ur: "Urdu", fr: "French", tr: "Turkish", so: "Somali", ar: "Arabic" };
function languageName(code: string): string {
  return languageNames[code.toLowerCase()] ?? code.toUpperCase();
}

function micCopy(runState: RunState): string {
  if (runState === "live") return "Mic live · transcribing";
  if (runState === "starting") return "Starting…";
  if (runState === "stopping") return "Closing session…";
  if (runState === "error") return "Needs attention";
  return "Paused";
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ControlPage() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [sessionId, setSessionId] = useState("");
  const [targetLanguagesInput, setTargetLanguagesInput] = useState("en, ur");
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [bytesSent, setBytesSent] = useState(0);
  const [copied, setCopied] = useState<"join" | "display" | "">("");
  const [elapsed, setElapsed] = useState(0);
  const speakerRef = useRef<CaptionStream | null>(null);
  const viewerRef = useRef<CaptionStream | null>(null);
  const microphoneRef = useRef<PcmMicrophone | null>(null);
  const endedResolverRef = useRef<(() => void) | null>(null);

  const cleanUp = useCallback(async (sendStop: boolean) => {
    await microphoneRef.current?.stop();
    microphoneRef.current = null;
    speakerRef.current?.close(sendStop);
    viewerRef.current?.close();
    speakerRef.current = null;
    viewerRef.current = null;
  }, []);

  useEffect(() => () => { void cleanUp(false); }, [cleanUp]);

  // Live elapsed clock — ticks only while the session is running.
  useEffect(() => {
    if (runState !== "live") return;
    setElapsed(0);
    const started = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [runState]);

  function handleMessage(message: ServerMessage) {
    if (message.type === "caption.partial") {
      setPartial(message.text);
      return;
    }
    if (message.type === "caption.final") {
      setFinals((current) => [...current, message]);
      setPartial("");
      return;
    }
    if (message.state === "error") {
      setError(message.error ?? "The transcription session could not continue.");
      setRunState("error");
      endedResolverRef.current?.();
      endedResolverRef.current = null;
    }
    if (message.state === "ended") {
      endedResolverRef.current?.();
      endedResolverRef.current = null;
    }
  }

  async function start() {
    const targetLanguages = targetLanguagesInput
      .split(",")
      .map((language) => language.trim().toLowerCase())
      .filter(Boolean);

    if (targetLanguages.length === 0) {
      setError("Add at least one translation language before starting.");
      setRunState("error");
      return;
    }

    setRunState("starting");
    setError("");
    setPartial("");
    setFinals([]);
    setMicLevel(0);
    setBytesSent(0);

    try {
      const response = await fetch(`${API_URL}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceLanguage: "ar", targetLanguages }),
      });
      if (!response.ok) throw new Error(`Session creation failed (${response.status}).`);

      const session = (await response.json()) as Session;
      setSessionId(session.id);
      const viewer = new CaptionStream(WS_URL, session.id, "viewer");
      const speaker = new CaptionStream(WS_URL, session.id, "speaker");
      viewerRef.current = viewer;
      speakerRef.current = speaker;

      await new Promise<void>((resolve, reject) => {
        let viewerOpen = false;
        let speakerOpen = false;
        const ready = () => { if (viewerOpen && speakerOpen) resolve(); };
        const fail = () => reject(new Error("A live connection could not be established."));
        viewer.connect({ onMessage: handleMessage, onOpen: () => { viewerOpen = true; ready(); }, onError: fail });
        speaker.connect({ onMessage: handleMessage, onOpen: () => { speakerOpen = true; ready(); }, onError: fail });
      });

      const microphone = new PcmMicrophone();
      microphoneRef.current = microphone;
      await microphone.start(
        (chunk) => { speaker.sendAudio(chunk); },
        (stats) => { setMicLevel(stats.level); setBytesSent(stats.bytesSent); },
      );
      setRunState("live");
    } catch (caught) {
      await cleanUp(false);
      setError(caught instanceof Error ? caught.message : "Unable to start the live session.");
      setRunState("error");
    }
  }

  async function stop() {
    setRunState("stopping");
    await microphoneRef.current?.stop();
    microphoneRef.current = null;
    const ended = new Promise<void>((resolve) => { endedResolverRef.current = resolve; });
    speakerRef.current?.close(true);
    speakerRef.current = null;
    await Promise.race([ended, new Promise<void>((resolve) => window.setTimeout(resolve, 10_000))]);
    viewerRef.current?.close();
    viewerRef.current = null;
    endedResolverRef.current = null;
    setRunState("idle");
  }

  async function copyLink(kind: "join" | "display", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Could not copy the link. Please select it manually.");
    }
  }

  const isBusy = runState === "starting" || runState === "stopping";
  const isLive = runState === "live";
  const latestFinal = finals.at(-1);
  const previousFinal = finals.at(-2);
  const targetLanguages = targetLanguagesInput.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const primaryLanguage = targetLanguages[0] ?? "en";
  const attendeeUrl = sessionId ? `${JOIN_URL}/join/${sessionId}` : "";
  const displayUrl = sessionId ? `${JOIN_URL}/display/${sessionId}` : "";

  const sessionButton = isLive
    ? { label: "End session", className: "bg-[#3a1f1c] text-[#e5533d] hover:bg-[#482723]" }
    : { label: runState === "starting" ? "Starting…" : runState === "stopping" ? "Ending…" : "Start session", className: "bg-[#d4a94f] text-[#12201b] hover:bg-[#e6c374]" };

  return (
    <main className="min-h-[100dvh] bg-[#0b1512] text-[#f5f2ea]">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1400px] flex-col lg:flex-row">

        {/* Sidebar ------------------------------------------------------- */}
        <aside className="flex flex-col gap-6 border-b border-[#1e332c] bg-[#0e1a16] p-5 lg:w-[280px] lg:shrink-0 lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#d4a94f] text-xl text-[#12201b]">ت</div>
            <div>
              <p className="text-[15px] font-bold leading-tight">Tadabbur</p>
              <p className="text-xs text-[#6d8177]">Live khutbah translation</p>
            </div>
          </div>

          <div>
            <p className="text-[15px] font-bold leading-tight">Jummah Session</p>
            <p className="mt-1 text-xs text-[#6d8177]">Al-Noor Masjid · {todayLabel()}</p>
          </div>

          <label className="block">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[.08em] text-[#5c6f65]">Translation languages</span>
            <input
              value={targetLanguagesInput}
              onChange={(event) => setTargetLanguagesInput(event.target.value)}
              disabled={isLive || isBusy}
              placeholder="en, ur"
              aria-label="Translation languages"
              className="w-full rounded-lg border border-[#2a4139] bg-[#16241f] px-3 py-2.5 text-sm text-[#e6ded0] outline-none transition placeholder:text-[#5c6f65] focus:border-[#d4a94f] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <button
            type="button"
            onClick={isLive ? stop : start}
            disabled={isBusy}
            className={`rounded-[10px] px-4 py-3 text-[13px] font-bold transition disabled:cursor-not-allowed disabled:opacity-70 ${sessionButton.className}`}
          >
            {sessionButton.label}
          </button>

          {error && (
            <p role="alert" className="rounded-lg border border-[#3a1f1c] bg-[#1c110f] px-3 py-2.5 text-xs leading-relaxed text-[#f2b6ab]">
              {error}
            </p>
          )}

          <div>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[.08em] text-[#5c6f65]">Output languages</p>
            <div className="flex flex-col gap-2">
              {targetLanguages.length === 0 ? (
                <p className="text-xs text-[#5c6f65]">Add a language to begin.</p>
              ) : (
                targetLanguages.map((lang) => (
                  <div key={lang} className="flex items-center justify-between rounded-[9px] border border-[#1e332c] bg-[#16241f] px-3 py-2.5">
                    <span className="text-[13px] font-medium text-[#e6ded0]">{languageName(lang)}</span>
                    <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-[#4caf7d]" : "bg-[#5c6f65]"}`} />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-auto">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[.08em] text-[#5c6f65]">Attendee access</p>
            {attendeeUrl ? (
              <div className="flex items-center gap-3 rounded-xl border border-[#1e332c] bg-[#12201b] p-3">
                <div className="rounded-md bg-white p-1.5">
                  <QRCodeSVG value={attendeeUrl} size={52} marginSize={0} level="M" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-tight text-[#7c9186]">Scan or share to join on a phone.</p>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" onClick={() => void copyLink("join", attendeeUrl)} className="rounded-md border border-[#2a4139] px-2.5 py-1.5 text-[11px] font-semibold text-[#d4a94f] transition hover:bg-[#16241f]">
                      {copied === "join" ? "Copied" : "Copy link"}
                    </button>
                    {displayUrl && (
                      <a href={displayUrl} target="_blank" rel="noreferrer" className="rounded-md border border-[#2a4139] px-2.5 py-1.5 text-[11px] font-semibold text-[#c9d6cf] transition hover:bg-[#16241f]">
                        Open TV
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-[#1e332c] bg-[#12201b] px-3 py-3 text-xs leading-relaxed text-[#6d8177]">
                Start a session to generate the attendee QR code and projector link.
              </p>
            )}
          </div>
        </aside>

        {/* Main ---------------------------------------------------------- */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* Status bar */}
          <div className="flex items-center justify-between gap-4 border-b border-[#1e332c] px-5 py-4 sm:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${isLive ? "bg-[#e5533d] livepulse" : runState === "error" ? "bg-[#e5533d]" : "bg-[#5c6f65]"}`} />
              <span className="truncate text-[12px] font-semibold uppercase tracking-[.06em] text-[#c9d6cf]">{micCopy(runState)}</span>
              {/* Compact live input meter */}
              <div className="ml-1 hidden items-end gap-[2px] sm:flex" aria-hidden>
                {Array.from({ length: 10 }, (_, index) => {
                  const active = isLive && micLevel * 6 > (index + 1) / 10;
                  return <span key={index} className={`w-[3px] rounded-full transition-all duration-75 ${active ? "bg-[#d4a94f]" : "bg-white/10"}`} style={{ height: `${6 + (index % 4) * 4}px` }} />;
                })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isLive && <span className="hidden text-[11px] text-[#5c6f65] sm:inline">{Math.round(bytesSent / 1024)} KB sent</span>}
              <span className="text-[13px] font-semibold tabular-nums text-[#9db3aa]">{formatElapsed(elapsed)}</span>
            </div>
          </div>

          {/* Two-pane transcript */}
          <div className="grid flex-1 grid-cols-1 gap-px bg-[#1e332c] md:grid-cols-2">
            {/* Arabic (live) */}
            <div className="flex flex-col gap-4 bg-[#0e1a16] p-5 sm:p-7 scroll-quiet md:overflow-auto">
              <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#5c6f65]">Arabic transcript (live)</p>
              <div dir="rtl" lang="ar" aria-live="polite" className="font-arabic text-[19px] font-medium leading-[2] text-[#e6ded0] sm:text-[22px]">
                {partial || latestFinal?.source || <span className="text-[#5c6f65]">بانتظار بداية الخطبة</span>}
              </div>
              {previousFinal && (
                <div dir="rtl" lang="ar" className="font-arabic text-[16px] leading-[2] text-[#5c6f65] sm:text-[17px]">
                  {previousFinal.source}
                </div>
              )}
            </div>

            {/* Translation */}
            <div className="flex flex-col gap-4 bg-[#0e1a16] p-5 sm:p-7 scroll-quiet md:overflow-auto">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#5c6f65]">{languageName(primaryLanguage)} translation</p>
                <span className="rounded-full bg-[#16241f] px-2 py-0.5 text-[10px] font-semibold text-[#7c9186]">{primaryLanguage.toUpperCase()}</span>
              </div>
              {latestFinal?.isQuranicHadithCandidate ? (
                <div className="rounded-[10px] border border-[#2a4139] bg-[#16241f] px-3.5 py-3 text-[15px] leading-relaxed text-[#e6c374]">
                  Scriptural content may be present. Machine translation is withheld to protect the integrity of the text.
                </div>
              ) : (
                <div className="rounded-[10px] border border-[#2a4139] bg-[#16241f] px-3.5 py-3 text-[16px] font-medium leading-[1.7] text-[#e6ded0]">
                  {latestFinal?.translations[primaryLanguage] || <span className="text-[#5c6f65]">Translation appears after a complete phrase.</span>}
                </div>
              )}
              {previousFinal && !previousFinal.isQuranicHadithCandidate && previousFinal.translations[primaryLanguage] && (
                <div className="text-[15px] leading-[1.7] text-[#5c6f65]">
                  {previousFinal.translations[primaryLanguage]}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
