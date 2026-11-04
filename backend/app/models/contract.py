"""Pydantic mirror of shared/contract/index.ts.

THIS FILE MUST STAY IN SYNC WITH shared/contract/index.ts.
See CLAUDE.md §4 and shared/contract/README.md.
"""

from typing import Literal

from pydantic import BaseModel, Field

CONTRACT_VERSION = "0.3.0"

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


class CreateSessionResponse(Session):
    # Secret that lets the control screen attach as the speaker. Never log it or
    # put it in a URL; the public session id only grants read-only viewing.
    operatorToken: str


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
    operatorToken: str | None = None  # required when role == "speaker"


class ClientStop(BaseModel):
    type: Literal["session.stop"]
    sessionId: SessionId


class ClientRecitationMode(BaseModel):
    type: Literal["session.recitation"]
    sessionId: SessionId
    active: bool


ClientMessage = ClientAttach | ClientStop | ClientRecitationMode


# ---------- WS: server -> client ----------

# "connecting": a live session has no speaker attached right now (operator
# reconnecting or worker restart). Only "ended" is final. Mirrors index.ts.
SessionState = Literal["connecting", "ready", "live", "ended", "error"]


class ServerSessionState(BaseModel):
    type: Literal["session.state"]
    sessionId: SessionId
    state: SessionState
    error: str | None = None


class ServerRecitationState(BaseModel):
    type: Literal["recitation.state"]
    sessionId: SessionId
    active: bool


class ServerCaptionPartial(BaseModel):
    type: Literal["caption.partial"]
    sessionId: SessionId
    chunkId: str
    text: str
    lang: Language
    timestamp: int
    isQuranicCandidate: bool | None = Field(default=None)


class ServerCaptionFinal(BaseModel):
    type: Literal["caption.final"]
    sessionId: SessionId
    chunkId: str
    source: str
    sourceLang: Language
    translations: dict[Language, str]
    timestamp: int
    isQuranicHadithCandidate: bool | None = Field(default=None)
    isQuranicCandidate: bool | None = Field(default=None)


ServerMessage = (
    ServerSessionState | ServerRecitationState | ServerCaptionPartial | ServerCaptionFinal
)


def to_wire(message: BaseModel) -> str:
    """Serialize a message for the network.

    Optional fields that are unset are omitted, matching the `field?: type`
    declarations in index.ts, instead of being sent as `null`.
    """
    return message.model_dump_json(exclude_none=True)
