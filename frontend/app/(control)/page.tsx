"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { ServerCaptionFinal, ServerMessage, Session } from "@contract";

import { PcmMicrophone } from "@/lib/microphone";
import { CaptionStream } from "@/lib/ws-client";

const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const WS_URL =
  process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";
const JOIN_URL =
  process.env.NEXT_PUBLIC_JOIN_BASE_URL ?? "http://localhost:3000";

type RunState = "idle" | "starting" | "live" | "stopping" | "error";

export default function ControlPage() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [sessionId, setSessionId] = useState("");
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [bytesSent, setBytesSent] = useState(0);
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

  useEffect(() => {
    return () => {
      void cleanUp(false);
    };
  }, [cleanUp]);

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
      setError(message.error ?? "The transcription session failed.");
      setRunState("error");
      endedResolverRef.current?.();
      endedResolverRef.current = null;
      return;
    }
    if (message.state === "ended") {
      endedResolverRef.current?.();
      endedResolverRef.current = null;
    }
  }

  async function start() {
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
        body: JSON.stringify({
          sourceLanguage: "ar",
          targetLanguages: ["en"],
        }),
      });
      if (!response.ok) {
        throw new Error(`Session creation failed (${response.status}).`);
      }
      const session = (await response.json()) as Session;
      setSessionId(session.id);

      const viewer = new CaptionStream(WS_URL, session.id, "viewer");
      const speaker = new CaptionStream(WS_URL, session.id, "speaker");
      viewerRef.current = viewer;
      speakerRef.current = speaker;

      await new Promise<void>((resolve, reject) => {
        let viewerOpen = false;
        let speakerOpen = false;
        const ready = () => {
          if (viewerOpen && speakerOpen) resolve();
        };
        const fail = () => reject(new Error("A WebSocket connection failed."));

        viewer.connect({
          onMessage: handleMessage,
          onOpen: () => {
            viewerOpen = true;
            ready();
          },
          onError: fail,
        });
        speaker.connect({
          onMessage: handleMessage,
          onOpen: () => {
            speakerOpen = true;
            ready();
          },
          onError: fail,
        });
      });

      const microphone = new PcmMicrophone();
      microphoneRef.current = microphone;
      await microphone.start(
        (chunk) => {
          speaker.sendAudio(chunk);
        },
        (stats) => {
          setMicLevel(stats.level);
          setBytesSent(stats.bytesSent);
        },
      );
      setRunState("live");
    } catch (caught) {
      await cleanUp(false);
      setError(
        caught instanceof Error ? caught.message : "Unable to start the session.",
      );
      setRunState("error");
    }
  }

  async function stop() {
    setRunState("stopping");
    await microphoneRef.current?.stop();
    microphoneRef.current = null;

    const ended = new Promise<void>((resolve) => {
      endedResolverRef.current = resolve;
    });
    speakerRef.current?.close(true);
    speakerRef.current = null;

    await Promise.race([
      ended,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 10_000);
      }),
    ]);
    viewerRef.current?.close();
    viewerRef.current = null;
    endedResolverRef.current = null;
    setRunState("idle");
  }

  const isBusy = runState === "starting" || runState === "stopping";
  const latestFinal = finals.at(-1);
  const attendeeUrl = sessionId ? `${JOIN_URL}/join/${sessionId}` : "";

  return (
    <main className="min-h-screen bg-[#101311] text-[#f4f6f4]">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-lg font-semibold">Tadabbur</h1>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                runState === "live" ? "bg-[#55c982]" : "bg-white/25"
              }`}
            />
            {runState === "live" ? "Live" : "Offline"}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-10 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-6">
          <div>
            <p className="text-xs font-medium uppercase text-white/45">Languages</p>
            <p className="mt-2 text-sm">Arabic → English</p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase text-white/45">Session</p>
            <p className="mt-2 break-all font-mono text-xs text-white/65">
              {sessionId || "Not started"}
            </p>
          </div>

          {attendeeUrl && (
            <div>
              <p className="text-xs font-medium uppercase text-white/45">
                Attendee access
              </p>
              <div className="mt-3 w-fit bg-white p-3">
                <QRCodeSVG
                  value={attendeeUrl}
                  size={152}
                  marginSize={0}
                  level="M"
                />
              </div>
              <a
                href={attendeeUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all text-xs text-[#74d99a] underline decoration-white/20 underline-offset-4"
              >
                {attendeeUrl}
              </a>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between text-xs font-medium uppercase text-white/45">
              <span>Microphone</span>
              <span>{Math.round(bytesSent / 1024)} KB sent</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden bg-white/10">
              <div
                className="h-full bg-[#55c982] transition-[width] duration-75"
                style={{ width: `${Math.min(100, micLevel * 500)}%` }}
              />
            </div>
          </div>

          {runState === "live" ? (
            <button
              type="button"
              onClick={stop}
              disabled={isBusy}
              className="w-full bg-[#e35b55] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Stop microphone
            </button>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={isBusy}
              className="w-full bg-[#55c982] px-4 py-3 text-sm font-semibold text-[#07130c] disabled:opacity-50"
            >
              {runState === "starting" ? "Starting…" : "Start microphone"}
            </button>
          )}

          {error && (
            <p className="border-l-2 border-[#e35b55] pl-3 text-sm text-[#ffaaa5]">
              {error}
            </p>
          )}
        </aside>

        <section className="min-h-[520px] border-l border-white/10 pl-0 lg:pl-8">
          <div className="border-b border-white/10 pb-8">
            <p className="text-xs font-medium uppercase text-white/45">Arabic</p>
            <p
              dir="rtl"
              lang="ar"
              className="mt-5 min-h-28 text-right font-arabic text-4xl leading-relaxed"
            >
              {partial || latestFinal?.source || (
                <span className="text-white/20">بانتظار الصوت</span>
              )}
            </p>
          </div>

          <div className="pt-8">
            <p className="text-xs font-medium uppercase text-white/45">English</p>
            <p className="mt-5 min-h-20 text-2xl leading-relaxed text-white/90">
              {latestFinal?.translations.en || (
                <span className="text-white/20">Waiting for a complete phrase</span>
              )}
            </p>
          </div>

          {finals.length > 1 && (
            <div className="mt-12 border-t border-white/10 pt-6">
              <p className="mb-4 text-xs font-medium uppercase text-white/45">
                Recent captions
              </p>
              <div className="space-y-4">
                {finals
                  .slice(-4, -1)
                  .reverse()
                  .map((caption) => (
                    <div key={caption.chunkId} className="text-sm text-white/50">
                      <p dir="rtl" lang="ar" className="text-right">
                        {caption.source}
                      </p>
                      <p className="mt-1">{caption.translations.en}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
