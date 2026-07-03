"""
Tests for description_requested_endpoint — ADR-0016 / FOLLOW-485 direct Modal invocation.

The prod Redpanda cluster is Serverless, whose HTTP Proxy is BYOC/Dedicated-only (out
of pilot budget), so the control-plane now POSTs description.requested events directly
to this authenticated Modal web endpoint instead of publishing to Redpanda.

Because ``modal`` is stubbed by conftest.py (see _make_modal_stub), the
``@modal.fastapi_endpoint(method="POST")`` decorator is a passthrough no-op, so
``description_requested_endpoint`` is the plain async Python function below — callable
directly with keyword args, bypassing FastAPI's request-parsing machinery entirely
(mirrors the existing `_run_job` extraction pattern used for the Redpanda job body).

Test plan:
  TC-1  Missing Authorization header → HTTPException 401.
  TC-2  Wrong bearer token → HTTPException 401.
  TC-3  Invalid payload (missing a REQUIRED_FIELDS key) → HTTPException 400.
  TC-4  Valid bearer + valid payload → 202 JSONResponse, generate_description.spawn
        called once with the exact body (mocked — no real Modal spawn).
  TC-5  _valid_bearer unit coverage: correct/incorrect scheme, empty secret fails closed.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

_SRC_DIR = Path(__file__).parent.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from jobs.generate_description import (
    description_requested_endpoint,
    generate_description,
    _valid_bearer,
)

_VALID_BODY: dict[str, str] = {
    "tenant_id": "tenant-abc",
    "listing_id": "listing-123",
    "archetype": "yield_hunter",
    "cache_key": "desc:tenant-abc:listing-123:yield_hunter:en",
    "original_description": "3-bed flat with sitting tenant in central area.",
}


@pytest.fixture(autouse=True)
def internal_api_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "test-internal-secret")


# ---------------------------------------------------------------------------
# TC-5: _valid_bearer unit coverage
# ---------------------------------------------------------------------------


def test_valid_bearer_correct_token_passes() -> None:
    assert _valid_bearer("Bearer test-internal-secret") is True


def test_valid_bearer_missing_header_fails() -> None:
    assert _valid_bearer(None) is False


def test_valid_bearer_wrong_token_fails() -> None:
    assert _valid_bearer("Bearer wrong-token") is False


def test_valid_bearer_wrong_scheme_fails() -> None:
    assert _valid_bearer("Basic test-internal-secret") is False


def test_valid_bearer_empty_secret_env_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "")
    assert _valid_bearer("Bearer anything") is False


# ---------------------------------------------------------------------------
# TC-1 / TC-2: 401 on missing/invalid bearer
# ---------------------------------------------------------------------------


async def test_missing_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await description_requested_endpoint(body=_VALID_BODY, authorization=None)
    assert exc_info.value.status_code == 401


async def test_wrong_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await description_requested_endpoint(body=_VALID_BODY, authorization="Bearer wrong-token")
    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# TC-3: 400 on invalid payload
# ---------------------------------------------------------------------------


async def test_invalid_payload_missing_fields_returns_400() -> None:
    incomplete_body = {"tenant_id": "tenant-abc"}  # missing listing_id, archetype, etc.
    with pytest.raises(HTTPException) as exc_info:
        await description_requested_endpoint(
            body=incomplete_body, authorization="Bearer test-internal-secret"
        )
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# TC-4: valid bearer + valid payload → 202, generate_description.spawn called
# ---------------------------------------------------------------------------


async def test_valid_request_returns_202_and_spawns_generate_description(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_spawn = MagicMock(return_value=None)
    monkeypatch.setattr(generate_description, "spawn", mock_spawn)

    response = await description_requested_endpoint(
        body=_VALID_BODY, authorization="Bearer test-internal-secret"
    )

    assert response.status_code == 202
    mock_spawn.assert_called_once_with(_VALID_BODY)
