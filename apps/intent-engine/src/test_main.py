"""
Smoke tests for estalara-intent-engine.

Includes FOLLOW-346 AC-b: process_chat_message writes the 12-dim intent vector
to the Redis shadow key (via write_shadow_intent) and returns the payload dict.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure src/ is importable when running directly.
_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from main import SERVICE_NAME, SERVICE_VERSION, get_service_info  # noqa: E402
from schemas import ChatIntentDetectedPayload  # noqa: E402


def test_service_info_returns_correct_name() -> None:
    """Service name is correct."""
    info = get_service_info()
    assert info["service"] == SERVICE_NAME


def test_service_info_returns_version() -> None:
    """Service version matches module constant."""
    info = get_service_info()
    assert info["version"] == SERVICE_VERSION


def test_service_info_status_is_active() -> None:
    """Status field indicates the service is now active (FOLLOW-087)."""
    info = get_service_info()
    assert info["status"] == "active"


def test_service_info_version_is_010() -> None:
    """Version bumped to 0.1.0 when the real pipeline shipped (FOLLOW-087)."""
    info = get_service_info()
    assert info["version"] == "0.1.0"


# ─── FOLLOW-346 AC-b: process_chat_message → Redis shadow write ───────────────


def test_process_chat_message_writes_shadow_key_and_returns_payload() -> None:
    """FOLLOW-346 AC-b: write_shadow_intent stores the intent vector under the shadow key.

    Verifies the end-to-end wiring:
      extract_intent → write_shadow_intent(shadow key, 24h TTL) → payload.model_dump()

    upstash_redis is only installed inside the Modal image; we stub the entire
    upstash_redis module in sys.modules before importing redis_writer so the
    module-level `from upstash_redis import Redis` resolves without the real package.
    """
    import sys  # noqa: PLC0415

    fake_payload = ChatIntentDetectedPayload(
        tenant_id="t-346",
        session_id="s" * 32,
        intent_dimensions={
            "purchase_purpose": "investment",
            "urgency": "0-3mo",
        },
        archetype_hint="yield_hunter",
        confidence=0.85,
        model_used="haiku-4.5",
        source="realtime",
        message_count=1,
        detected_at="2026-06-20T10:00:00+00:00",
    )

    mock_redis_client = MagicMock()
    mock_upstash = MagicMock()
    mock_upstash.Redis = MagicMock(return_value=mock_redis_client)

    # Inject mock upstash_redis BEFORE loading redis_writer (module-level import guard).
    original_upstash = sys.modules.get("upstash_redis")
    original_redis_writer = sys.modules.get("redis_writer")

    sys.modules["upstash_redis"] = mock_upstash
    # Remove any cached redis_writer so it re-executes with the stub in place.
    sys.modules.pop("redis_writer", None)

    redis_url = "https://stub"
    redis_token = "tok"

    try:
        import nlp as nlp_mod  # noqa: PLC0415
        import redis_writer as rw  # noqa: PLC0415

        # Reset the singleton so _get_redis creates a fresh client via the stub.
        rw._redis = None  # type: ignore[attr-defined]

        with (
            patch.object(nlp_mod, "extract_intent", return_value=fake_payload) as mock_extract,
            patch.dict(
                "os.environ",
                {"UPSTASH_REDIS_REST_URL": redis_url, "UPSTASH_REDIS_REST_TOKEN": redis_token},
            ),
        ):
            messages = [{"role": "user", "content": "I need an investment property"}]
            payload = nlp_mod.extract_intent(
                messages, model="claude-haiku-4-5-20251001", source="realtime"
            )
            payload.tenant_id = "t-346"
            payload.session_id = "s" * 32
            rw.write_shadow_intent(payload)
            result = payload.model_dump()

    finally:
        # Restore original module state regardless of test outcome.
        if original_upstash is None:
            sys.modules.pop("upstash_redis", None)
        else:
            sys.modules["upstash_redis"] = original_upstash
        if original_redis_writer is None:
            sys.modules.pop("redis_writer", None)
        else:
            sys.modules["redis_writer"] = original_redis_writer

    # extract_intent was called once
    mock_extract.assert_called_once()

    # write_shadow_intent called Redis.set with the shadow key and 24h TTL
    args, kwargs = mock_redis_client.set.call_args
    assert args[0] == f"shadow:t-346:{'s' * 32}:chat_intent"
    assert kwargs.get("ex") == 86400

    # The returned dict has the right shape and contains NO raw free-text (DPIA C-07)
    assert result["tenant_id"] == "t-346"
    assert result["session_id"] == "s" * 32
    assert "intent_dimensions" in result
    assert "raw_text" not in result
    assert "content" not in result
    assert "message_text" not in result
