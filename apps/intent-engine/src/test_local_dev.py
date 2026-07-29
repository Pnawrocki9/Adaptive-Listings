"""
Smoke test for local_dev.chat_nlp_endpoint (FOLLOW-729 AC3).

Proves a POSTed chat message round-trips into the EXACT Redis shadow key
format `write_shadow_intent` writes (`shadow:{tenant}:{session}:chat_intent`,
24h TTL, full payload JSON) — the same format `readShadowChatIntent` (TS side,
apps/control-plane/src/lib/chat-intent-cache.ts) reads.

Reuses the same fixture shape as tests/integration/shadow_intent_writer.py
(the "Redis shadow round-trip" CI gate, FOLLOW-368) rather than inventing a
new one, per FOLLOW-729 AC3.

`extract_intent` is monkeypatched (no live Anthropic call) so this test runs
deterministically without credentials in CI. `write_shadow_intent` itself is
NOT mocked — only the Redis client it constructs (`redis_writer._get_redis`)
is, so the REAL shadow-key-building and TTL logic is exercised end to end.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

import local_dev  # noqa: E402
import redis_writer as rw  # noqa: E402
from schemas import ChatIntentDetectedPayload, ChatIntentDimensions  # noqa: E402

_VALID_BODY: dict = {
    "tenant_id": "smoke-tenant-368",
    "session_id": "smoke-session-368",
    "message": {"role": "user", "content": "Looking for a high-yield cash investment"},
    "profiling_opt_out": False,
}


def _make_fixture_payload() -> ChatIntentDetectedPayload:
    """Same fixture values as tests/integration/shadow_intent_writer.py (FOLLOW-368)."""
    return ChatIntentDetectedPayload(
        tenant_id="",
        session_id="",
        intent_dimensions=ChatIntentDimensions(
            purchase_purpose="investment",
            urgency="0-3mo",
            budget_band="comfortable",
            feature_priority="pool",
            finance_complexity="cash",
            decision_role="decider",
            risk_appetite="aggressive",
            emotional_state="comparison_shopping",
            tax_aware=True,
        ),
        archetype_hint="yield_hunter",
        confidence=0.85,
        model_used="haiku-4.5",
        source="realtime",
        message_count=1,
        detected_at="2026-06-23T00:00:00+00:00",
    )


@pytest.fixture(autouse=True)
def internal_api_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_SECRET", "test-internal-secret")


async def test_missing_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await local_dev.chat_nlp_endpoint(body=_VALID_BODY, authorization=None)
    assert exc_info.value.status_code == 401


async def test_wrong_bearer_returns_401() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await local_dev.chat_nlp_endpoint(body=_VALID_BODY, authorization="Bearer wrong-token")
    assert exc_info.value.status_code == 401


async def test_missing_fields_returns_400() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await local_dev.chat_nlp_endpoint(
            body={"tenant_id": "t"},
            authorization="Bearer test-internal-secret",
        )
    assert exc_info.value.status_code == 400


async def test_round_trip_writes_real_shadow_key_format(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC3: exercises the REAL write_shadow_intent path and asserts the exact
    key/TTL/payload shape that readShadowChatIntent (TS) depends on."""
    mock_redis_client = MagicMock()
    monkeypatch.setattr(rw, "_get_redis", lambda: mock_redis_client)
    extract_mock = MagicMock(return_value=_make_fixture_payload())
    monkeypatch.setattr(local_dev, "extract_intent", extract_mock)

    response = await local_dev.chat_nlp_endpoint(
        body=_VALID_BODY,
        authorization="Bearer test-internal-secret",
    )

    assert response.status_code == 202

    extract_mock.assert_called_once()
    called_messages = extract_mock.call_args.args[0]
    assert called_messages == [{"role": "user", "content": _VALID_BODY["message"]["content"]}]

    # The REAL write_shadow_intent ran — assert on the real Redis.set() call.
    args, kwargs = mock_redis_client.set.call_args
    assert args[0] == "shadow:smoke-tenant-368:smoke-session-368:chat_intent"
    assert kwargs.get("ex") == 86400

    written = json.loads(args[1])
    assert written["tenant_id"] == "smoke-tenant-368"
    assert written["session_id"] == "smoke-session-368"
    assert written["archetype_hint"] == "yield_hunter"
    assert written["intent_dimensions"]["purchase_purpose"] == "investment"
    assert written["confidence"] == 0.85


async def test_profiling_opt_out_skips_shadow_write(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_redis_client = MagicMock()
    monkeypatch.setattr(rw, "_get_redis", lambda: mock_redis_client)
    extract_mock = MagicMock(return_value=_make_fixture_payload())
    monkeypatch.setattr(local_dev, "extract_intent", extract_mock)

    body = {**_VALID_BODY, "profiling_opt_out": True}
    response = await local_dev.chat_nlp_endpoint(
        body=body,
        authorization="Bearer test-internal-secret",
    )

    assert response.status_code == 202
    mock_redis_client.set.assert_not_called()
