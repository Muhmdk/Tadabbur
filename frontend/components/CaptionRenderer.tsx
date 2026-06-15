/**
 * Renders the source (RTL) above the translation (LTR). Sized for projector
 * legibility from the back of a prayer hall. The two scripts MUST live in
 * separate `dir` blocks — mixed-direction text in one node breaks shaping.
 *
 * TODO: handle multi-target rendering (currently shows one target), font
 * loading for Arabic, and a graceful empty state.
 */

import type { Language } from "@contract";

type Props = {
  sessionId: string;
  source: string;
  sourceLang: Language;
  translations: Record<Language, string>;
  isQuranicHadithCandidate?: boolean;
};

export default function CaptionRenderer({
  source,
  sourceLang,
  translations,
  isQuranicHadithCandidate,
}: Props) {
  const targetLang = Object.keys(translations)[0];
  const targetText = targetLang ? translations[targetLang] : "";

  return (
    <div className="flex h-full w-full flex-col items-stretch justify-center gap-10">
      <div
        dir="rtl"
        lang={sourceLang}
        className="text-6xl leading-snug font-arabic"
      >
        {source || <span className="text-white/30">…</span>}
      </div>

      {/* CLAUDE.md §9: do not show machine translation for likely scripture. */}
      {isQuranicHadithCandidate ? (
        <div className="text-2xl text-white/50">
          {/* TODO: substitute an established published translation here. */}
          Scripture detected — translation suppressed.
        </div>
      ) : (
        <div dir="ltr" lang={targetLang} className="text-4xl leading-snug">
          {targetText || <span className="text-white/30">…</span>}
        </div>
      )}
    </div>
  );
}
