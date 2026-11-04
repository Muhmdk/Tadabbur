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
 * The latest completed caption stays on screen until the next final replaces
 * it, so attendees can read it while the khatib continues speaking. Only the
 * Quran notice depends on the in-progress phrase: it holds across ASR clause
 * boundaries, because a new partial is not yet classified and so cannot
 * safely clear the last confirmed recitation.
 */
export function selectPublicCaption(
  latest: ServerCaptionFinal | null,
  partialState: PartialCaptionState,
  manualQuran: boolean,
): { caption: ServerCaptionFinal | null; isQuranActive: boolean } {
  return {
    caption: latest,
    isQuranActive: manualQuran || partialState === "quran" || Boolean(latest?.isQuranicCandidate),
  };
}
