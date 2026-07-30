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
from typing import Any, get_args, get_type_hints
from unittest.mock import MagicMock, patch

import pytest

# Ensure src/ is importable when running this file directly.
_SRC_DIR = Path(__file__).parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

import nlp  # noqa: E402
import observability  # noqa: E402
import redis_writer  # noqa: E402
from main import get_service_info  # noqa: E402
from nlp import detect_language_mix, extract_intent  # noqa: E402
from redis_writer import has_intent_signal, write_shadow_intent  # noqa: E402
from schemas import (  # noqa: E402
    ChatIntentDataSource,
    ChatIntentDetectedPayload,
    ChatIntentDimensions,
)

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
    monkeypatch.setattr(observability, "_sentry_initialised", False)

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
    monkeypatch.setattr(observability, "_sentry_initialised", False)

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

    # C-07 / ROPA boundary — the frames on this traceback hold `messages` (raw
    # buyer chat text) and `raw_text` (the model response). Sentry serialises
    # frame locals by DEFAULT, so leaving this unset shipped the transcript to a
    # third-party processor, contradicting the very compliance records this PR
    # edits. Pinned here so re-enabling it has to break a test.
    init_kwargs = fake_sentry.init.call_args.kwargs
    assert init_kwargs["include_local_variables"] is False
    assert init_kwargs["send_default_pii"] is False
    # FOLLOW-738: the chat-intent-scrubbing before_send hook must be wired,
    # not just documented.
    assert init_kwargs["before_send"] is observability._scrub_chat_intent_exception_value
    # Short-lived Modal containers exit before the daemon transport thread ships:
    # the event must be flushed, not merely enqueued.
    fake_sentry.flush.assert_called_once()
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


# ---------------------------------------------------------------------------
# Post-review hardening (code review of PR #642) — every test below pins a
# defect the review found in the first cut of FOLLOW-730.
# ---------------------------------------------------------------------------


def _make_good_payload() -> ChatIntentDetectedPayload:
    """A payload from a real model read (data_source defaults to 'model')."""
    return ChatIntentDetectedPayload(
        tenant_id="tnt_good",
        session_id="sess_good",
        intent_dimensions={"budget_band": "comfortable"},
        archetype_hint="yield_hunter",
        confidence=0.8,
        model_used="haiku-4.5",
        source="realtime",
        message_count=1,
        detected_at="2026-07-29T00:00:00+00:00",
    )


# Named EXACTLY as the SDK names them: the classifier matches by class name, not
# isinstance (Anthropic's errors derive from AnthropicError, not ValueError), so
# the name is the contract. `test_sdk_error_class_names_still_match` below guards
# these against an upstream rename.
class AuthenticationError(Exception):
    """Stands in for anthropic.AuthenticationError (401)."""


class RateLimitError(Exception):
    """Stands in for anthropic.RateLimitError (429)."""


def test_blank_api_key_classifies_as_missing_not_other() -> None:
    """Review finding: `ANTHROPIC_API_KEY=""` (set but blank) is the most likely
    credential misconfiguration and used to sail past the KeyError branch —
    os.environ succeeds, the request 401s, and the payload was stamped `other`."""
    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "   "}):
        payload = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    assert payload.data_source == "error_fallback"
    assert payload.extraction_error == "missing_api_key: KeyError"


def test_auth_and_rate_limit_errors_get_their_own_kinds() -> None:
    """Review finding: Anthropic errors do NOT derive from ValueError, so a
    revoked key and a 429 both landed in `other` — the bucket the docstring
    defines as 'needs the Sentry event', while that event was itself dead."""
    with patch("nlp._call_model", side_effect=AuthenticationError("401")):
        auth = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    with patch("nlp._call_model", side_effect=RateLimitError("429")):
        throttled = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")

    assert auth.extraction_error == "auth_error: AuthenticationError"
    assert throttled.extraction_error == "rate_limited: RateLimitError"


def test_sdk_error_class_names_still_match_the_classifier() -> None:
    """The classifier keys on Anthropic's class NAMES, so an upstream rename
    would silently send 401s/429s back to `other`. Assert the names against the
    installed SDK rather than trusting the stand-ins above.

    Also pins the fact that made name-matching necessary: these do NOT derive
    from ValueError, so the original `isinstance(exc, ValueError)` check could
    never have caught them.
    """
    anthropic = pytest.importorskip("anthropic")

    for name in ("AuthenticationError", "PermissionDeniedError", "RateLimitError"):
        assert hasattr(anthropic, name), f"anthropic.{name} disappeared — classifier is stale"
        assert not issubclass(getattr(anthropic, name), ValueError)


def test_empty_model_response_is_captured_not_silent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Review finding: the empty-response path raised nothing, so it produced no
    log and no capture at all — the only degraded path with zero telemetry."""
    capture = MagicMock()
    monkeypatch.setattr(nlp, "_capture_extraction_error", capture)
    monkeypatch.setattr(nlp, "_call_model", MagicMock(return_value=""))

    payload = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")

    assert payload.data_source == "empty_model_response"
    capture.assert_called_once()
    assert capture.call_args.kwargs["kind"] == "empty_model_response"
    # No exception exists on this path — it must be reported as a message.
    assert capture.call_args.args[0] is None


def test_degraded_payload_does_not_overwrite_a_prior() -> None:
    """ADR-0020 D1/D3 (FOLLOW-736): a degraded all-null payload is written with
    `SET … NX`, so against an existing key it mutates nothing — the accumulated
    prior survives an Anthropic outage.

    The record still carries its own markers, so on a COLD key (where NX succeeds
    and there is no prior to lose) the degraded write is stored in full.
    """
    with patch("nlp._call_model", side_effect=RuntimeError("connection reset")):
        degraded = extract_intent(_ONE_MESSAGE, model=_HAIKU, source="realtime")
    degraded.tenant_id, degraded.session_id = "tnt_clobber", "sess_clobber"

    mock_redis = MagicMock()
    with patch("redis_writer._get_redis", return_value=mock_redis):
        write_shadow_intent(degraded)

    _args, kwargs = mock_redis.set.call_args
    assert kwargs.get("nx") is True  # create-only: cannot clobber, cannot refresh the TTL
    written = json.loads(mock_redis.set.call_args.args[1])
    assert written["data_source"] == "error_fallback"  # the marker is still on the record…
    assert all(v is None for v in written["intent_dimensions"].values())  # …and dims are null


def test_degraded_source_set_partitions_the_provenance_literal() -> None:
    """DEGRADED_DATA_SOURCES lives beside ChatIntentDataSource so the two cannot
    drift unnoticed. Assert the relationship rather than the membership list, so
    adding a fifth provenance value forces a decision here."""
    from schemas import DEGRADED_DATA_SOURCES

    all_values = set(get_args(ChatIntentDataSource))
    assert DEGRADED_DATA_SOURCES <= all_values, "a degraded value left the Literal"
    assert all_values - DEGRADED_DATA_SOURCES == {"model", "empty_input"}, (
        "a new provenance value appeared: decide whether it is operator-reportable "
        "and add it to DEGRADED_DATA_SOURCES (or to this assertion) deliberately"
    )


def test_multilingual_retry_empty_response_is_marked() -> None:
    """Round 2 finding: the retry's empty-response arm (nothing raised, `if
    retry_raw.strip()` false) fell through with no log, no capture and no marker —
    the same hole the previous round closed on the primary path."""
    calls = {"n": 0}

    def _call(messages: object, model: str) -> str:
        calls["n"] += 1
        return '{"archetype_hint": "neutral", "confidence": 0.1}' if calls["n"] == 1 else "  \n "

    with patch("nlp._call_model", _call):
        payload = extract_intent(
            [{"role": "user", "content": "Szukam mieszkania w Krakowie"}],
            model=_HAIKU,
            source="realtime",
        )

    assert calls["n"] == 2, "the multilingual retry must actually have been attempted"
    assert payload.data_source == "model"
    assert payload.extraction_error == "retry_failed: empty_model_response"


def test_multilingual_retry_failure_is_marked_and_keeps_model_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Review finding: a failing §C.3 Sonnet retry left NO trace on the payload,
    so with SENTRY_DSN unset (its actual prod state) a systematically broken
    retry was 100% invisible — every mixed-language buyer silently kept the
    low-confidence Haiku read forever."""
    capture = MagicMock()
    monkeypatch.setattr(nlp, "_capture_extraction_error", capture)

    low_conf_haiku = '{"archetype_hint": "neutral", "confidence": 0.1}'
    calls = {"n": 0}

    def _call(messages: object, model: str) -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            return low_conf_haiku
        raise RuntimeError("sonnet unavailable")

    monkeypatch.setattr(nlp, "_call_model", _call)

    # Polish text triggers detect_language_mix, so the retry leg is reached.
    payload = extract_intent(
        [{"role": "user", "content": "Szukam mieszkania w Krakowie"}],
        model=_HAIKU,
        source="realtime",
    )

    # Provenance stays "model" — the dimensions ARE a real Haiku read.
    assert payload.data_source == "model"
    assert payload.extraction_error == "retry_failed: RuntimeError"
    assert capture.call_args.kwargs["stage"] == "retry"


# ---------------------------------------------------------------------------
# FOLLOW-736 / ADR-0020 — write admission: an empty extraction never clobbers a
# stored prior. The rule is keyed on CONTENT (all dimensions flatten away), NOT
# on `data_source` — provenance stays DIAGNOSTIC ONLY.
# ---------------------------------------------------------------------------

_PARITY_FIXTURE = (
    Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "chat-intent-signal-parity.json"
)


def _load_parity_cases() -> list[dict[str, Any]]:
    """Load the shared cross-runtime fixture (also consumed by the TS flattener test)."""
    assert _PARITY_FIXTURE.is_file(), (
        f"missing shared parity fixture at {_PARITY_FIXTURE} — it pins ADR-0020 D2 "
        "across Python and TypeScript and must not be moved on one side only"
    )
    cases: list[dict[str, Any]] = json.loads(_PARITY_FIXTURE.read_text(encoding="utf-8"))["cases"]
    return cases


def _payload_with(dims: dict[str, Any]) -> ChatIntentDetectedPayload:
    """A payload carrying exactly `dims` (provenance deliberately left at its default)."""
    return ChatIntentDetectedPayload(
        tenant_id="tnt_736",
        session_id="sess_736",
        intent_dimensions=ChatIntentDimensions(**dims),
        archetype_hint="neutral",
        confidence=0.0,
        model_used="haiku-4.5",
        source="realtime",
        message_count=1,
        detected_at="2026-07-30T00:00:00+00:00",
    )


def _write(payload: ChatIntentDetectedPayload, **kwargs: Any) -> MagicMock:
    """Run write_shadow_intent against a mock client and return the client."""
    mock_redis = MagicMock()
    with patch("redis_writer._get_redis", return_value=mock_redis):
        write_shadow_intent(payload, **kwargs)
    return mock_redis


def test_empty_dims_successful_extraction_also_uses_nx() -> None:
    """AC4(a) — the neutral-success case: the model really answered ("hi"/"thanks")
    and found nothing. `data_source == 'model'`, so a provenance-keyed rule (PR #642
    round 1) would have admitted this write and destroyed the prior anyway. The rule
    is keyed on content, so it does not."""
    payload = _payload_with({})
    assert payload.data_source == "model"  # NOT degraded — a genuine read

    mock_redis = _write(payload)

    _args, kwargs = mock_redis.set.call_args
    assert kwargs.get("nx") is True
    assert kwargs.get("ex") == 86400  # HANDOFF trap 2: NX still carries the TTL


def test_non_empty_dims_write_is_unconditional_and_refreshes_ttl() -> None:
    """AC4(b) — a real read overwrites last-writer-wins and refreshes the 24h clock
    (unchanged pre-existing semantics, ADR-0020 D7)."""
    mock_redis = _write(_payload_with({"purchase_purpose": "investment"}))

    _args, kwargs = mock_redis.set.call_args
    assert "nx" not in kwargs, "a signal-bearing write must not be create-only"
    assert kwargs.get("ex") == 86400


def test_tax_aware_false_alone_is_not_a_signal() -> None:
    """AC4(c) / HANDOFF trap 1 — `tax_aware: False` means "unknown". The TS flattener
    drops it, so admitting it would let a payload the SDK reads as `{}` clobber a real
    prior — the same bug through the back door."""
    assert has_intent_signal(ChatIntentDimensions(tax_aware=False)) is False
    assert has_intent_signal(ChatIntentDimensions(tax_aware=True)) is True

    mock_redis = _write(_payload_with({"tax_aware": False}))
    assert mock_redis.set.call_args.kwargs.get("nx") is True


def test_empty_string_dimension_is_not_a_signal() -> None:
    """AC4(d) — the TS flattener requires `value.length > 0`."""
    assert has_intent_signal(ChatIntentDimensions(purchase_purpose="")) is False
    assert has_intent_signal(ChatIntentDimensions(purchase_purpose="investment")) is True

    mock_redis = _write(_payload_with({"purchase_purpose": ""}))
    assert mock_redis.set.call_args.kwargs.get("nx") is True


def test_opt_out_skips_both_branches() -> None:
    """AC4(e) / §H.9 regression — `profiling_opt_out` stays the FIRST statement, so
    NEITHER admission branch runs: redis.set is not called at all, for a signal-bearing
    payload as well as an empty one."""
    for dims in ({}, {"purchase_purpose": "investment"}):
        mock_redis = _write(_payload_with(dims), profiling_opt_out=True)
        mock_redis.set.assert_not_called()


def test_redis_writer_module_never_reads() -> None:
    """AC4(f) / ADR-0020 D5 — the writer performs no read of the shadow namespace and
    no deserialization, so `json.dumps(payload.model_dump())` stays the SINGLE
    serialization path into the key (the fact C-07 / DPIA / ROPA evidence rests on).
    This is the guard that would have caught round 3 of PR #642, which read the prior
    back through a bare deserializer and wrote it forward."""
    source = Path(redis_writer.__file__).read_text(encoding="utf-8")

    for forbidden in ("json.loads", ".get(", ".mget("):
        assert forbidden not in source, (
            f"redis_writer.py contains {forbidden!r} — ADR-0020 D5 forbids reading or "
            "deserializing the shadow namespace here. A read reintroduces both the "
            "second write path and the GET-then-SET race the NX design removes."
        )


def test_predicate_cannot_see_provenance() -> None:
    """ADR-0020 D2 — the admission predicate takes the DIMENSIONS object, never the
    payload. That parameter type is how DIAGNOSTIC ONLY is enforced structurally: with
    `ChatIntentDetectedPayload` in the signature, `data_source` becomes reachable and
    the next reviewer's "just check the marker here" is a one-line change. Asserted on
    the annotation so it fails loudly if someone widens it."""
    hints = get_type_hints(has_intent_signal)
    assert hints["dims"] is ChatIntentDimensions
    assert ChatIntentDetectedPayload not in hints.values()


@pytest.mark.parametrize("case", _load_parity_cases(), ids=lambda c: str(c["name"]))
def test_has_intent_signal_matches_shared_parity_fixture(case: dict[str, Any]) -> None:
    """AC5 — one fixture, two runtimes. The TypeScript half of this pair lives in
    `apps/control-plane/src/lib/__tests__/chat-intent-cache.test.ts` and asserts the
    same cases against `flattenIntentDimensions`, so the mirror cannot drift silently."""
    dims = ChatIntentDimensions(**case["dims"])
    assert has_intent_signal(dims) is case["expect_signal"], case["why"]


def test_parity_fixture_covers_every_declared_dimension() -> None:
    """The fixture is only a mirror guard if it names the same 12 dimensions the schema
    declares — a renamed field would otherwise be silently absent from both sides."""
    schema_fields = set(ChatIntentDimensions.model_fields)
    for case in _load_parity_cases():
        assert set(case["dims"]) <= schema_fields, (
            f"fixture case {case['name']!r} names a dimension that is not on "
            "ChatIntentDimensions"
        )
    covered = {key for case in _load_parity_cases() for key in case["dims"]}
    assert covered == schema_fields, f"fixture never exercises: {sorted(schema_fields - covered)}"
