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

function shortSessionId(sessionId: string): string {
  return sessionId ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : "Not created yet";
}

function statusCopy(runState: RunState): string {
  if (runState === "live") return "Live translation is running";
  if (runState === "starting") return "Preparing the live session";
  if (runState === "stopping") return "Closing the live session";
  if (runState === "error") return "Needs attention";
  return "Ready when the imam is ready";
}

export default function ControlPage() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [sessionId, setSessionId] = useState("");
  const [targetLanguagesInput, setTargetLanguagesInput] = useState("en");
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [bytesSent, setBytesSent] = useState(0);
  const [copied, setCopied] = useState<"join" | "display" | "">("");
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
  const latestFinal = finals.at(-1);
  const targetLanguages = targetLanguagesInput.split(",").map((item) => item.trim()).filter(Boolean);
  const primaryLanguage = targetLanguages[0] ?? "en";
  const attendeeUrl = sessionId ? `${JOIN_URL}/join/${sessionId}` : "";
  const displayUrl = sessionId ? `${JOIN_URL}/display/${sessionId}` : "";

  return (
    <main className="tadabbur-shell arabesque-grid min-h-screen text-[#15251e]">
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8 lg:py-7">
        <header className="glass-panel flex items-center justify-between rounded-2xl px-5 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#1e5b46] text-xl text-[#f8edd2]">ت</div>
            <div>
              <p className="text-lg font-semibold tracking-tight">Tadabbur</p>
              <p className="text-xs text-[#537065]">Live khutbah translation</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-[#edf2ed] px-3 py-2 text-xs font-medium text-[#38554a] sm:text-sm">
            <span className={`h-2 w-2 rounded-full ${runState === "live" ? "status-pulse bg-[#2f8063]" : runState === "error" ? "bg-[#b84a40]" : "bg-[#9ba9a1]"}`} />
            <span className="hidden sm:inline">{statusCopy(runState)}</span>
            <span className="sm:hidden">{runState === "live" ? "Live" : "Offline"}</span>
          </div>
        </header>

        <div className="mt-5 grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="glass-panel rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">Session setup</p>
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-[#dce4dd] bg-[#f8faf7] px-4 py-3">
                  <p className="text-xs text-[#6b8277]">Spoken language</p>
                  <p className="mt-1 font-medium">Arabic <span className="font-arabic text-lg">العربية</span></p>
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-[#537065]">Translation languages</span>
                  <input
                    value={targetLanguagesInput}
                    onChange={(event) => setTargetLanguagesInput(event.target.value)}
                    disabled={runState === "live" || isBusy}
                    aria-describedby="language-help"
                    className="mt-2 w-full rounded-xl border border-[#cbd7cf] bg-white px-3 py-3 text-sm outline-none transition focus:border-[#2f8063] focus:ring-2 focus:ring-[#2f8063]/15 disabled:cursor-not-allowed disabled:bg-[#f2f4f1]"
                    placeholder="en, ur"
                  />
                  <span id="language-help" className="mt-2 block text-xs leading-relaxed text-[#6b8277]">Use language tags separated by commas. The first language is shown in the operator preview.</span>
                </label>
              </div>
              <button
                type="button"
                onClick={runState === "live" ? stop : start}
                disabled={isBusy}
                className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${runState === "live" ? "bg-[#b84a40] text-white hover:bg-[#a53e36]" : "bg-[#1e5b46] text-white hover:bg-[#174a39]"}`}
              >
                <span className="text-lg leading-none">{runState === "live" ? "■" : "●"}</span>
                {runState === "starting" ? "Starting session…" : runState === "stopping" ? "Ending session…" : runState === "live" ? "End live session" : "Start live session"}
              </button>
              {error && <p role="alert" className="mt-4 rounded-lg bg-[#fff0ed] px-3 py-3 text-sm leading-relaxed text-[#9e352d]">{error}</p>}
            </section>

            <section className="glass-panel rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">Audio input</p>
                <p className="text-xs font-medium text-[#537065]">{Math.round(bytesSent / 1024)} KB</p>
              </div>
              <div className="mt-4 flex h-24 items-end gap-1.5 rounded-xl bg-[#18382d] px-3 py-3" aria-label="Microphone level">
                {Array.from({ length: 18 }, (_, index) => {
                  const threshold = (index + 1) / 18;
                  return <span key={index} className={`w-full rounded-full transition-all duration-75 ${micLevel * 6 > threshold ? "bg-[#d7b065]" : "bg-white/15"}`} style={{ height: `${28 + (index % 5) * 14}%` }} />;
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[#6b8277]">Keep the microphone close to the khateeb and avoid placing it near a loudspeaker.</p>
            </section>
          </aside>

          <section className="space-y-5">
            <div className="glass-panel overflow-hidden rounded-2xl">
              <div className="flex flex-col gap-4 border-b border-[#dce4dd] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">Operator preview</p>
                  <h1 className="mt-1 text-xl font-semibold tracking-tight">The congregation sees each completed phrase.</h1>
                </div>
                <div className="rounded-full border border-[#d5e0d8] bg-[#f7faf7] px-3 py-1.5 text-xs font-medium text-[#466458]">Arabic → {primaryLanguage.toUpperCase()}</div>
              </div>

              <div className="grid min-h-[460px] divide-y divide-[#dce4dd] lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                <article className="flex flex-col justify-between p-6 sm:p-9">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]"><span>Live Arabic</span><span className="font-arabic text-base normal-case tracking-normal">النص المباشر</span></div>
                  <p dir="rtl" lang="ar" className="my-10 text-right font-arabic text-4xl leading-[1.6] text-[#18382d] sm:text-5xl">
                    {partial || latestFinal?.source || <span className="text-[#aab8af]">بانتظار بداية الخطبة</span>}
                  </p>
                  <p className="text-sm text-[#6b8277]">Interim Arabic appears here as it is transcribed.</p>
                </article>
                <article className="flex flex-col justify-between bg-[#fcfbf7] p-6 sm:p-9">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]"><span>Translation</span><span>{primaryLanguage.toUpperCase()}</span></div>
                  {latestFinal?.isQuranicHadithCandidate ? (
                    <div className="my-10 border-l-2 border-[#c8963e] pl-5 text-xl leading-relaxed text-[#76571d]">Scriptural content may be present. Machine translation is withheld to protect the integrity of the text.</div>
                  ) : (
                    <p className="my-10 text-3xl leading-relaxed text-[#21382d] sm:text-4xl">{latestFinal?.translations[primaryLanguage] || <span className="text-[#aab8af]">Translation will appear after a complete phrase.</span>}</p>
                  )}
                  <p className="text-sm text-[#6b8277]">Translations arrive only after the phrase is complete.</p>
                </article>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
              <section className="glass-panel rounded-2xl p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">Share with attendees</p><p className="mt-1 text-sm text-[#537065]">A phone-friendly live reading view.</p></div>
                  {attendeeUrl && <div className="rounded-lg bg-white p-2 shadow-sm"><QRCodeSVG value={attendeeUrl} size={72} marginSize={0} level="M" /></div>}
                </div>
                {attendeeUrl ? (
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <input readOnly value={attendeeUrl} aria-label="Attendee link" className="min-w-0 flex-1 rounded-lg border border-[#d5e0d8] bg-white px-3 py-2.5 text-xs text-[#466458]" />
                    <button type="button" onClick={() => void copyLink("join", attendeeUrl)} className="rounded-lg border border-[#b8cdc0] px-4 py-2.5 text-sm font-semibold text-[#1e5b46] hover:bg-[#edf5ef]">{copied === "join" ? "Copied" : "Copy link"}</button>
                  </div>
                ) : <p className="mt-5 rounded-lg bg-[#f0f3ef] px-3 py-3 text-sm text-[#6b8277]">Start a session to create the attendee link and QR code.</p>}
              </section>

              <section className="rounded-2xl bg-[#18382d] p-5 text-white sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#bdd4c6]">Projector display</p>
                <p className="mt-2 text-sm leading-relaxed text-[#e4eee7]">Open this focused display on the screen in the prayer hall.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {displayUrl ? <a href={displayUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-[#d7b065] px-4 py-2.5 text-sm font-semibold text-[#193429] hover:bg-[#e3bf79]">Open display</a> : <span className="rounded-lg bg-white/10 px-4 py-2.5 text-sm text-white/50">Available after start</span>}
                  {displayUrl && <button type="button" onClick={() => void copyLink("display", displayUrl)} className="rounded-lg border border-white/20 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">{copied === "display" ? "Copied" : "Copy display link"}</button>}
                </div>
              </section>
            </div>

            <section className="glass-panel rounded-2xl p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">Session details</p><p className="mt-1 text-sm text-[#537065]">{shortSessionId(sessionId)}</p></div><p className="rounded-full bg-[#edf2ed] px-3 py-1.5 text-xs font-medium text-[#466458]">{finals.length} completed phrase{finals.length === 1 ? "" : "s"}</p></div>
              {finals.length > 1 && <div className="mt-5 grid gap-3 md:grid-cols-3">{finals.slice(-3).reverse().map((caption) => <article key={caption.chunkId} className="rounded-xl border border-[#dce4dd] bg-[#fbfcfa] p-4"><p dir="rtl" lang="ar" className="font-arabic text-right text-lg leading-relaxed text-[#29483a]">{caption.source}</p><p className="mt-2 text-sm leading-relaxed text-[#668075]">{caption.isQuranicHadithCandidate ? "Translation withheld for scriptural content." : caption.translations[primaryLanguage] || "Translation unavailable."}</p></article>)}</div>}
            </section>
          </section>
        </div>
      </div>
    </main>
  );
}
