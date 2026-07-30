"""
Tests for listing_embed_seed_requested_endpoint — ADR-0016 / FOLLOW-485 direct
Modal invocation.

The prod Redpanda cluster is Serverless, whose HTTP Proxy is BYOC/Dedicated-only (out
of pilot budget), so the control-plane now POSTs listing-embed-seed.requested events
directly to this authenticated Modal web endpoint instead of publishing to Redpanda.

Because ``modal`` is stubbed by conftest.py, ``@modal.fastapi_endpoint(method="POST")``
is a passthrough no-op, so ``listing_embed_seed_requested_endpoint`` is the plain async
Python function below — callable directly with keyword args, bypassing FastAPI's
request-parsing machinery entirely.

Test plan:
  TC-1  Missing Authorization header → HTTPException 401.
  TC-2  Wrong bearer token → HTTPException 401.
  TC-3  Invalid payload (missing listing_ids) → HTTPException 400.
  TC-4  Valid bearer + valid payload → 202 JSONResponse, process_embed_seed_request.spawn
        called once with the exact body (mocked — no real Modal spawn).
  TC-5  process_embed_seed_request: happy path calls _embed_one_listing per listing_id.
  TC-6  process_embed_seed_request: a per-listing failure does not abort the batch.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

_SRC_DIR = Path(__file__).parent.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from jobs.consume_embed_seed_requests import (
    listing_embed_seed_requested_endpoint,
    process_embed_seed_request,
    _valid_bearer,
)

_VALID_BODY: dict[str, object] = {
    "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
    "listing_ids": ["prop-051", "prop-052"],
}


@pytest.fixture(autouse=True)
def env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "test-internal-secret")
    monkeypatch.setenv("EMBED_API_BASE_URL", "https://admin.estalara.test")


# ---------------------------------------------------------------------------
# _valid_bearer unit coverage (mirrors generate_description.py's helper)
# ---------------------------------------------------------------------------


def test_valid_bearer_correct_token_passes() -> None:
    assert _valid_bearer("Bearer test-internal-secret") is True


def test_valid_bearer_missing_header_fails() -> None:
    assert _valid_bearer(None) is False


def test_valid_bearer_wrong_token_fails() -> None:
    assert _valid_bearer("Bearer wrong-token") is False


# ---------------------------------------------------------------------------
# TC-1 / TC-2: 401 on missing/invalid bearer
# ---------------------------------------------------------------------------


async def test_missing_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await listing_embed_seed_requested_endpoint(body=_VALID_BODY, authorization=None)
    assert exc_info.value.status_code == 401


async def test_wrong_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await listing_embed_seed_requested_endpoint(
            body=_VALID_BODY, authorization="Bearer wrong-token"
        )
    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# TC-3: 400 on invalid payload
# ---------------------------------------------------------------------------


async def test_invalid_payload_missing_listing_ids_returns_400() -> None:
    incomplete_body = {"tenant_id": "550e8400-e29b-41d4-a716-446655440000"}
    with pytest.raises(HTTPException) as exc_info:
        await listing_embed_seed_requested_endpoint(
            body=incomplete_body, authorization="Bearer test-internal-secret"
        )
    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# TC-4: valid bearer + valid payload → 202, process_embed_seed_request.spawn called
# ---------------------------------------------------------------------------


async def test_valid_request_returns_202_and_spawns_process_embed_seed_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_spawn = MagicMock(return_value=None)
    monkeypatch.setattr(process_embed_seed_request, "spawn", mock_spawn)

    response = await listing_embed_seed_requested_endpoint(
        body=_VALID_BODY, authorization="Bearer test-internal-secret"
    )

    assert response.status_code == 202
    mock_spawn.assert_called_once_with(_VALID_BODY)


# ---------------------------------------------------------------------------
# TC-5 / TC-6: process_embed_seed_request job body
# ---------------------------------------------------------------------------


def test_process_embed_seed_request_calls_embed_per_listing() -> None:
    with patch("jobs.consume_embed_seed_requests._embed_one_listing") as mock_embed:
        process_embed_seed_request.local(_VALID_BODY)

    assert mock_embed.call_count == 2
    called_listing_ids = {call.args[3] for call in mock_embed.call_args_list}
    assert called_listing_ids == {"prop-051", "prop-052"}


def test_process_embed_seed_request_one_failure_does_not_abort_batch() -> None:
    with patch("jobs.consume_embed_seed_requests._embed_one_listing") as mock_embed:
        mock_embed.side_effect = [Exception("embed failed"), None]
        # Must not raise even though the first listing's embed call fails.
        process_embed_seed_request.local(_VALID_BODY)

    assert mock_embed.call_count == 2


# ---------------------------------------------------------------------------
# FOLLOW-738: both Sentry init sites in this module must go through the
# shared hardened helper (jobs.observability), not a bare sentry_sdk.init().
# ---------------------------------------------------------------------------


def test_process_embed_seed_request_uses_shared_hardened_init() -> None:
    with (
        patch("jobs.consume_embed_seed_requests._embed_one_listing"),
        patch("jobs.observability.init_sentry") as mock_init,
        patch("jobs.observability.flush_sentry") as mock_flush,
    ):
        process_embed_seed_request.local(_VALID_BODY)

    mock_init.assert_called_once_with("SENTRY_DSN")
    mock_flush.assert_called_once_with(0.3)


def test_consume_embed_seed_requests_uses_shared_hardened_init(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from jobs.consume_embed_seed_requests import consume_embed_seed_requests

    monkeypatch.setenv("REDPANDA_BROKERS", "broker:9092")
    monkeypatch.setenv("REDPANDA_SASL_USERNAME", "u")
    monkeypatch.setenv("REDPANDA_SASL_PASSWORD", "p")

    fake_consumer_cls = MagicMock()
    fake_consumer = fake_consumer_cls.return_value
    fake_consumer.poll.return_value = None  # no messages — exits on the 25s deadline

    with (
        patch("confluent_kafka.Consumer", fake_consumer_cls),
        patch("jobs.observability.init_sentry") as mock_init,
        patch("jobs.observability.flush_sentry") as mock_flush,
        patch("time.monotonic", side_effect=[0.0, 26.0]),  # exit the poll loop immediately
    ):
        consume_embed_seed_requests.local()

    mock_init.assert_called_once_with("SENTRY_DSN")
    mock_flush.assert_called_once_with(0.3)
