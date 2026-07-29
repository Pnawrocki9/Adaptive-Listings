"""
Tests for the two-tier chat NLP pipeline (FOLLOW-087).

Import strategy: modules in src/ are installed as top-level modules by the
editable install (`pip install -e .`), matching how CI runs
`python -m pytest src/`. We therefore import them by bare name (nlp, schemas,
redis_writer, main) and ensure src/ is on sys.path for direct invocation too.

API-key-dependent tests (live Anthropic calls) are guarded with
`pytest.mark.skipif` on ANTHROPIC_API_KEY — same pattern as the other Modal
apps. The pure-logic tests (empty messages, language detection, Redis key
format, service info) run with no key and no network.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import get_args
from unittest.mock import MagicMock, patch

import pytest

# Ensure src/ is importable when running this file directly.
_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

import nlp  # noqa: E402
from main import get_service_info  # noqa: E402
from nlp import detect_language_mix, extract_intent  # noqa: E402
from redis_writer import write_shadow_intent  # noqa: E402
from schemas import ChatIntentDataSource, ChatIntentDetectedPayload  # noqa: E402

_HAS_API_KEY = bool(os.environ.get("ANTHROPIC_API_KEY"))
_HAIKU = os.environ.get("INTENT_REALTIME_MODEL", "claude-haiku-4-5-20251001")

_INVESTOR_ARCHETYPES = {
    "yield_hunter",
    "vacation_rental_investor",
    "flip_investor",
    "portfolio_builder",
    "commercial_investor",
    "golden_visa_buyer",
}


# ---------------------------------------------------------------------------
# Live-model tests (skipped without ANTHROPIC_API_KEY)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _HAS_API_KEY, reason="ANTHROPIC_API_KEY not set")
def test_extract_intent_investment_message() -> None:
    """An explicit investment message yields purchase_purpose='investment'."""
    messages = [{"role": "user", "content": "I'm looking for a high-yield investment property"}]
    payload = extract_intent(messages, model=_HAIKU, source="realtime")
    assert payload.intent_dimensions.purchase_purpose == "investment"
    assert payload.archetype_hint in _INVESTOR_ARCHETYPES


@pytest.mark.skipif(not _HAS_API_KEY, reason="ANTHROPIC_API_KEY not set")
def test_extract_intent_family_message() -> None:
    """A family/schools message yields a family_stage and school_district geo."""
    messages = [
        {
            "role": "user",
            "content": "We need a 4-bed near good schools for our two kids",
        }
    ]
    payload = extract_intent(messages, model=_HAIKU, source="realtime")
    assert payload.intent_dimensions.family_stage is not None
    assert payload.intent_dimensions.geo_priority == "school_district"


# ---------------------------------------------------------------------------
# Pure-logic tests (no API key, no network)
# ---------------------------------------------------------------------------


def test_extract_intent_empty_messages() -> None:
    """Empty input returns the neutral payload — never raises, never calls the model."""
    payload = extract_intent([], model=_HAIKU, source="realtime")
    assert payload.confidence == 0.0
    assert payload.archetype_hint == "neutral"
    assert payload.message_count == 0
    assert payload.source == "realtime"
    # Every dimension is None.
    dims = payload.intent_dimensions.model_dump()
    assert all(value is None for value in dims.values())


def test_extract_intent_neutral_on_model_error() -> None:
    """Any Anthropic error → neutral payload (guardrail: never raise)."""
    messages = [{"role": "user", "content": "Looking for a flat"}]
    with patch("nlp._call_model", side_effect=RuntimeError("boom")):
        payload = extract_intent(messages, model=_HAIKU, source="realtime")
    assert payload.confidence == 0.0
    assert payload.archetype_hint == "neutral"
    assert payload.message_count == 1


def test_extract_intent_parses_model_json() -> None:
    """A well-formed model JSON response is parsed into the contract payload."""
    fake_json = (
        '{"purchase_purpose": "investment", "urgency": "0-3mo", '
        '"budget_band": null, "family_stage": null, "geo_priority": null, '
        '"feature_priority": null, "cross_border": null, '
        '"finance_complexity": "cash", "decision_role": "decider", '
        '"risk_appetite": "aggressive", "emotional_state": "comparison_shopping", '
        '"tax_aware": true, "archetype_hint": "yield_hunter", "confidence": 0.8}'
    )
    messages = [{"role": "user", "content": "buy-to-let, cash, ASAP"}]
    with patch("nlp._call_model", return_value=fake_json):
        payload = extract_intent(messages, model=_HAIKU, source="realtime")
    assert payload.intent_dimensions.purchase_purpose == "investment"
    assert payload.intent_dimensions.tax_aware is True
    assert payload.archetype_hint == "yield_hunter"
    assert payload.confidence == 0.8
    assert payload.model_used == "haiku-4.5"


def test_extract_intent_unknown_archetype_coerced_to_neutral() -> None:
    """An archetype_hint outside the 18 is coerced to 'neutral'."""
    fake_json = '{"archetype_hint": "spaceship_buyer", "confidence": 0.5}'
    with patch("nlp._call_model", return_value=fake_json):
        payload = extract_intent(
            [{"role": "user", "content": "hi"}], model=_HAIKU, source="realtime"
        )
    assert payload.archetype_hint == "neutral"


def test_detect_language_mix_polish() -> None:
    """Polish diacritics are detected as a language mix."""
    assert detect_language_mix("Szukam mieszkania w Krakowie") is True


def test_detect_language_mix_spanish() -> None:
    """Spanish diacritics / inverted punctuation are detected as a language mix."""
    assert detect_language_mix("¿Busco una casa en la montaña?") is True


def test_detect_language_mix_english_only() -> None:
    """Plain English is not flagged as a language mix."""
    assert detect_language_mix("Looking for a house") is False


def test_write_shadow_intent_key_format() -> None:
    """write_shadow_intent targets the shadow namespace key, never the main one."""
    mock_redis = MagicMock()
    payload = ChatIntentDetectedPayload(
        tenant_id="tnt_test",
        session_id="sess_test",
        intent_dimensions={},
        archetype_hint="neutral",
        confidence=0.0,
        model_used="haiku-4.5",
        source="realtime",
        message_count=0,
        detected_at="2026-06-10T00:00:00+00:00",
    )
    with patch("redis_writer._get_redis", return_value=mock_redis):
        write_shadow_intent(payload)
    args, kwargs = mock_redis.set.call_args
    assert args[0] == "shadow:tnt_test:sess_test:chat_intent"
    assert kwargs.get("ex") == 86400


def test_get_service_info() -> None:
    """Service version is bumped to 0.1.0 (no longer a placeholder)."""
    info = get_service_info()
    assert info["version"] == "0.1.0"
    assert info["service"] == "estalara-intent-engine"


# ---------------------------------------------------------------------------
# §H.9 opt-out guard (FOLLOW-384)
# ---------------------------------------------------------------------------

_OPT_OUT_PAYLOAD = ChatIntentDetectedPayload(
    tenant_id="tnt_optout",
    session_id="sess_optout",
    intent_dimensions={},
    archetype_hint="neutral",
    confidence=0.0,
    model_used="haiku-4.5",
    source="realtime",
    message_count=0,
    detected_at="2026-06-24T00:00:00+00:00",
)


def test_write_shadow_intent_skips_on_opt_out() -> None:
    """AC-2: opted-out session → redis.set is NOT called (§H.9)."""
    mock_redis = MagicMock()
    with patch("redis_writer._get_redis", return_value=mock_redis):
        write_shadow_intent(_OPT_OUT_PAYLOAD, profiling_opt_out=True)
    mock_redis.set.assert_not_called()


def test_write_shadow_intent_writes_on_opt_in() -> None:
    """AC-3: opted-in session → redis.set is called with the correct shadow key."""
    mock_redis = MagicMock()
    with patch("redis_writer._get_redis", return_value=mock_redis):
        write_shadow_intent(_OPT_OUT_PAYLOAD, profiling_opt_out=False)
    mock_redis.set.assert_called_once()
    args, kwargs = mock_redis.set.call_args
    assert args[0] == "shadow:tnt_optout:sess_optout:chat_intent"
    assert kwargs.get("ex") == 86400


# ---------------------------------------------------------------------------
# FOLLOW-730 — a swallowed extraction failure must be distinguishable from a
# genuinely neutral buyer (Rule K.2 instance, RETRO-233 §4a LG-1)
# ---------------------------------------------------------------------------

_ONE_MESSAGE = [{"role": "user", "content": "Looking for a flat"}]


def test_extract_intent_marks_error_fallback_on_missing_api_key() -> None:
    """AC1/AC6: the exact reproduced failure (absent ANTHROPIC_API_KEY → KeyError
    inside _call_model) is marked on the payload, not just printed."""
    with patch("nlp._call_model", side_effect=KeyError("ANTHROPIC_API_KEY")):
        payload = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    assert payload.data_source == "error_fallback"
    assert payload.extraction_error == "missing_api_key: KeyError"
    # Unchanged behaviour (deliberately): still neutral, still never raises.
    assert payload.archetype_hint == "neutral"
    assert payload.confidence == 0.0
    assert all(v is None for v in payload.intent_dimensions.model_dump().values())


def test_extract_intent_marks_parse_error_on_unparseable_response() -> None:
    """AC1/AC2: an unparseable model response is classified separately from an
    auth/config failure (the distinction Sentry tags on)."""
    with patch("nlp._call_model", return_value="I'm afraid I can't do that."):
        payload = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    assert payload.data_source == "error_fallback"
    assert payload.extraction_error == "parse_error: JSONDecodeError"


def test_extract_intent_genuinely_neutral_buyer_is_not_marked() -> None:
    """AC1/AC6 — THE discrimination this ticket exists for: a real model read that
    finds no archetype-bearing signal produces dimensions byte-identical to the
    error case, but with `data_source='model'` and no extraction_error."""
    all_null_json = '{"archetype_hint": "neutral", "confidence": 0.0}'
    with patch("nlp._call_model", return_value=all_null_json):
        payload = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    assert payload.data_source == "model"
    assert payload.extraction_error is None
    assert payload.archetype_hint == "neutral"
    assert payload.confidence == 0.0
    assert all(v is None for v in payload.intent_dimensions.model_dump().values())


def test_extract_intent_empty_input_is_marked_empty_input_not_error() -> None:
    """Empty input is neither a model read nor a failure — it gets its own value."""
    payload = extract_intent([], model=_HAIKU, source="realtime")
    assert payload.data_source == "empty_input"
    assert payload.extraction_error is None


def test_extract_intent_empty_model_response_is_marked() -> None:
    """A model that returns only whitespace is degraded but raised nothing."""
    with patch("nlp._call_model", return_value="   \n "):
        payload = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    assert payload.data_source == "empty_model_response"
    assert payload.extraction_error is None


def test_error_marker_round_trips_through_shadow_write() -> None:
    """AC3 + Rule K.2 amendment (CONVENTIONS_PATCH.md:552-564): the marker is
    asserted by ROUND-TRIPPING the written shadow JSON back through the shared
    schema, not by asserting a literal on the producer in isolation.
    """
    with patch("nlp._call_model", side_effect=RuntimeError("connection reset")):
        payload = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    payload.tenant_id = "tnt_730"
    payload.session_id = "sess_730"

    mock_redis = MagicMock()
    with patch("redis_writer._get_redis", return_value=mock_redis):
        write_shadow_intent(payload)

    args, _kwargs = mock_redis.set.call_args
    assert args[0] == "shadow:tnt_730:sess_730:chat_intent"
    round_tripped = ChatIntentDetectedPayload.model_validate(json.loads(args[1]))
    assert round_tripped.data_source == "error_fallback"
    assert round_tripped.extraction_error is not None
    # Enum-membership leg of the amendment: the emitted provenance value is a
    # member of the schema's own enum (derived, not hand-typed here).
    assert round_tripped.data_source in get_args(ChatIntentDataSource)


def test_legacy_payload_without_marker_still_validates() -> None:
    """Backwards compatibility: shadow JSON written before this change (no
    data_source / extraction_error keys) still parses, defaulting to 'model'.
    This is what keeps the FOLLOW-368 Redis round-trip fixture valid."""
    legacy = {
        "tenant_id": "tnt_legacy",
        "session_id": "sess_legacy",
        "intent_dimensions": {"purchase_purpose": "investment"},
        "archetype_hint": "yield_hunter",
        "confidence": 0.8,
        "model_used": "haiku-4.5",
        "source": "realtime",
        "message_count": 1,
        "detected_at": "2026-06-23T00:00:00+00:00",
    }
    parsed = ChatIntentDetectedPayload.model_validate(legacy)
    assert parsed.data_source == "model"
    assert parsed.extraction_error is None


# ── AC2: Sentry capture of the swallowed exception ───────────────────────────


def test_capture_extraction_error_is_noop_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sentry is opt-in: with SENTRY_DSN unset nothing is initialised or sent
    (and the marker + stderr line remain the operative signals)."""
    fake_sentry = MagicMock()
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)
    monkeypatch.setattr(nlp, "_sentry_initialised", False)

    nlp._capture_extraction_error(
        RuntimeError("boom"),
        model=_HAIKU,
        source="realtime",
        kind="other",
        stage="primary",
    )

    fake_sentry.init.assert_not_called()
    fake_sentry.capture_exception.assert_not_called()


def test_capture_extraction_error_tags_kind_when_dsn_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC2: with a DSN configured the swallowed exception is captured with enough
    tags to separate an auth/config failure from a parse failure."""
    fake_sentry = MagicMock()
    scope = MagicMock()
    fake_sentry.new_scope.return_value.__enter__.return_value = scope
    monkeypatch.setenv("SENTRY_DSN", "sentry-dsn-placeholder")
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sentry)
    monkeypatch.setattr(nlp, "_sentry_initialised", False)

    exc = KeyError("ANTHROPIC_API_KEY")
    nlp._capture_extraction_error(
        exc,
        model=_HAIKU,
        source="realtime",
        kind="missing_api_key",
        stage="primary",
    )

    fake_sentry.init.assert_called_once()
    fake_sentry.capture_exception.assert_called_once_with(exc)
    tags = {call.args[0]: call.args[1] for call in scope.set_tag.call_args_list}
    assert tags["area"] == "chat_intent"
    assert tags["kind"] == "extraction_error"
    assert tags["error_kind"] == "missing_api_key"
    assert tags["stage"] == "primary"
    assert tags["source"] == "realtime"
    assert tags["model_family"] == "haiku-4.5"


def test_extract_intent_captures_the_swallowed_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    """AC2 wiring: extract_intent routes its swallowed exception to the capture
    helper with the classified kind (not just to `print`)."""
    capture = MagicMock()
    monkeypatch.setattr(nlp, "_capture_extraction_error", capture)
    monkeypatch.setattr(nlp, "_call_model", MagicMock(side_effect=KeyError("ANTHROPIC_API_KEY")))

    extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")

    capture.assert_called_once()
    assert capture.call_args.kwargs["kind"] == "missing_api_key"
    assert capture.call_args.kwargs["stage"] == "primary"
