"use client";

import { useEffect, useMemo, useState } from "react";
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
  if (state === "live") return "Live now";
  if (state === "ended") return "Session ended";
  return "Unavailable";
}

export default function MobileViewerPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [session, setSession] = useState<Session | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [viewerState, setViewerState] = useState<ViewerState>("connecting");
  const [partial, setPartial] = useState("");
  const [captions, setCaptions] = useState<ServerCaptionFinal[]>([]);
  const [error, setError] = useState("");

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

  const latest = captions.at(-1);
  const previous = useMemo(() => captions.slice(0, -1).reverse(), [captions]);
  const isScripture = latest?.isQuranicHadithCandidate;

  return (
    <main className="tadabbur-shell arabesque-grid min-h-screen px-4 py-5 text-[#15251e] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between px-1 pb-5">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#1e5b46] text-xl text-[#f8edd2]">ت</div><div><h1 className="font-semibold tracking-tight">Tadabbur</h1><p className="text-xs text-[#608074]">Follow along with the khutbah</p></div></div>
          <div className="flex items-center gap-2 rounded-full bg-white/70 px-3 py-2 text-xs font-medium text-[#466458]"><span className={`h-2 w-2 rounded-full ${viewerState === "live" ? "status-pulse bg-[#2f8063]" : viewerState === "error" ? "bg-[#b84a40]" : "bg-[#a1ada6]"}`} />{stateLabel(viewerState)}</div>
        </header>

        <section className="glass-panel overflow-hidden rounded-2xl">
          {session && session.targetLanguages.length > 1 && <div className="flex gap-2 overflow-x-auto border-b border-[#dce4dd] px-5 py-4"><span className="shrink-0 self-center text-xs font-semibold uppercase tracking-[.14em] text-[#6b8277]">Read in</span>{session.targetLanguages.map((target) => <button key={target} type="button" onClick={() => setLanguage(target)} className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium transition ${language === target ? "bg-[#1e5b46] text-white" : "bg-[#edf2ed] text-[#537065] hover:bg-[#dfe9e1]"}`}>{languageName(target)}</button>)}</div>}

          {error ? <div role="alert" className="m-5 rounded-xl bg-[#fff0ed] p-5 text-sm leading-relaxed text-[#9e352d]">{error}</div> : viewerState === "ended" && !latest ? <div className="p-8 sm:p-12"><p className="font-arabic text-right text-4xl text-[#1e5b46]">جزاكم الله خيراً</p><p className="mt-6 text-xl leading-relaxed text-[#3d594d]">This live translation session has ended.</p></div> : <>
            <section className="p-6 sm:p-9">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">Arabic being recited</p><p className="font-arabic text-lg text-[#547566]">العربية</p></div>
              <p dir="rtl" lang="ar" aria-live="polite" className="mt-7 min-h-32 text-right font-arabic text-4xl leading-[1.65] text-[#1c4b39] sm:text-5xl">{partial || latest?.source || <span className="text-[#aab8af]">بانتظار الخطبة</span>}</p>
              {partial && <p className="mt-4 text-xs text-[#7d978b]">Listening… translation appears once the phrase is complete.</p>}
            </section>

            <section className="border-t border-[#dce4dd] bg-[#fcfbf7] p-6 sm:p-9">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">{languageName(language)} translation</p><span className="rounded-full bg-[#edf2ed] px-2.5 py-1 text-xs font-medium text-[#537065]">{language.toUpperCase()}</span></div>
              {isScripture ? <div className="mt-7 border-l-2 border-[#c8963e] pl-5 text-lg leading-relaxed text-[#76571d]">This may be Quranic or hadith content. Machine translation is intentionally unavailable.</div> : <p aria-live="polite" className="mt-7 min-h-24 text-2xl leading-relaxed text-[#243b30] sm:text-3xl">{latest?.translations[language] || <span className="text-[#aab8af]">Waiting for a complete phrase…</span>}</p>}
            </section>
          </>}
        </section>

        {previous.length > 0 && <section className="mt-6"><div className="mb-3 flex items-center justify-between px-1"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#6b8277]">Earlier in the khutbah</p><p className="text-xs text-[#6b8277]">{previous.length} phrase{previous.length === 1 ? "" : "s"}</p></div><div className="space-y-3">{previous.map((caption) => <article key={caption.chunkId} className="glass-panel rounded-xl p-5"><p dir="rtl" lang="ar" className="text-right font-arabic text-2xl leading-relaxed text-[#365d4b]">{caption.source}</p><p className="mt-3 text-sm leading-relaxed text-[#5f786d]">{caption.isQuranicHadithCandidate ? "Translation withheld for Quranic or hadith content." : caption.translations[language] || "Translation unavailable."}</p></article>)}</div></section>}

        <p className="px-2 pb-3 pt-7 text-center text-xs leading-relaxed text-[#6b8277]">Translations support understanding; Quranic and hadith content is never machine-translated here.</p>
      </div>
    </main>
  );
}
