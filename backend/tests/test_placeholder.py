"""Placeholder test — confirms pytest is wired. Replace as real tests land."""

from app.models.contract import CONTRACT_VERSION


def test_contract_version_present() -> None:
    assert CONTRACT_VERSION
