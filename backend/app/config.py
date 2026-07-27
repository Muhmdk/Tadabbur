"""Env-backed settings. One source of truth for runtime config."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    redis_url: str = "redis://localhost:6379/0"

    speechmatics_api_key: str = ""
    deepl_api_key: str = ""
    google_application_credentials: str = ""

    # Comma-separated in env, parsed below.
    allowed_origins_raw: str = Field(
        default="http://localhost:3000",
        validation_alias="ALLOWED_ORIGINS",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]


settings = Settings()
