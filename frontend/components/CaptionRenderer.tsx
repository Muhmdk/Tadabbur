import type { Language, ServerCaptionFinal } from "@contract";

type Props = {
  caption: ServerCaptionFinal | null;
  targetLanguage: Language;
  waitingText?: string;
  isQuranActive?: boolean;
  variant?: "projector" | "attendee";
  scale?: number;
  interimSource?: string;
};

/** Live Arabic is shown first; English appears only for its finalized phrase. */
export default function CaptionRenderer({ caption, targetLanguage, waitingText = "Waiting for the speaker", isQuranActive = false, variant = "projector", scale = 1, interimSource = "" }: Props) {
  if (variant === "attendee") {
    return (
      <div className="attendee-caption rounded-2xl border border-[#aaa99b] bg-[#d5d5ca] p-5" role="status" aria-live="polite">
        {isQuranActive || caption?.isQuranicCandidate ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl bg-[#25251f]/10 font-arabic text-3xl text-[#303028]" aria-hidden="true">۞</div>
            <p className="font-semibold text-[#0f0f0f]" style={{ fontSize: `${1.5 * scale}rem`, lineHeight: 1.35 }}>Quran being read</p>
          </div>
        ) : caption?.isQuranicHadithCandidate ? (
          <div className="py-6 text-center">
            <p className="font-semibold text-[#0f0f0f]" style={{ fontSize: `${1.25 * scale}rem` }}>Scriptural passage being read</p>
            <p className="mt-3 text-sm leading-relaxed text-[#626256]">Translation is paused for this passage.</p>
          </div>
        ) : caption || interimSource ? (
          <>
            <div dir="rtl" lang="ar" className="font-arabic font-medium text-[#0f0f0f]" style={{ fontSize: `${1.4 * scale}rem`, lineHeight: 1.7 }}>{interimSource || caption?.source}</div>
            <div dir="auto" lang={targetLanguage} className="font-caption mt-3 font-medium text-[#303028]" style={{ fontSize: `${1.06 * scale}rem`, lineHeight: 1.5 }}>
              {caption?.translations[targetLanguage] || <span className="caption-listening" role="status" aria-label={interimSource ? "Translating" : undefined}>{interimSource ? "…" : waitingText}</span>}
            </div>
          </>
        ) : <p className="py-7 text-center text-[#626256]">{waitingText}</p>}
      </div>
    );
  }

  if (isQuranActive || caption?.isQuranicCandidate) {
    return <div className="projector-notice recitation-notice" role="status" aria-live="polite"><span className="recitation-symbol" aria-hidden="true">۞</span><h1>Quran being read</h1></div>;
  }
  if (caption?.isQuranicHadithCandidate) {
    return <div className="projector-notice" role="status" aria-live="polite"><h1>Scriptural passage being read</h1><p>Translation is paused for this passage.</p></div>;
  }
  return (
    <div className="projector-caption-pair" aria-live="polite">
      <section className="projector-source"><div className="caption-label mono"><span>01 / Arabic</span>{interimSource && <span className="caption-speaking">Speaking <i aria-hidden="true" /></span>}</div><p dir="rtl" lang={caption?.sourceLang ?? "ar"} className="font-arabic">{interimSource || caption?.source || <span className="caption-listening" aria-hidden="true">…</span>}</p></section>
      <section className="projector-translation"><div className="caption-label mono">02 / Translation</div><p dir="auto" lang={targetLanguage}>{caption?.translations[targetLanguage] || <span className="caption-listening" role="status" aria-label={interimSource ? "Translating" : undefined}>{interimSource ? "…" : waitingText}</span>}</p></section>
    </div>
  );
}
