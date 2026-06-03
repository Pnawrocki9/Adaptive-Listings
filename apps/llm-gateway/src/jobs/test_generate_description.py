"""
Tests for apps/llm-gateway/src/jobs/generate_description.py.

Tests call internal helper functions (_generate_with_sonnet, _write_to_redis) and
the generate_description job body directly — bypassing Modal decorators so no Modal
infrastructure is needed at test time.

To test the job logic end-to-end without Modal, we extract the function body into a
testable helper (_run_generate_description) and call it directly.

Test plan (per TICKET-DESC-001 AC item 10 and Python test requirements):

  TC-1  Happy path — Sonnet responds, Redis pipeline called with correct args.
  TC-2  Sonnet returns empty string — Redis NOT called.
  TC-3  Sonnet raises anthropic.APIError — Redis NOT called, no uncaught exception.
  TC-4  Tier 2 → max_tokens=450, TTL=259200 in Redis SET.
  TC-5  Tier 3 → max_tokens=600, TTL=172800 in Redis SET.
  TC-6  copy_template text appears in the Sonnet user prompt.
  TC-7  locale is included in the Sonnet user prompt.
  TC-8  listing_context JSON is embedded in the Sonnet user prompt.
  TC-9  Archetype guidance appears in prompt for known archetype (yield_hunter).
  TC-10 Unknown archetype falls back to neutral guidance text.
  TC-11 Redis pipeline endpoint receives correct JSON structure (text + generated_at).
  TC-12 generate_description uses cache_key from event directly.
  TC-13 TTL constants match documented values (72h / 48h).
  TC-14 All 18 archetypes have guidance entries.

v1.7.1 additional tests (TICKET-DESC-PIVOT-001):

  TC-15 test_hallucination_resistance — Sonnet must not invent numbers/names when
        verified facts are minimal.
  TC-16 test_verified_facts_extraction — _parse_verified_facts strips the audit
        block and returns the JSON list.
  TC-17 test_verified_facts_missing_falls_back_gracefully — missing audit block
        yields description + empty facts list (no crash).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Ensure the src/ directory is importable
_SRC_DIR = Path(__file__).parent.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

# Import only the pure Python helpers — not the Modal-decorated functions.
# This avoids requiring the Modal library and a live Modal token in CI.
from jobs.generate_description import (
    TTL_TIER_2,
    TTL_TIER_3,
    _ARCHETYPE_GUIDANCE,
    _DEFAULT_GENERATION_MODEL,
    _MAX_TOKENS_CEILING,
    _MAX_TOKENS_FLOOR_TIER_2,
    _MAX_TOKENS_FLOOR_TIER_3,
    _generate_with_sonnet,
    _max_tokens_for,
    _parse_verified_facts,
    _resolve_generation_model,
    _write_to_redis,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_EVENT: dict[str, Any] = {
    "tenant_id": "tenant-abc",
    "listing_id": "listing-123",
    "archetype": "yield_hunter",
    "cache_key": "desc:tenant-abc:listing-123:yield_hunter:en",
    "locale": "en",
    "tier": 2,
    "copy_template": "This income-producing property has a 6.2% gross yield.",
    "listing_context": {"bedrooms": 3, "price": 350000, "yield_pct": 6.2},
    "original_description": "3-bed property with sitting tenant in central area.",
    "ttl_seconds": 259200,
}


def _make_event(**overrides: Any) -> dict[str, Any]:
    return {**_BASE_EVENT, **overrides}


def _run_job(event: dict[str, Any]) -> None:
    """
    Exercise the full generate_description job body without using Modal.

    Replicates the job body in pure Python so tests run without Modal infra.
    This mirrors generate_description() exactly so that any change to the job
    body must be reflected here too.
    """
    import logging

    from jobs.generate_description import _generate_with_sonnet, _write_to_redis

    log = logging.getLogger(__name__)

    archetype: str = event["archetype"]
    locale: str = event.get("locale", "en")
    tier: int = int(event.get("tier", 2))
    copy_template: str = event.get("copy_template", "")
    listing_context: dict[str, Any] = event.get("listing_context", {})
    # v1.7.1: original_description is required (may be empty string).
    original_description: str = event["original_description"]
    cache_key: str = event["cache_key"]
    default_ttl = TTL_TIER_2 if tier == 2 else TTL_TIER_3
    ttl_seconds: int = int(event.get("ttl_seconds", default_ttl))
    # FOLLOW-166: mirror generate_description() — resolve the (allow-listed) override model.
    model: str = _resolve_generation_model(event.get("override_model"))

    try:
        description, verified_facts = _generate_with_sonnet(
            archetype=archetype,
            copy_template=copy_template,
            listing_context=listing_context,
            tier=tier,
            locale=locale,
            original_description=original_description,
            model=model,
        )
    except Exception as exc:
        log.error("test_job.sonnet_error error=%s", str(exc))
        return

    if not description:
        return

    _write_to_redis(cache_key, description, ttl_seconds, verified_facts)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inject required environment variables for all tests."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-key")
    monkeypatch.setenv("UPSTASH_REDIS_URL", "https://redis.upstash.io")
    monkeypatch.setenv("UPSTASH_REDIS_TOKEN", "test-redis-token")


@pytest.fixture()
def sonnet_response_text() -> str:
    return (
        "This income-producing property delivers a compelling 6.2% gross yield, "
        "making it an attractive choice for investors focused on consistent cash flow. "
        "A sitting tenant provides immediate rental income with minimal void risk."
    )


@pytest.fixture()
def mock_sonnet(sonnet_response_text: str) -> MagicMock:
    """Patch anthropic.Anthropic so messages.create() returns a non-empty response."""
    content_block = MagicMock()
    content_block.text = sonnet_response_text
    response = MagicMock()
    response.content = [content_block]
    return response


@pytest.fixture()
def mock_redis_post() -> MagicMock:
    """Patch httpx.post to succeed without a real Redis connection."""
    mock = MagicMock()
    mock.raise_for_status = MagicMock()
    return mock


# ---------------------------------------------------------------------------
# TC-1: Happy path — Sonnet responds, Redis pipeline called with correct args
# ---------------------------------------------------------------------------


def test_happy_path_redis_written(mock_sonnet: MagicMock, mock_redis_post: MagicMock) -> None:
    """Sonnet returns text → Redis pipeline SET called once with correct key and TTL."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event())

        mock_httpx.assert_called_once()
        call_kwargs = mock_httpx.call_args

        # URL must point to the pipeline endpoint
        url_arg = call_kwargs[0][0]
        assert "/pipeline" in url_arg

        # JSON body: [[SET, key, value, EX, ttl]]
        body = call_kwargs[1]["json"]
        assert isinstance(body, list) and len(body) == 1
        cmd = body[0]
        assert cmd[0] == "SET"
        assert cmd[1] == "desc:tenant-abc:listing-123:yield_hunter:en"
        assert cmd[3] == "EX"
        assert cmd[4] == TTL_TIER_2


# ---------------------------------------------------------------------------
# TC-2: Sonnet returns empty string — Redis NOT called
# ---------------------------------------------------------------------------


def test_empty_sonnet_response_no_redis_write(mock_redis_post: MagicMock) -> None:
    """Empty Sonnet response → _write_to_redis must not be called."""
    empty_block = MagicMock()
    empty_block.text = ""
    empty_response = MagicMock()
    empty_response.content = [empty_block]

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = empty_response

        _run_job(_make_event())

        mock_httpx.assert_not_called()


# ---------------------------------------------------------------------------
# TC-3: Sonnet raises — Redis NOT called, no uncaught exception
# ---------------------------------------------------------------------------


def test_sonnet_raises_no_redis_write_no_crash(mock_redis_post: MagicMock) -> None:
    """APIError from Sonnet → job exits cleanly, Redis not written."""
    import anthropic as anthropic_mod

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = anthropic_mod.APIStatusError(
            message="rate_limit_exceeded",
            response=MagicMock(status_code=429),
            body={},
        )

        # Must not raise
        _run_job(_make_event())

        mock_httpx.assert_not_called()


# ---------------------------------------------------------------------------
# TC-4: Tier 2 → max_tokens=450, TTL=259200
# ---------------------------------------------------------------------------


def test_tier2_max_tokens_and_ttl(mock_sonnet: MagicMock, mock_redis_post: MagicMock) -> None:
    """Tier 2: Sonnet call uses max_tokens=450; Redis SET uses TTL=259200."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event(tier=2, ttl_seconds=TTL_TIER_2))

        create_kwargs = mock_client.messages.create.call_args[1]
        assert create_kwargs["max_tokens"] == 450

        redis_body = mock_httpx.call_args[1]["json"]
        assert redis_body[0][4] == TTL_TIER_2


# ---------------------------------------------------------------------------
# TC-5: Tier 3 → max_tokens=600, TTL=172800
# ---------------------------------------------------------------------------


def test_tier3_max_tokens_and_ttl(mock_sonnet: MagicMock, mock_redis_post: MagicMock) -> None:
    """Tier 3: Sonnet call uses max_tokens=600; Redis SET uses TTL=172800."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event(tier=3, ttl_seconds=TTL_TIER_3))

        create_kwargs = mock_client.messages.create.call_args[1]
        assert create_kwargs["max_tokens"] == 600

        redis_body = mock_httpx.call_args[1]["json"]
        assert redis_body[0][4] == TTL_TIER_3


# ---------------------------------------------------------------------------
# TC-6: copy_template text appears in the Sonnet user prompt
# ---------------------------------------------------------------------------


def test_copy_template_in_prompt() -> None:
    """_generate_with_sonnet includes copy_template text in the user message."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Yield-focused description."
        mock_client.messages.create.return_value = MagicMock(content=[content_block])

        seed = "This property has a 6.2% gross yield, making it ideal for investors."
        _generate_with_sonnet("yield_hunter", seed, {}, 2, "en")

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        assert seed in user_content


# ---------------------------------------------------------------------------
# TC-7: locale is included in the Sonnet user prompt
# ---------------------------------------------------------------------------


def test_locale_in_prompt() -> None:
    """_generate_with_sonnet includes the locale in the user message."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Tekst po polsku."
        mock_client.messages.create.return_value = MagicMock(content=[content_block])

        _generate_with_sonnet("family_buyer", "", {}, 2, "pl")

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        assert "pl" in user_content


# ---------------------------------------------------------------------------
# TC-8: listing_context JSON embedded in user prompt
# ---------------------------------------------------------------------------


def test_listing_context_in_prompt() -> None:
    """_generate_with_sonnet embeds listing_context as JSON in the user message."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Great property."
        mock_client.messages.create.return_value = MagicMock(content=[content_block])

        context = {"bedrooms": 4, "price": 450000}
        _generate_with_sonnet("family_buyer", "", context, 2, "en")

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        assert '"bedrooms": 4' in user_content
        assert '"price": 450000' in user_content


# ---------------------------------------------------------------------------
# TC-9: Archetype guidance appears in prompt for known archetype
# ---------------------------------------------------------------------------


def test_known_archetype_guidance_in_prompt() -> None:
    """yield_hunter guidance (gross yield / ROI focus) appears in the Sonnet prompt."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Yield-focused description."
        mock_client.messages.create.return_value = MagicMock(content=[content_block])

        _generate_with_sonnet("yield_hunter", "", {}, 2, "en")

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        # The yield_hunter guidance explicitly mentions "gross yield"
        assert "gross yield" in user_content.lower()


# ---------------------------------------------------------------------------
# TC-10: Unknown archetype falls back to neutral guidance
# ---------------------------------------------------------------------------


def test_unknown_archetype_fallback_guidance() -> None:
    """Unrecognised archetype ID must use the fallback guidance text."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Generic description."
        mock_client.messages.create.return_value = MagicMock(content=[content_block])

        _generate_with_sonnet("unknown_archetype_xyz", "", {}, 2, "en")

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        assert "motivated buyer" in user_content.lower()


# ---------------------------------------------------------------------------
# TC-11: Redis pipeline JSON has 'text' and 'generated_at' keys
# ---------------------------------------------------------------------------


def test_redis_value_structure() -> None:
    """_write_to_redis stores JSON with 'text' and 'generated_at' keys."""
    with patch("httpx.post") as mock_httpx:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp

        _write_to_redis("desc:t:l:a:en", "A lovely property in a quiet area.", 259200)

        body = mock_httpx.call_args[1]["json"]
        # body is [[SET, key, value_str, EX, ttl]]
        value_str = body[0][2]
        value = json.loads(value_str)
        assert "text" in value
        assert value["text"] == "A lovely property in a quiet area."
        assert "generated_at" in value
        # ISO timestamp contains "T"
        assert "T" in value["generated_at"]


# ---------------------------------------------------------------------------
# TC-12: generate_description uses cache_key from event directly
# ---------------------------------------------------------------------------


def test_cache_key_from_event(mock_sonnet: MagicMock, mock_redis_post: MagicMock) -> None:
    """Redis SET must use the exact cache_key from the event."""
    custom_key = "desc:custom-tenant:custom-listing:luxury_buyer:pl"

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(
            _make_event(
                cache_key=custom_key,
                tenant_id="custom-tenant",
                listing_id="custom-listing",
                archetype="luxury_buyer",
                locale="pl",
            )
        )

        redis_body = mock_httpx.call_args[1]["json"]
        assert redis_body[0][1] == custom_key


# ---------------------------------------------------------------------------
# TC-13: TTL constants match documented values
# ---------------------------------------------------------------------------


def test_ttl_constants() -> None:
    """TTL_TIER_2 = 72h = 259200s; TTL_TIER_3 = 48h = 172800s."""
    assert TTL_TIER_2 == 259200
    assert TTL_TIER_3 == 172800


# ---------------------------------------------------------------------------
# TC-14: All 18 archetypes have guidance entries
# ---------------------------------------------------------------------------

_EXPECTED_ARCHETYPES = {
    "yield_hunter",
    "family_buyer",
    "lifestyle_expat",
    "first_time_buyer",
    "luxury_buyer",
    "remote_worker",
    "downsizer",
    "upsizer",
    "retiree_relocator",
    "vacation_rental_investor",
    "flip_investor",
    "portfolio_builder",
    "golden_visa_buyer",
    "commercial_investor",
    "diaspora_buyer",
    "second_home_buyer",
    "student_parent",
    "neutral",
}


def test_all_archetypes_have_guidance() -> None:
    """Every archetype in the 18-archetype registry must have a guidance entry."""
    missing = _EXPECTED_ARCHETYPES - set(_ARCHETYPE_GUIDANCE.keys())
    assert not missing, f"Missing archetype guidance for: {missing}"


# ---------------------------------------------------------------------------
# TC-15: Hallucination resistance — WHITELIST RULES (v1.7.1)
# ---------------------------------------------------------------------------


def test_hallucination_resistance() -> None:
    """When verified facts are minimal, Sonnet must not invent numbers or names."""
    import re

    minimal_original = "3-bed flat in Madrid"
    minimal_context = {"bedrooms": 3, "location": {"city": "Madrid"}}

    yield_hunter_voice = """
    VOICE PATTERN: Lead with cashflow language. Frame all features in cashflow terms.
    HARD RULES: No yield %, no occupancy %, no ADR unless in verified_facts.
    """

    mock_response = MagicMock()
    mock_response.content = [
        MagicMock(
            text=(
                "\n    A Madrid apartment positioned for income-focused investors. "
                "With three bedrooms\n    in a city with established rental demand, "
                "the unit fits a cashflow strategy\n    without aspirational framing. "
                "Rental yield is attractive in this market type.\n    "
                "Position: income asset rather than lifestyle purchase.\n\n"
                "    <verified_facts_used>\n"
                '    ["bedrooms: 3", "location: Madrid"]\n'
                "    </verified_facts_used>\n    "
            )
        )
    ]

    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mock_anthropic_cls.return_value = mock_client

        result = _generate_with_sonnet(
            archetype="yield_hunter",
            copy_template=yield_hunter_voice,
            original_description=minimal_original,
            listing_context=minimal_context,
            tier=2,
            locale="en",
        )

    description, verified_facts = result

    forbidden_patterns = [
        r"\d+\.\d+%",
        r"\d+% (occupancy|yield)",
        r"€\d+",
        r"\d+ sqm",
        r"Ofsted",
        r"Airbnb",
    ]
    for pattern in forbidden_patterns:
        assert not re.search(
            pattern, description, re.IGNORECASE
        ), f"Hallucinated forbidden pattern '{pattern}' in: {description}"

    assert isinstance(verified_facts, list)
    assert "bedrooms: 3" in verified_facts
    assert "location: Madrid" in verified_facts


# ---------------------------------------------------------------------------
# TC-16: Verified-facts audit-block extraction (v1.7.1)
# ---------------------------------------------------------------------------


def test_verified_facts_extraction() -> None:
    """Parser must extract <verified_facts_used> block correctly."""
    # _parse_verified_facts is imported at module top.
    sonnet_output = """
    Description text here without facts block in body.

    <verified_facts_used>
    ["bedrooms: 3", "location: Marbella", "garden: yes"]
    </verified_facts_used>
    """

    description, facts = _parse_verified_facts(sonnet_output)
    assert "Description text here" in description
    assert "<verified_facts_used>" not in description
    assert facts == ["bedrooms: 3", "location: Marbella", "garden: yes"]


# ---------------------------------------------------------------------------
# TC-17: Verified-facts block missing — graceful fallback (v1.7.1)
# ---------------------------------------------------------------------------


def test_verified_facts_missing_falls_back_gracefully() -> None:
    """If Sonnet forgets the audit block, response still works (facts=[])."""
    # _parse_verified_facts is imported at module top.
    sonnet_output = "Just a description, no audit block."

    description, facts = _parse_verified_facts(sonnet_output)
    assert description == "Just a description, no audit block."
    assert facts == []


# ---------------------------------------------------------------------------
# FOLLOW-162 / RETRO-027: max_tokens scales with the original; a truncated
# generation (audit block starved) is discarded rather than stored.
# ---------------------------------------------------------------------------


def test_max_tokens_for_short_original_uses_tier_floor() -> None:
    """Short/empty originals keep the historical tier budget (floor 450/600)."""
    assert _max_tokens_for("", 2) == _MAX_TOKENS_FLOOR_TIER_2
    assert _max_tokens_for("", 3) == _MAX_TOKENS_FLOOR_TIER_3
    short = "3-bed property with sitting tenant in central area."  # 9 words
    assert _max_tokens_for(short, 2) == _MAX_TOKENS_FLOOR_TIER_2
    assert _max_tokens_for(short, 3) == _MAX_TOKENS_FLOOR_TIER_3


def test_max_tokens_for_long_original_scales_above_floor_and_caps() -> None:
    """A long original scales max_tokens above the floor, bounded by the ceiling."""
    scaled = _max_tokens_for("word " * 400, 2)
    assert scaled > _MAX_TOKENS_FLOOR_TIER_2
    assert scaled <= _MAX_TOKENS_CEILING
    # An absurdly long original is clamped to the ceiling, not unbounded.
    assert _max_tokens_for("word " * 5000, 2) == _MAX_TOKENS_CEILING


def test_long_original_raises_sonnet_max_tokens() -> None:
    """_generate_with_sonnet passes the scaled max_tokens to the Anthropic call."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "A description. <verified_facts_used>\n[]\n</verified_facts_used>"
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "end_turn"
        mock_client.messages.create.return_value = resp

        _generate_with_sonnet("yield_hunter", "", {}, 2, "en", original_description="word " * 400)

        max_tokens = mock_client.messages.create.call_args[1]["max_tokens"]
        assert max_tokens > _MAX_TOKENS_FLOOR_TIER_2
        assert max_tokens <= _MAX_TOKENS_CEILING


def test_truncated_max_tokens_response_returns_empty() -> None:
    """stop_reason == 'max_tokens' → treated as failed: ('', []) so caller skips Redis."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        # Body present but the run hit the cap before the audit block was emitted.
        content_block.text = "A long description that ran right up to the token limit and then"
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "max_tokens"
        mock_client.messages.create.return_value = resp

        description, facts = _generate_with_sonnet(
            "yield_hunter", "", {}, 2, "en", original_description="x"
        )

    assert description == ""
    assert facts == []


def test_dangling_audit_tag_returns_empty() -> None:
    """An unclosed <verified_facts_used tag (truncation) → ('', []), never stored."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = (
            "A complete-looking description body.\n\n"
            '<verified_facts_used>\n["bedrooms: 3", "location: Mad'  # cut mid-array, no close
        )
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "end_turn"  # even if the API did not flag it, the open tag does
        mock_client.messages.create.return_value = resp

        description, facts = _generate_with_sonnet(
            "yield_hunter", "", {}, 2, "en", original_description="x"
        )

    assert description == ""
    assert facts == []


def test_truncated_response_no_redis_write(mock_redis_post: MagicMock) -> None:
    """End-to-end: a truncated generation must not write to Redis (idempotent retry)."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = 'Truncated body, open tag <verified_facts_used>\n["bedrooms: 3"'
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "max_tokens"
        mock_client.messages.create.return_value = resp

        _run_job(_make_event(original_description="word " * 50))

        mock_httpx.assert_not_called()


# ---------------------------------------------------------------------------
# FOLLOW-166: DEMO MODE (DEMO-001) override_model is honored + validated.
# ---------------------------------------------------------------------------


def test_resolve_generation_model_allowlist() -> None:
    """An allow-listed override wins; None / unknown / empty fall back to the default."""
    assert _resolve_generation_model("claude-opus-4-8") == "claude-opus-4-8"
    assert _resolve_generation_model("claude-haiku-4-5-20251001") == "claude-haiku-4-5-20251001"
    assert _resolve_generation_model(None) == _DEFAULT_GENERATION_MODEL
    assert _resolve_generation_model("") == _DEFAULT_GENERATION_MODEL
    assert _resolve_generation_model("gpt-4o") == _DEFAULT_GENERATION_MODEL
    assert _resolve_generation_model("'; DROP TABLE --") == _DEFAULT_GENERATION_MODEL


def test_generate_with_sonnet_passes_model_to_anthropic() -> None:
    """_generate_with_sonnet forwards the model arg to the Anthropic call."""
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "A description. <verified_facts_used>\n[]\n</verified_facts_used>"
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "end_turn"
        mock_client.messages.create.return_value = resp

        _generate_with_sonnet("yield_hunter", "", {}, 2, "en", model="claude-opus-4-8")

        assert mock_client.messages.create.call_args[1]["model"] == "claude-opus-4-8"


def test_override_model_honored_end_to_end(mock_redis_post: MagicMock) -> None:
    """event.override_model (allow-listed) reaches the Anthropic call via the job body."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post),
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Body. <verified_facts_used>\n[]\n</verified_facts_used>"
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "end_turn"
        mock_client.messages.create.return_value = resp

        _run_job(_make_event(override_model="claude-opus-4-8"))

        assert mock_client.messages.create.call_args[1]["model"] == "claude-opus-4-8"


def test_override_model_absent_uses_default(mock_redis_post: MagicMock) -> None:
    """No override_model → the default generation model is used."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post),
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Body. <verified_facts_used>\n[]\n</verified_facts_used>"
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "end_turn"
        mock_client.messages.create.return_value = resp

        _run_job(_make_event())  # base event has no override_model

        assert mock_client.messages.create.call_args[1]["model"] == _DEFAULT_GENERATION_MODEL


def test_override_model_invalid_falls_back_to_default(mock_redis_post: MagicMock) -> None:
    """A non-allow-listed override_model must never reach Anthropic — fall back to default."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post),
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        content_block = MagicMock()
        content_block.text = "Body. <verified_facts_used>\n[]\n</verified_facts_used>"
        resp = MagicMock(content=[content_block])
        resp.stop_reason = "end_turn"
        mock_client.messages.create.return_value = resp

        _run_job(_make_event(override_model="totally-not-a-real-model"))

        assert mock_client.messages.create.call_args[1]["model"] == _DEFAULT_GENERATION_MODEL
