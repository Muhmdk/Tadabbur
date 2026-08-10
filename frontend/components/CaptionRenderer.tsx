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
  targetLanguage?: Language;
};

export default function CaptionRenderer({
  source,
  sourceLang,
  translations,
  isQuranicHadithCandidate,
  targetLanguage,
}: Props) {
  const targetLang = targetLanguage ?? Object.keys(translations)[0];
  const targetText = targetLang ? translations[targetLang] : "";

  return (
    <div className="flex h-full w-full flex-col items-stretch justify-center gap-8 lg:gap-12">
      <div
        dir="rtl"
        lang={sourceLang}
        aria-live="polite"
        className="text-right font-arabic text-5xl leading-[1.55] text-white sm:text-6xl lg:text-7xl xl:text-8xl"
      >
        {source || <span className="text-white/30">بانتظار الخطبة</span>}
      </div>

      {isQuranicHadithCandidate ? (
        <div className="border-l-2 border-[#d5ad68] py-1 pl-5 text-xl leading-relaxed text-[#f0e5cc] sm:text-2xl lg:text-3xl">
          Quranic or hadith content detected. Its machine translation is intentionally withheld.
        </div>
      ) : (
        <div dir="ltr" lang={targetLang} aria-live="polite" className="max-w-[32ch] text-3xl leading-relaxed text-[#fcfaf4] sm:text-4xl lg:text-5xl xl:text-6xl">
          {targetText || <span className="text-white/30">Waiting for translation…</span>}
        </div>
      )}
    </div>
  );
}
