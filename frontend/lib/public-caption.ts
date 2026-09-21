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
 * Hold a Quran notice across ASR clause boundaries. A new partial is not yet
 * classified, so it cannot safely clear the last confirmed recitation.
 */
export function selectPublicCaption(
  latest: ServerCaptionFinal | null,
  partialState: PartialCaptionState,
  manualQuran: boolean,
): { caption: ServerCaptionFinal | null; isQuranActive: boolean } {
  return {
    caption: partialState === "none" ? latest : null,
    isQuranActive: manualQuran || partialState === "quran" || Boolean(latest?.isQuranicCandidate),
  };
}
