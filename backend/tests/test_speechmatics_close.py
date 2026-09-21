"""A broken upstream stop must not strand the transcript consumer."""

import pytest

from app.pipeline.asr.speechmatics import SpeechmaticsASR


@pytest.mark.asyncio
async def test_close_unblocks_transcripts_when_upstream_stop_fails() -> None:
    class BrokenClient:
        async def stop_session(self) -> None:
            raise RuntimeError("upstream failed")

        async def close(self) -> None:
            pass

    asr = SpeechmaticsASR("test-key")
    asr._client = BrokenClient()
    with pytest.raises(RuntimeError):
        await asr.close()
    assert [event async for event in asr.transcripts()] == []
