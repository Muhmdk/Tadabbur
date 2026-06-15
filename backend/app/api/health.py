"""Liveness/readiness probe. Cheap, no dependencies."""

from fastapi import APIRouter

from app.models.contract import CONTRACT_VERSION, HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=CONTRACT_VERSION)
