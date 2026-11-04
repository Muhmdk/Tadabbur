/**
 * Operator-side session memory. A prepared or live session survives a page
 * refresh or browser crash, so the operator resumes the same projector and
 * attendee links instead of preparing a new session mid-khutbah.
 */

const STORAGE_KEY = "tadabbur.operator-session";

/** The operator token stays on this device: it is what lets it speak. */
export type StoredOperatorSession = { id: string; operatorToken: string };

export function loadOperatorSession(storage: Pick<Storage, "getItem">): StoredOperatorSession | null {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredOperatorSession> | null;
    if (typeof parsed?.id === "string" && typeof parsed.operatorToken === "string") {
      return { id: parsed.id, operatorToken: parsed.operatorToken };
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
