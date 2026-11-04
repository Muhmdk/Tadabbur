"""The Pydantic mirror must match shared/contract/index.ts (CLAUDE.md §4)."""

import json
import re
from pathlib import Path

from pydantic import BaseModel

from app.models import contract
from app.models.contract import ServerCaptionFinal, ServerSessionState, to_wire

_INDEX_TS = Path(__file__).resolve().parents[2] / "shared" / "contract" / "index.ts"
_INTERFACE = re.compile(r"export interface (\w+)(?: extends (\w+))? \{(.*?)\n\}", re.S)
_FIELD = re.compile(r"^\s*(\w+)(\?)?:", re.M)


def _ts_interfaces() -> dict[str, dict[str, bool]]:
    """interface name -> {field: optional}, with `extends` resolved."""
    source = _INDEX_TS.read_text(encoding="utf-8")
    body_without_comments = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
    found: dict[str, tuple[str | None, dict[str, bool]]] = {}
    for name, parent, body in _INTERFACE.findall(body_without_comments):
        found[name] = (parent or None, {f: bool(q) for f, q in _FIELD.findall(body)})

    def resolve(name: str) -> dict[str, bool]:
        parent, fields = found[name]
        return {**(resolve(parent) if parent else {}), **fields}

    return {name: resolve(name) for name in found}


def test_every_wire_shape_matches_the_typescript_contract() -> None:
    interfaces = _ts_interfaces()
    assert interfaces, "no interfaces parsed from index.ts"
    for name, ts_fields in interfaces.items():
        model = getattr(contract, name, None)
        assert isinstance(model, type) and issubclass(model, BaseModel), f"{name} not mirrored"
        py_fields = {f: not info.is_required() for f, info in model.model_fields.items()}
        assert py_fields == ts_fields, f"{name} drifted: TS {ts_fields} vs Python {py_fields}"


def test_contract_versions_match() -> None:
    source = _INDEX_TS.read_text(encoding="utf-8")
    ts_version = re.search(r'CONTRACT_VERSION = "([^"]+)"', source).group(1)
    assert ts_version == contract.CONTRACT_VERSION


def test_unset_optional_fields_are_omitted_not_null() -> None:
    state = json.loads(
        to_wire(ServerSessionState(type="session.state", sessionId="s", state="live"))
    )
    assert "error" not in state
    final = json.loads(
        to_wire(
            ServerCaptionFinal(
                type="caption.final",
                sessionId="s",
                chunkId="c",
                source="x",
                sourceLang="ar",
                translations={},
                timestamp=1,
            )
        )
    )
    assert "isQuranicCandidate" not in final and "isQuranicHadithCandidate" not in final
    assert final["translations"] == {}  # empty but present: required by the contract
