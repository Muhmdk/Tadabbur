"""Local-only scripted run through the real API, pipeline, and WebSockets.

Run: .venv/Scripts/python.exe -m uvicorn simulate:app --host 0.0.0.0 --port 8000
No audio is captured and no external transcription/translation calls are made.
"""

import asyncio
import time
from collections.abc import AsyncIterator

import fakeredis.aioredis

from app import main, redis_client
from app.config import settings
from app.pipeline import session as pipeline
from app.pipeline.asr.base import ASRTranscript

# Original illustrative sermon prose, plus one Quran passage to exercise suppression.
PHRASES = [
    ("نجتمع اليوم لنتحدث عن الرحمة وحسن التعامل مع الناس.",
     "Today we gather to reflect on compassion and treating others with kindness."),
    ("الكلمة الطيبة قد تخفف عن إنسان يحمل هما لا نعرفه.",
     "A kind word can ease a burden that someone carries in silence."),
    ("لنبدأ بأهل بيوتنا وجيراننا ومن نلقاهم في طريقنا.",
     "Let us begin with our families, our neighbours, and those we meet each day."),
    ("قل هو الله أحد", None),
    ("ومن صور الرحمة أن نصغي إلى الآخرين باهتمام وصبر.",
     "One expression of compassion is listening to others with care and patience."),
    ("قد تختلف لغاتنا ولكن حاجتنا إلى الفهم تجمعنا.",
     "Our languages may differ, but our need for understanding brings us together."),
    ("فلنجعل هذا الأسبوع فرصة لمساعدة شخص يحتاج إلينا.",
     "Let us make this week an opportunity to help someone who needs us."),
    ("نسأل الله أن يجعل لقاءنا سببا للخير والتعاون بيننا.",
     "We ask Allah to make our gathering a source of goodness and mutual support."),
]


class ScriptedASR:
    def __init__(self, api_key: str) -> None:
        self.stopped = asyncio.Event()

    async def open(self, source_language: str) -> None:
        if source_language != "ar":
            raise ValueError("The simulation supports Arabic only.")

    async def feed_audio(self, chunk: bytes) -> None:
        # Simulation deliberately ignores audio: only the script is transcribed.
        return

    async def pause(self, seconds: float) -> bool:
        try:
            await asyncio.wait_for(self.stopped.wait(), seconds)
            return True
        except TimeoutError:
            return False

    async def transcripts(self) -> AsyncIterator[ASRTranscript]:
        if await self.pause(2):
            return
        index = 0
        while not self.stopped.is_set():
            for arabic, _ in PHRASES:
                words = arabic.split()
                for end in range(2, len(words) + 2, 2):
                    if await self.pause(0.8):
                        return
                    yield ASRTranscript(" ".join(words[:end]), "ar", False,
                                        str(index), int(time.time() * 1000))
                yield ASRTranscript(arabic, "ar", True, str(index), int(time.time() * 1000))
                yield ASRTranscript("", "ar", True, str(index), int(time.time() * 1000),
                                    ends_utterance=True)
                index += 1
                if await self.pause(7):
                    return

    async def close(self) -> None:
        self.stopped.set()


class ScriptedTranslation:
    async def translate_to_all(self, text: str, source_lang: str,
                               targets: list[str]) -> dict[str, str]:
        english = dict(PHRASES).get(text)
        if english is None or source_lang != "ar" or targets != ["en"]:
            raise ValueError("Unexpected phrase in local simulation.")
        await asyncio.sleep(0.35)
        return {"en": english}


def simulation_redis():
    redis_client._client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    return redis_client._client


async def self_check() -> None:
    from app.pipeline.quran import is_quranic_candidate

    translator = ScriptedTranslation()
    for arabic, english in PHRASES:
        assert is_quranic_candidate(arabic) == (english is None)
        if english is not None:
            assert await translator.translate_to_all(arabic, "ar", ["en"]) == {"en": english}
    asr = ScriptedASR("")
    await asr.open("ar")

    async def immediate(seconds: float) -> bool:
        return asr.stopped.is_set()

    asr.pause = immediate
    saw_partial = False
    async for event in asr.transcripts():
        saw_partial |= not event.is_final
        if event.is_final:
            assert event.text == PHRASES[0][0]
            break
    assert saw_partial
    await asr.close()
    assert asr.stopped.is_set()
    async with main.lifespan(app):
        first = await live_demo()
        second = await live_demo()
        assert first.id == DEMO_SESSION_ID
        assert first.status == "live"
        assert first == second
        assert len(pipeline._runtimes) == 1
    assert not pipeline._runtimes
    print("Simulation check passed: scripted captions, translations, Quran suppression, shutdown.")


# Explicit local entrypoint; app.main remains the real provider-backed application.
settings.speechmatics_api_key = "local-simulation"
settings.deepl_api_key = "local-simulation"
main.init_redis = simulation_redis
pipeline.SpeechmaticsASR = ScriptedASR
pipeline._build_router = ScriptedTranslation
app = main.app
app.title = "Tadabbur — LOCAL SIMULATION (scripted captions, no microphone)"


# A server-owned fixture keeps the shared demo running independently of browser tabs.
DEMO_SESSION_ID = "cf7c863ddeef47159d1ca82f51be96f9"
_demo_lock = asyncio.Lock()


@app.get("/api/demo", response_model=pipeline.Session)
async def live_demo() -> pipeline.Session:
    from datetime import UTC, datetime

    async with _demo_lock:
        session = await pipeline.session_store.get(DEMO_SESSION_ID)
        if session is None or not pipeline.has_runtime(DEMO_SESSION_ID):
            session = pipeline.Session(
                id=DEMO_SESSION_ID, sourceLanguage="ar", targetLanguages=["en"],
                status="pending", createdAt=datetime.now(UTC).isoformat(),
            )
            runtime = await pipeline.open_session(session)
            session = runtime.session
        return session


if __name__ == "__main__":
    import sys

    if sys.argv[1:] != ["--check"]:
        raise SystemExit("Use uvicorn simulate:app, or python simulate.py --check")
    asyncio.run(self_check())
    raise SystemExit(0)


