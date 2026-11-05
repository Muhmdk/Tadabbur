import type { ServerCaptionFinal } from "@contract";

export type PartialCaptionState = "none" | "listening" | "quran";

/** Once a partial is identified as Quran, retain the notice until a final. */
export function nextPartialCaptionState(
  current: PartialCaptionState,
  isQuranCandidate: boolean,
): PartialCaptionState {
  return isQuranCandidate || current === "quran" ? "quran" : "listening";
}

/**
 * Keep live Arabic and finalized translations paired to the same phrase.
 * Recitation remains latched until ordinary speech is finalized.
 */
export function selectPublicCaption(
  latest: ServerCaptionFinal | null,
  partialState: PartialCaptionState,
  manualQuran: boolean,
  partialText = "",
): { caption: ServerCaptionFinal | null; isQuranActive: boolean; interimSource: string } {
  const isQuranActive = manualQuran || partialState === "quran" || Boolean(latest?.isQuranicCandidate);
  return {
    caption: partialState === "listening" && !latest?.isQuranicHadithCandidate ? null : latest,
    isQuranActive,
    interimSource: !isQuranActive && !latest?.isQuranicHadithCandidate && partialState === "listening"
      ? partialText : "",
  };
}
