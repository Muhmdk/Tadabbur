import type { Language, ServerCaptionFinal } from "@contract";

type Props = {
  caption: ServerCaptionFinal | null;
  targetLanguage: Language;
  waitingText?: string;
  isQuranActive?: boolean;
  variant?: "projector" | "attendee";
  scale?: number;
};

/** Public captions appear only after classification of a complete phrase. */
export default function CaptionRenderer({ caption, targetLanguage, waitingText = "Listening for the next phrase…", isQuranActive = false, variant = "projector", scale = 1 }: Props) {
  if (variant === "attendee") {
    return (
      <div className="rise-in rounded-2xl border border-[#2a4139] bg-[#162920] p-5" role="status" aria-live="polite">
        {isQuranActive || caption?.isQuranicCandidate ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl bg-[#d4a94f]/10 font-arabic text-3xl text-[#e6c374]" aria-hidden="true">۞</div>
            <p className="font-semibold text-[#f5f2ea]" style={{ fontSize: `${1.5 * scale}rem`, lineHeight: 1.35 }}>Quran being read</p>
          </div>
        ) : caption?.isQuranicHadithCandidate ? (
          <div className="py-6 text-center">
            <p className="font-semibold text-[#f5f2ea]" style={{ fontSize: `${1.25 * scale}rem` }}>Scriptural passage being read</p>
            <p className="mt-3 text-sm leading-relaxed text-[#9db3aa]">Translation is paused for this passage.</p>
          </div>
        ) : caption ? (
          <>
            <div dir="rtl" lang="ar" className="font-arabic font-medium text-[#f5f2ea]" style={{ fontSize: `${1.4 * scale}rem`, lineHeight: 1.7 }}>{caption.source}</div>
            <div dir="auto" lang={targetLanguage} className="mt-3 font-medium text-[#e6c374]" style={{ fontSize: `${1.06 * scale}rem`, lineHeight: 1.5 }}>
              {caption.translations[targetLanguage] || "Translation unavailable for this phrase."}
            </div>
          </>
        ) : <p className="py-7 text-center text-[#9db3aa]">{waitingText}</p>}
      </div>
    );
  }

  if (isQuranActive || caption?.isQuranicCandidate) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center text-center" role="status" aria-live="polite">
        <div className="mb-7 grid h-16 w-16 place-items-center rounded-2xl border border-[#d4a94f]/40 bg-[#d4a94f]/10 font-arabic text-4xl text-[#e6c374]" aria-hidden="true">۞</div>
        <p className="text-[clamp(2rem,5vw,5rem)] font-semibold leading-tight tracking-tight text-[#f5f2ea]">Quran being read</p>
      </div>
    );
  }

  if (caption?.isQuranicHadithCandidate) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center text-center" role="status" aria-live="polite">
        <p className="text-[clamp(1.8rem,4vw,4rem)] font-semibold leading-tight text-[#f5f2ea]">Scriptural passage being read</p>
        <p className="mt-5 max-w-[40ch] text-[clamp(1rem,1.7vw,1.45rem)] leading-relaxed text-[#9db3aa]">Translation is paused for this passage.</p>
      </div>
    );
  }

  if (!caption) {
    return <p className="max-w-[28ch] text-center text-[clamp(1.4rem,3vw,2.8rem)] leading-snug text-[#9db3aa]" role="status">{waitingText}</p>;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[clamp(1rem,3.5vh,2rem)] text-center" aria-live="polite">
      <div dir="rtl" lang={caption.sourceLang} className="max-w-[26ch] font-arabic font-medium leading-[1.65] text-[#f5f2ea]" style={{ fontSize: "clamp(1.6rem,4.1vw,4.5rem)" }}>
        {caption.source}
      </div>
      <div className="h-[2px] w-16 shrink-0 bg-[#d4a94f] opacity-70" aria-hidden="true" />
      <div dir="auto" lang={targetLanguage} className="max-w-[36ch] font-medium leading-[1.5] text-[#e6ded0]" style={{ fontSize: "clamp(1.25rem,2.8vw,3rem)" }}>
        {caption.translations[targetLanguage] || <span className="text-[#9db3aa]">Translation unavailable for this phrase.</span>}
      </div>
    </div>
  );
}
