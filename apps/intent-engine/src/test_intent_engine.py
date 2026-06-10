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

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure src/ is importable when running this file directly.
_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from main import get_service_info  # noqa: E402
from nlp import detect_language_mix, extract_intent  # noqa: E402
from redis_writer import write_shadow_intent  # noqa: E402
from schemas import ChatIntentDetectedPayload  # noqa: E402

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
