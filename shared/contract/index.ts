/**
 * Wire contract — source of truth for WebSocket messages and REST payloads.
 *
 * Both backend (mirrored as Pydantic in backend/app/models/contract.py) and
 * frontend (imported via frontend/types/contract.ts) MUST conform to these
 * shapes. See CLAUDE.md §4 — any change starts here.
 */

export const CONTRACT_VERSION = "0.1.0";

// ---------- Domain primitives ----------

export type SessionId = string;
/** BCP-47 language tag, e.g. "ar", "en", "ur". */
export type Language = string;

export type SessionStatus = "pending" | "live" | "ended";

export interface Session {
  id: SessionId;
  sourceLanguage: Language;
  targetLanguages: Language[];
  status: SessionStatus;
  /** ISO-8601 UTC timestamp. */
  createdAt: string;
}

// ---------- REST ----------

export interface CreateSessionRequest {
  sourceLanguage: Language;
  targetLanguages: Language[];
}

export interface HealthResponse {
  status: "ok";
  version: string;
}

// ---------- WebSocket: client → server ----------
//
// Speaker clients send one JSON `session.attach` frame, then raw binary audio
// chunks. Viewer clients send `session.attach` and receive only.

export type SpeakerRole = "speaker" | "viewer";

export interface ClientAttach {
  type: "session.attach";
  sessionId: SessionId;
  role: SpeakerRole;
}

export interface ClientStop {
  type: "session.stop";
  sessionId: SessionId;
}

export type ClientMessage = ClientAttach | ClientStop;

// ---------- WebSocket: server → client ----------

export type SessionState =
  | "connecting"
  | "ready"
  | "live"
  | "ended"
  | "error";

export interface ServerSessionState {
  type: "session.state";
  sessionId: SessionId;
  state: SessionState;
  /** Populated when state === "error". */
  error?: string;
}

/**
 * Interim transcript update. Source language only — translations are produced
 * on clause boundaries and emitted via `caption.final`.
 */
export interface ServerCaptionPartial {
  type: "caption.partial";
  sessionId: SessionId;
  chunkId: string;
  text: string;
  lang: Language;
  /** Server epoch ms. */
  timestamp: number;
}

/**
 * Finalized clause with translations.
 *
 * `isQuranicHadithCandidate` flags content that the pipeline heuristically
 * identifies as scripture or hadith. The display layer should suppress or
 * specially render the machine translation in that case — see CLAUDE.md §9.
 */
export interface ServerCaptionFinal {
  type: "caption.final";
  sessionId: SessionId;
  chunkId: string;
  source: string;
  sourceLang: Language;
  /** Keyed by BCP-47 target language. */
  translations: Record<Language, string>;
  timestamp: number;
  isQuranicHadithCandidate?: boolean;
}

export type ServerMessage =
  | ServerSessionState
  | ServerCaptionPartial
  | ServerCaptionFinal;
