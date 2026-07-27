"""Pydantic mirror of shared/contract/index.ts.

THIS FILE MUST STAY IN SYNC WITH shared/contract/index.ts.
See CLAUDE.md §4 and shared/contract/README.md.
"""

from typing import Literal

from pydantic import BaseModel, Field

CONTRACT_VERSION = "0.1.0"

# ---------- Domain primitives ----------

SessionId = str
Language = str  # BCP-47 e.g. "ar", "en", "ur"

SessionStatus = Literal["pending", "live", "ended"]


class Session(BaseModel):
    id: SessionId
    sourceLanguage: Language
    targetLanguages: list[Language]
    status: SessionStatus
    createdAt: str  # ISO-8601


# ---------- REST ----------


class CreateSessionRequest(BaseModel):
    sourceLanguage: Language
    targetLanguages: list[Language]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


# ---------- WS: client -> server ----------

# Raw audio format for speaker -> server binary frames on /ws/audio.
# Mirrors AUDIO_FORMAT in shared/contract/index.ts. The upstream ASR
# (Speechmatics real-time) accepts only raw PCM: signed 16-bit little-endian,
# mono, 16 kHz. The frontend mic capture must produce exactly this.
AUDIO_SAMPLE_RATE_HZ = 16000
AUDIO_CHANNELS = 1
AUDIO_ENCODING = "pcm_s16le"

SpeakerRole = Literal["speaker", "viewer"]


class ClientAttach(BaseModel):
    type: Literal["session.attach"]
    sessionId: SessionId
    role: SpeakerRole


class ClientStop(BaseModel):
    type: Literal["session.stop"]
    sessionId: SessionId


ClientMessage = ClientAttach | ClientStop


# ---------- WS: server -> client ----------

SessionState = Literal["connecting", "ready", "live", "ended", "error"]


class ServerSessionState(BaseModel):
    type: Literal["session.state"]
    sessionId: SessionId
    state: SessionState
    error: str | None = None


class ServerCaptionPartial(BaseModel):
    type: Literal["caption.partial"]
    sessionId: SessionId
    chunkId: str
    text: str
    lang: Language
    timestamp: int


class ServerCaptionFinal(BaseModel):
    type: Literal["caption.final"]
    sessionId: SessionId
    chunkId: str
    source: str
    sourceLang: Language
    translations: dict[Language, str]
    timestamp: int
    isQuranicHadithCandidate: bool | None = Field(default=None)


ServerMessage = ServerSessionState | ServerCaptionPartial | ServerCaptionFinal
