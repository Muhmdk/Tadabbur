/**
 * Operator-side session memory. A prepared or live session survives a page
 * refresh or browser crash, so the operator resumes the same projector and
 * attendee links instead of preparing a new session mid-khutbah.
 */

const STORAGE_KEY = "tadabbur.operator-session";

export type StoredOperatorSession = { id: string };

export function loadOperatorSession(storage: Pick<Storage, "getItem">): StoredOperatorSession | null {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (parsed && typeof parsed === "object" && typeof (parsed as StoredOperatorSession).id === "string") {
      return { id: (parsed as StoredOperatorSession).id };
    }
  } catch {
    // A corrupt entry is treated as no stored session.
  }
  return null;
}

export function saveOperatorSession(storage: Pick<Storage, "setItem">, session: StoredOperatorSession): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearOperatorSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(STORAGE_KEY);
}

/** Backoff for speaker reconnects: 0.5 s, 1 s, 2 s, 4 s, then every 5 s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(5000, 500 * 2 ** Math.max(0, attempt));
}
