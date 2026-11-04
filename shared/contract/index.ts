/**
 * Wire contract — source of truth for WebSocket messages and REST payloads.
 *
 * Both backend (mirrored as Pydantic in backend/app/models/contract.py) and
 * frontend (imported via frontend/types/contract.ts) MUST conform to these
 * shapes. See CLAUDE.md §4 — any change starts here.
 */

export const CONTRACT_VERSION = "0.3.0";

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
  /** Current Friday workflow accepts Arabic ("ar"). */
  sourceLanguage: Language;
  /** Current operator workflow supports English ("en"). */
  targetLanguages: Language[];
}

/**
 * Response to `POST /api/sessions`. `operatorToken` is a secret that lets the
 * control screen attach as the speaker. Keep it on the operator's device only:
 * never put it in a URL, QR code, or log. The public session id alone grants
 * read-only viewing.
 */
export interface CreateSessionResponse extends Session {
  operatorToken: string;
}

export interface HealthResponse {
  status: "ok";
  version: string;
}

// ---------- WebSocket: client → server ----------
//
// Speaker clients send one JSON `session.attach` frame, then raw binary audio
// chunks in AUDIO_FORMAT (below). Viewer clients send `session.attach` and
// receive only.

/**
 * Raw audio format for speaker → server binary frames on `/ws/audio`.
 *
 * The upstream ASR (Speechmatics real-time) accepts only raw PCM — no
 * webm/opus — so the mic capture MUST emit signed 16-bit little-endian PCM,
 * mono, at 16 kHz. Use the Web Audio API / AudioWorklet, not MediaRecorder.
 * Backend mirror: AUDIO_* constants in backend/app/models/contract.py.
 */
export const AUDIO_FORMAT = {
  sampleRateHz: 16000,
  channels: 1,
  /** Signed 16-bit little-endian PCM. */
  encoding: "pcm_s16le",
} as const;

export type SpeakerRole = "speaker" | "viewer";

export interface ClientAttach {
  type: "session.attach";
  sessionId: SessionId;
  role: SpeakerRole;
  /** Required when `role` is "speaker"; from `CreateSessionResponse`. */
  operatorToken?: string;
}

export interface ClientStop {
  type: "session.stop";
  sessionId: SessionId;
}

/** Speaker-only manual Quran recitation override. */
export interface ClientRecitationMode {
  type: "session.recitation";
  sessionId: SessionId;
  active: boolean;
}

export type ClientMessage = ClientAttach | ClientStop | ClientRecitationMode;

// ---------- WebSocket: server → client ----------

/**
 * `connecting` is broadcast while a live session has no speaker attached (the
 * operator's connection dropped or a worker restarted). The session is still
 * live; viewers should show a reconnecting notice and keep listening. Only
 * `ended` (an explicit operator stop) is final.
 */
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

/** Manual recitation override state, broadcast to all viewers. */
export interface ServerRecitationState {
  type: "recitation.state";
  sessionId: SessionId;
  active: boolean;
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
  /** A Quran verse match was found in the interim Arabic transcript. */
  isQuranicCandidate?: boolean;
}

/**
 * Finalized clause with translations.
 *
 * `isQuranicHadithCandidate` flags content that the pipeline heuristically
 * identifies as scripture or hadith. The display layer should suppress or
 * specially render the machine translation in that case — see CLAUDE.md §9.
 * `isQuranicCandidate` specifically marks a Quran verse match. Clients should
 * replace the caption with a recitation notice and never show a machine
 * translation for this clause.
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
  isQuranicCandidate?: boolean;
}

export type ServerMessage =
  | ServerSessionState
  | ServerRecitationState
  | ServerCaptionPartial
  | ServerCaptionFinal;
