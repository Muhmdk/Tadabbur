"""Reject sessions that could not deliver the promised live English captions."""

import pytest
from fastapi import HTTPException

from app.api.sessions import create_session
from app.config import settings
from app.models.contract import CreateSessionRequest


@pytest.mark.asyncio
async def test_rejects_unsupported_or_empty_target_languages() -> None:
    for targets in ([], ["fr"], ["en", "fr"]):
        with pytest.raises(HTTPException) as error:
            await create_session(CreateSessionRequest(sourceLanguage="ar", targetLanguages=targets))
        assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_rejects_missing_provider_configuration(monkeypatch) -> None:
    request = CreateSessionRequest(sourceLanguage="ar", targetLanguages=["en"])
    monkeypatch.setattr(settings, "speechmatics_api_key", "")
    monkeypatch.setattr(settings, "deepl_api_key", "")
    monkeypatch.setattr(settings, "google_application_credentials", "")
    with pytest.raises(HTTPException) as error:
        await create_session(request)
    assert error.value.status_code == 503
    assert "transcription" in error.value.detail.lower()

    monkeypatch.setattr(settings, "speechmatics_api_key", "configured")
    with pytest.raises(HTTPException) as error:
        await create_session(request)
    assert error.value.status_code == 503
    assert "translation" in error.value.detail.lower()
