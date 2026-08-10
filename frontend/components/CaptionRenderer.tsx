/**
 * Centered projector caption: the recited Arabic (RTL) above a gold divider,
 * with its translation (LTR) below — matching the Tadabbur TV mockup. Sizing is
 * fully fluid (clamp against viewport width) so one component reads correctly on
 * a phone-sized preview and on a 4K hall projector alike. The two scripts MUST
 * live in separate `dir` blocks — mixed-direction text in one node breaks
 * shaping.
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
    <div className="flex h-full w-full flex-col items-center justify-center gap-[clamp(1rem,3.5vh,2rem)] text-center">
      <div
        dir="rtl"
        lang={sourceLang}
        aria-live="polite"
        className="font-arabic font-medium text-[#f5f2ea]"
        style={{
          fontSize: "clamp(1.9rem, 4.6vw, 4.75rem)",
          lineHeight: 1.7,
          maxWidth: "20ch",
        }}
      >
        {source || <span className="text-white/25">بانتظار بداية الخطبة</span>}
      </div>

      <div className="h-[2px] w-16 shrink-0 bg-[#d4a94f] opacity-60" />

      {isQuranicHadithCandidate ? (
        <div
          className="max-w-[42ch] border-t border-[#d4a94f]/40 pt-[clamp(1rem,3vh,1.75rem)] text-[#f0e5cc]"
          style={{ fontSize: "clamp(1.05rem, 2vw, 1.9rem)", lineHeight: 1.55 }}
        >
          Quranic or hadith content detected. Its machine translation is intentionally withheld.
        </div>
      ) : (
        <div
          dir="ltr"
          lang={targetLang}
          aria-live="polite"
          className="font-medium text-[#c9d6cf]"
          style={{
            fontSize: "clamp(1.2rem, 3vw, 3rem)",
            lineHeight: 1.55,
            maxWidth: "34ch",
          }}
        >
          {targetText || <span className="text-white/25">Waiting for translation…</span>}
        </div>
      )}
    </div>
  );
}
