"""
Tests for chat_nlp_endpoint — F-01 / ADR-0016 direct Modal invoke for chat NLP.

Because ``modal`` is stubbed by conftest.py, ``@modal.fastapi_endpoint`` is a
passthrough, so ``chat_nlp_endpoint`` is a plain async function callable with
keyword args (same pattern as llm-gateway description_requested_endpoint tests).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from main import _valid_bearer, chat_nlp_endpoint, process_chat_message

_VALID_BODY: dict = {
    "tenant_id": "tenant-abc",
    "session_id": "s" * 32,
    "message": {"role": "user", "content": "Looking for high yield in Madrid"},
    "profiling_opt_out": False,
}


@pytest.fixture(autouse=True)
def internal_api_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "test-internal-secret")


def test_valid_bearer_correct_token_passes() -> None:
    assert _valid_bearer("Bearer test-internal-secret") is True


def test_valid_bearer_missing_header_fails() -> None:
    assert _valid_bearer(None) is False


def test_valid_bearer_wrong_token_fails() -> None:
    assert _valid_bearer("Bearer wrong-token") is False


def test_valid_bearer_empty_secret_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "")
    assert _valid_bearer("Bearer anything") is False


async def test_missing_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await chat_nlp_endpoint(body=_VALID_BODY, authorization=None)
    assert exc_info.value.status_code == 401


async def test_wrong_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await chat_nlp_endpoint(body=_VALID_BODY, authorization="Bearer wrong-token")
    assert exc_info.value.status_code == 401


async def test_missing_fields_returns_400() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await chat_nlp_endpoint(
            body={"tenant_id": "t"},
            authorization="Bearer test-internal-secret",
        )
    assert exc_info.value.status_code == 400


async def test_empty_message_content_returns_400() -> None:
    body = {
        **_VALID_BODY,
        "message": {"role": "user", "content": "   "},
    }
    with pytest.raises(HTTPException) as exc_info:
        await chat_nlp_endpoint(body=body, authorization="Bearer test-internal-secret")
    assert exc_info.value.status_code == 400


async def test_valid_request_returns_202_and_spawns(monkeypatch: pytest.MonkeyPatch) -> None:
    spawn_mock = MagicMock()
    monkeypatch.setattr(process_chat_message, "spawn", spawn_mock)

    response = await chat_nlp_endpoint(
        body=_VALID_BODY,
        authorization="Bearer test-internal-secret",
    )
    assert response.status_code == 202
    spawn_mock.assert_called_once_with(
        tenant_id="tenant-abc",
        session_id="s" * 32,
        message={"role": "user", "content": "Looking for high yield in Madrid"},
        profiling_opt_out=False,
    )


async def test_profiling_opt_out_forwarded(monkeypatch: pytest.MonkeyPatch) -> None:
    spawn_mock = MagicMock()
    monkeypatch.setattr(process_chat_message, "spawn", spawn_mock)

    body = {**_VALID_BODY, "profiling_opt_out": True}
    response = await chat_nlp_endpoint(body=body, authorization="Bearer test-internal-secret")
    assert response.status_code == 202
    assert spawn_mock.call_args.kwargs["profiling_opt_out"] is True
