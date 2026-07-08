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

import httpx
import pytest

# Ensure the src/ directory is importable
_SRC_DIR = Path(__file__).parent.parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

# Import only the pure Python helpers — not the Modal-decorated functions.
# This avoids requiring the Modal library and a live Modal token in CI.
from jobs.generate_description import (
    _ARCHETYPE_GUIDANCE,
    _DEFAULT_GENERATION_MODEL,
    _HEADLINE_SYSTEM_PROMPT,
    _MAX_TOKENS_CEILING,
    _MAX_TOKENS_FLOOR,
    _body_violates_contract,
    _check_headline_facts,
    _generate_headline,
    _generate_with_sonnet,
    _max_tokens_for,
    _parse_adaptation_verdict,
    _parse_verified_facts,
    _resolve_generation_model,
    _write_to_postgres_cache,
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
    "copy_template": "This income-producing property has a 6.2% gross yield.",
    "listing_context": {"bedrooms": 3, "price": 350000, "yield_pct": 6.2},
    "original_description": "3-bed property with sitting tenant in central area.",
}


def _make_event(**overrides: Any) -> dict[str, Any]:
    return {**_BASE_EVENT, **overrides}


def _run_job(event: dict[str, Any]) -> None:
    """
    Exercise the full generate_description job body without using Modal.

    Replicates the job body in pure Python so tests run without Modal infra.
    This mirrors generate_description() exactly so that any change to the job
    body must be reflected here too (including ADR-0009 headline generation and
    the FOLLOW-460 Postgres write).
    """
    import logging

    from jobs.generate_description import (
        _generate_headline,
        _generate_with_sonnet,
        _write_to_postgres_cache,
        _write_to_redis,
    )

    log = logging.getLogger(__name__)

    tenant_id: str = event["tenant_id"]
    listing_id: str = event["listing_id"]
    archetype: str = event["archetype"]
    locale: str = event.get("locale", "en")
    copy_template: str = event.get("copy_template", "")
    listing_context: dict[str, Any] = event.get("listing_context", {})
    # v1.7.1: original_description is required (may be empty string).
    original_description: str = event["original_description"]
    cache_key: str = event["cache_key"]
    # FOLLOW-166 / FOLLOW-161: mirror generate_description() — precedence chain.
    model: str = _resolve_generation_model(
        event.get("override_model"),
        event.get("generation_model"),
    )

    try:
        description, verified_facts, verdict = _generate_with_sonnet(
            archetype=archetype,
            copy_template=copy_template,
            listing_context=listing_context,
            locale=locale,
            original_description=original_description,
            model=model,
        )
    except Exception as exc:
        log.error("test_job.sonnet_error error=%s", str(exc))
        return

    # FOLLOW-465: mirrors generate_description() — a NEUTRAL verdict is negative-cached
    # (branched separately from a genuine failure), not treated as "write nothing".
    if verdict == "NEUTRAL":
        _write_to_redis(cache_key, "", [], None, verdict="NEUTRAL")
        _write_to_postgres_cache(
            tenant_id=tenant_id,
            listing_id=listing_id,
            archetype=archetype,
            locale=locale,
            description="",
            headline=None,
            model=model,
            verdict="NEUTRAL",
        )
        return

    if not description:
        return

    # ADR-0009 / FOLLOW-169: generate headline — non-fatal if None.
    # Pass verified_facts from the description so the headline call can use the
    # already-extracted whitelist (mirrors the production call site).
    headline = _generate_headline(
        archetype=archetype,
        original_description=original_description,
        listing_context=listing_context,
        model=model,
        verified_facts=verified_facts if verified_facts else None,
    )

    _write_to_redis(cache_key, description, verified_facts, headline)
    _write_to_postgres_cache(
        tenant_id=tenant_id,
        listing_id=listing_id,
        archetype=archetype,
        locale=locale,
        description=description,
        headline=headline,
        model=model,
    )


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
    """Sonnet returns text → Redis pipeline SET called once with correct key, no TTL."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event())

        # The Postgres write is skipped in this test (DESCRIPTION_CACHE_API_BASE_URL /
        # DESCRIPTION_CACHE_INTERNAL_SECRET are unset), so httpx.post is called exactly
        # once — for the Redis write.
        mock_httpx.assert_called_once()
        call_kwargs = mock_httpx.call_args

        # URL must point to the pipeline endpoint
        url_arg = call_kwargs[0][0]
        assert "/pipeline" in url_arg

        # JSON body: [[SET, key, value]] — FOLLOW-460: no "EX" arg, no TTL.
        body = call_kwargs[1]["json"]
        assert isinstance(body, list) and len(body) == 1
        cmd = body[0]
        assert cmd[0] == "SET"
        assert cmd[1] == "desc:tenant-abc:listing-123:yield_hunter:en"
        assert len(cmd) == 3, f"Redis SET must carry no TTL/EX args, got: {cmd}"


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
# TC-4/TC-5 (FOLLOW-460): Tiers removed — single max_tokens floor, no Redis TTL.
# ---------------------------------------------------------------------------


def test_default_max_tokens_floor_and_no_redis_ttl(
    mock_sonnet: MagicMock, mock_redis_post: MagicMock
) -> None:
    """A short original uses the single _MAX_TOKENS_FLOOR; Redis SET carries no TTL.

    The job now makes two Anthropic calls: the first (description) must use the
    floor; the second (headline, ADR-0009) uses _HEADLINE_MAX_TOKENS=60.
    We assert on the first call's max_tokens.
    """
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event())

        # call_args_list[0] is the description call; [1] is the headline call.
        description_call_kwargs = mock_client.messages.create.call_args_list[0][1]
        assert description_call_kwargs["max_tokens"] == _MAX_TOKENS_FLOOR

        redis_body = mock_httpx.call_args[1]["json"]
        assert len(redis_body[0]) == 3, "Redis SET must carry no TTL/EX args"


def test_legacy_tier_and_ttl_fields_in_event_are_ignored(
    mock_sonnet: MagicMock, mock_redis_post: MagicMock
) -> None:
    """A `tier`/`ttl_seconds` field on an inbound event (legacy/in-flight message
    format, FOLLOW-203/FOLLOW-460 deprecated) has zero effect: max_tokens still
    uses the single floor and the Redis SET still carries no TTL.
    """
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event(tier=3, ttl_seconds=172800))

        description_call_kwargs = mock_client.messages.create.call_args_list[0][1]
        assert description_call_kwargs["max_tokens"] == _MAX_TOKENS_FLOOR

        redis_body = mock_httpx.call_args[1]["json"]
        assert len(redis_body[0]) == 3, "Redis SET must carry no TTL/EX args"


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
        _generate_with_sonnet("yield_hunter", seed, {}, "en")

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

        _generate_with_sonnet("family_buyer", "", {}, "pl")

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
        _generate_with_sonnet("family_buyer", "", context, "en")

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

        _generate_with_sonnet("yield_hunter", "", {}, "en")

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

        _generate_with_sonnet("unknown_archetype_xyz", "", {}, "en")

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        assert "motivated buyer" in user_content.lower()


# ---------------------------------------------------------------------------
# TC-11: Redis pipeline JSON has 'text' and 'generated_at' keys
# ---------------------------------------------------------------------------


def test_redis_value_structure() -> None:
    """_write_to_redis stores JSON with 'text' and 'generated_at' keys; SET has no TTL."""
    with patch("httpx.post") as mock_httpx:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp

        _write_to_redis("desc:t:l:a:en", "A lovely property in a quiet area.")

        body = mock_httpx.call_args[1]["json"]
        # body is [[SET, key, value_str]] — FOLLOW-460: no EX/ttl args.
        assert len(body[0]) == 3
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
# TC-13 (FOLLOW-460): no Redis TTL constants remain — Redis SET carries no EX.
# ---------------------------------------------------------------------------


def test_no_ttl_constants_remain() -> None:
    """FOLLOW-460: TTL_TIER_2 / TTL_TIER_3 must no longer exist on the module —
    the Redis cache has no TTL (Master Design §E.7 v2.0)."""
    import jobs.generate_description as gd

    assert not hasattr(gd, "TTL_TIER_2")
    assert not hasattr(gd, "TTL_TIER_3")


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
            locale="en",
        )

    description, verified_facts, verdict = result
    assert verdict == "FIT"

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


def test_max_tokens_for_short_original_uses_floor() -> None:
    """Short/empty originals keep the historical budget floor (FOLLOW-460: no
    per-Tier distinction — a single floor applies to every description)."""
    assert _max_tokens_for("") == _MAX_TOKENS_FLOOR
    short = "3-bed property with sitting tenant in central area."  # 9 words
    assert _max_tokens_for(short) == _MAX_TOKENS_FLOOR


def test_max_tokens_for_long_original_scales_above_floor_and_caps() -> None:
    """A long original scales max_tokens above the floor, bounded by the ceiling."""
    scaled = _max_tokens_for("word " * 400)
    assert scaled > _MAX_TOKENS_FLOOR
    assert scaled <= _MAX_TOKENS_CEILING
    # An absurdly long original is clamped to the ceiling, not unbounded.
    assert _max_tokens_for("word " * 5000) == _MAX_TOKENS_CEILING


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

        _generate_with_sonnet("yield_hunter", "", {}, "en", original_description="word " * 400)

        max_tokens = mock_client.messages.create.call_args[1]["max_tokens"]
        assert max_tokens > _MAX_TOKENS_FLOOR
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

        description, facts, verdict = _generate_with_sonnet(
            "yield_hunter", "", {}, "en", original_description="x"
        )

    assert description == ""
    assert facts == []
    assert verdict == "FAILED"


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

        description, facts, verdict = _generate_with_sonnet(
            "yield_hunter", "", {}, "en", original_description="x"
        )

    assert description == ""
    assert facts == []
    assert verdict == "FAILED"


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

        _generate_with_sonnet("yield_hunter", "", {}, "en", model="claude-opus-4-8")

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


# ---------------------------------------------------------------------------
# FOLLOW-161: global generation_model (admin-configured default) precedence.
# ---------------------------------------------------------------------------


def test_resolve_generation_model_global_wins_over_default() -> None:
    """generation_model (global) is used when no override_model is present."""
    assert _resolve_generation_model(None, "claude-opus-4-8") == "claude-opus-4-8"
    assert (
        _resolve_generation_model(None, "claude-haiku-4-5-20251001") == "claude-haiku-4-5-20251001"
    )


def test_resolve_generation_model_override_wins_over_global() -> None:
    """override_model (DEMO MODE) beats generation_model (global admin setting)."""
    assert (
        _resolve_generation_model("claude-opus-4-8", "claude-haiku-4-5-20251001")
        == "claude-opus-4-8"
    )


def test_resolve_generation_model_invalid_global_falls_back_to_default() -> None:
    """A non-allow-listed generation_model must fall back to _DEFAULT_GENERATION_MODEL."""
    assert _resolve_generation_model(None, "gpt-4o") == _DEFAULT_GENERATION_MODEL
    assert _resolve_generation_model(None, "") == _DEFAULT_GENERATION_MODEL
    assert _resolve_generation_model(None, None) == _DEFAULT_GENERATION_MODEL


def test_generation_model_honored_end_to_end(mock_redis_post: MagicMock) -> None:
    """event.generation_model (allow-listed, no override_model) reaches the Anthropic call."""
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

        _run_job(_make_event(generation_model="claude-haiku-4-5-20251001"))

        assert mock_client.messages.create.call_args[1]["model"] == "claude-haiku-4-5-20251001"


def test_override_model_beats_generation_model_end_to_end(mock_redis_post: MagicMock) -> None:
    """When both override_model and generation_model are set, override_model wins (DEMO MODE)."""
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

        _run_job(
            _make_event(
                override_model="claude-opus-4-8",
                generation_model="claude-haiku-4-5-20251001",
            )
        )

        # override_model beats generation_model
        assert mock_client.messages.create.call_args[1]["model"] == "claude-opus-4-8"


def test_generation_model_invalid_falls_back_to_default(mock_redis_post: MagicMock) -> None:
    """A non-allow-listed generation_model must not reach Anthropic — falls back to default."""
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

        _run_job(_make_event(generation_model="not-a-real-model"))

        assert mock_client.messages.create.call_args[1]["model"] == _DEFAULT_GENERATION_MODEL


# ---------------------------------------------------------------------------
# ADR-0009: per-listing LLM-generated headline tests
# ---------------------------------------------------------------------------


def _make_headline_response(text: str) -> MagicMock:
    """Build a minimal Anthropic response mock returning the given text."""
    block = MagicMock()
    block.text = text
    resp = MagicMock(content=[block])
    return resp


def test_headline_generated_and_written_to_redis(mock_redis_post: MagicMock) -> None:
    """
    ADR-0009 AC1 + AC2: When both description and headline generation succeed, the Redis
    value contains both 'text' and 'headline' keys.
    """
    description_body = "Body. <verified_facts_used>\n[]\n</verified_facts_used>"
    headline_text = "Strong yield play in a well-connected location"

    # messages.create is called twice: once for description, once for headline.
    # Return description response on first call, headline on second.
    desc_resp = MagicMock(content=[MagicMock(text=description_body)], stop_reason="end_turn")
    hl_resp = _make_headline_response(headline_text)

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [desc_resp, hl_resp]

        _run_job(_make_event())

        mock_httpx.assert_called_once()
        value_str = mock_httpx.call_args[1]["json"][0][2]
        value = json.loads(value_str)
        assert "text" in value
        assert "headline" in value
        assert value["headline"] == headline_text


def test_headline_failure_does_not_block_description_write(mock_redis_post: MagicMock) -> None:
    """
    ADR-0009 AC1 (graceful failure): when headline generation raises an exception, the
    description is still written to Redis with headline=null — no uncaught exception.
    """
    import anthropic as anthropic_mod

    description_body = "Body. <verified_facts_used>\n[]\n</verified_facts_used>"
    desc_resp = MagicMock(content=[MagicMock(text=description_body)], stop_reason="end_turn")

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        # First call succeeds (description); second raises (headline).
        mock_client.messages.create.side_effect = [
            desc_resp,
            anthropic_mod.APIStatusError(
                message="rate_limit", response=MagicMock(status_code=429), body={}
            ),
        ]

        # Must not raise.
        _run_job(_make_event())

        # Redis must still be written (description present).
        mock_httpx.assert_called_once()
        value_str = mock_httpx.call_args[1]["json"][0][2]
        value = json.loads(value_str)
        assert "text" in value
        assert value.get("headline") is None


def test_headline_empty_response_written_as_null(mock_redis_post: MagicMock) -> None:
    """
    ADR-0009 AC1: empty headline response → headline=null in Redis, description still written.
    """
    description_body = "Body. <verified_facts_used>\n[]\n</verified_facts_used>"
    desc_resp = MagicMock(content=[MagicMock(text=description_body)], stop_reason="end_turn")
    empty_hl_resp = _make_headline_response("")  # empty string

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [desc_resp, empty_hl_resp]

        _run_job(_make_event())

        mock_httpx.assert_called_once()
        value = json.loads(mock_httpx.call_args[1]["json"][0][2])
        assert value.get("headline") is None


def test_headline_stripped_of_surrounding_quotes() -> None:
    """
    ADR-0009 AC1: _generate_headline strips surrounding quotes and trims whitespace.
    """
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response(
            '"A great buy-to-let in Lisbon"'
        )

        result = _generate_headline(
            archetype="yield_hunter",
            original_description="2-bed flat in Lisbon with tenant.",
            listing_context={"bedrooms": 2, "location": "Lisbon"},
            model=_DEFAULT_GENERATION_MODEL,
        )

        assert result is not None
        assert not result.startswith('"')
        assert not result.endswith('"')
        assert "Lisbon" in result


def test_headline_uses_correct_model() -> None:
    """
    ADR-0009 AC1: _generate_headline passes the model arg to the Anthropic call.
    """
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response("A great property")

        _generate_headline(
            archetype="family_buyer",
            original_description="4-bed house in Surrey.",
            listing_context={"bedrooms": 4},
            model="claude-haiku-4-5-20251001",
        )

        assert mock_client.messages.create.call_args[1]["model"] == "claude-haiku-4-5-20251001"


def test_headline_grounded_in_listing_data() -> None:
    """
    ADR-0009 AC1 (anti-hallucination): the prompt includes both original_description
    and listing_context JSON so the model can ground the headline.
    """
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response("Good headline")

        context = {"bedrooms": 3, "location": "Marbella", "epc": "B"}
        original = "3-bed villa in Marbella with pool."

        _generate_headline(
            archetype="luxury_buyer",
            original_description=original,
            listing_context=context,
            model=_DEFAULT_GENERATION_MODEL,
        )

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        # The prompt must include both sources of truth.
        assert "Marbella" in user_content
        assert "original description" in user_content.lower()
        assert "listing data" in user_content.lower()


def test_write_to_redis_stores_headline() -> None:
    """
    ADR-0009 AC2: _write_to_redis stores the 'headline' field in the Redis JSON value.
    """
    with patch("httpx.post") as mock_httpx:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp

        _write_to_redis(
            "desc:t:l:a:en",
            "A lovely property.",
            ["bedrooms: 3"],
            "Solid buy-to-let in a prime location",
        )

        value = json.loads(mock_httpx.call_args[1]["json"][0][2])
        assert value["headline"] == "Solid buy-to-let in a prime location"


def test_write_to_redis_headline_none_stored_as_null() -> None:
    """
    ADR-0009 AC2: headline=None is serialised as JSON null (not omitted).
    """
    with patch("httpx.post") as mock_httpx:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp

        _write_to_redis("desc:t:l:a:en", "A property.", [], None)

        value = json.loads(mock_httpx.call_args[1]["json"][0][2])
        # 'headline' key must be present and its value must be None (JSON null).
        assert "headline" in value
        assert value["headline"] is None


# ---------------------------------------------------------------------------
# TC-18..21: v1.9 archetype-fit gate — <adaptation_verdict> (ADR-0010)
# ---------------------------------------------------------------------------


def test_parse_adaptation_verdict_fit_strips_tag() -> None:
    """FIT verdict: tag is parsed and removed from the body, reason is None."""
    raw = (
        "<adaptation_verdict>FIT</adaptation_verdict>\n"
        "A bright two-bedroom home with a generous garden.\n"
        "<verified_facts_used>\n"
        '["bedrooms: 2", "garden: yes"]\n'
        "</verified_facts_used>"
    )
    verdict, reason, body = _parse_adaptation_verdict(raw)
    assert verdict == "FIT"
    assert reason is None
    assert "<adaptation_verdict>" not in body
    assert "A bright two-bedroom home" in body


def test_parse_adaptation_verdict_neutral_with_reason() -> None:
    """NEUTRAL verdict: parsed with its reason code; body carries no verdict tags."""
    raw = (
        "<adaptation_verdict>NEUTRAL</adaptation_verdict>\n"
        "<neutral_reason>core_need_contradiction</neutral_reason>"
    )
    verdict, reason, body = _parse_adaptation_verdict(raw)
    assert verdict == "NEUTRAL"
    assert reason == "core_need_contradiction"
    assert "<adaptation_verdict>" not in body
    assert "<neutral_reason>" not in body


def test_parse_adaptation_verdict_missing_defaults_fit() -> None:
    """No verdict tag (non-compliant/legacy output) defaults to FIT, body untouched."""
    raw = "Just a plain description body with no gate tag."
    verdict, reason, body = _parse_adaptation_verdict(raw)
    assert verdict == "FIT"
    assert reason is None
    assert body == raw


def test_generate_with_sonnet_fit_returns_description() -> None:
    """A FIT response yields a description with the verdict tag stripped + parsed facts."""
    mock_response = MagicMock()
    mock_response.stop_reason = "end_turn"
    mock_response.content = [
        MagicMock(
            text=(
                "<adaptation_verdict>FIT</adaptation_verdict>\n"
                "A three-bedroom home in Marbella Old Town with a private garden.\n"
                "<verified_facts_used>\n"
                '["bedrooms: 3", "location: Marbella Old Town", "garden: yes"]\n'
                "</verified_facts_used>"
            )
        )
    ]

    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mock_anthropic_cls.return_value = mock_client

        description, facts, verdict = _generate_with_sonnet(
            archetype="family_buyer",
            copy_template="",
            original_description="A 3-bed home in Marbella Old Town with a garden.",
            listing_context={"bedrooms": 3},
            locale="en",
        )

    assert "<adaptation_verdict>" not in description
    assert "Marbella Old Town" in description
    assert "bedrooms: 3" in facts
    assert verdict == "FIT"


def test_generate_with_sonnet_neutral_returns_empty() -> None:
    """A NEUTRAL verdict yields no description; verdict "NEUTRAL" tells the caller
    to negative-cache this outcome (FOLLOW-465), distinct from a genuine failure."""
    mock_response = MagicMock()
    mock_response.stop_reason = "end_turn"
    mock_response.content = [
        MagicMock(
            text=(
                "<adaptation_verdict>NEUTRAL</adaptation_verdict>\n"
                "<neutral_reason>core_need_contradiction</neutral_reason>"
            )
        )
    ]

    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mock_anthropic_cls.return_value = mock_client

        description, facts, verdict = _generate_with_sonnet(
            archetype="family_buyer",
            copy_template="",
            original_description="A 2-bed 32nd-floor investment condo, no outdoor space.",
            listing_context={"bedrooms": 2, "floor": 32},
            locale="en",
        )

    assert description == ""
    assert facts == []
    assert verdict == "NEUTRAL"


# ---------------------------------------------------------------------------
# FOLLOW-465 / audit F-18: NEUTRAL negative-cache — write side
#
# A NEUTRAL verdict must be written as a negative-cache marker (Redis + Postgres,
# text/description "", headline None, verdict "NEUTRAL") — NOT treated as "write
# nothing" like a genuine failure. This is what stops the perpetual Sonnet
# re-spend a NEUTRAL verdict otherwise causes (every repeat request re-enqueuing
# another Sonnet 4.6 call because a NEUTRAL row was indistinguishable from "never
# generated").
# ---------------------------------------------------------------------------


def _neutral_sonnet_response() -> MagicMock:
    resp = MagicMock()
    resp.stop_reason = "end_turn"
    resp.content = [
        MagicMock(
            text=(
                "<adaptation_verdict>NEUTRAL</adaptation_verdict>\n"
                "<neutral_reason>core_need_contradiction</neutral_reason>"
            )
        )
    ]
    return resp


def test_neutral_verdict_writes_negative_cache_marker_to_redis(
    mock_redis_post: MagicMock,
) -> None:
    """A NEUTRAL verdict WRITES to Redis (unlike a genuine failure) — an empty
    text/'' marker tagged verdict='NEUTRAL', headline null, at the SAME cache_key
    a FIT write would use."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _neutral_sonnet_response()

        _run_job(_make_event())

        # Redis IS written (the whole point of the fix) — exactly one call, no
        # Postgres callback because DESCRIPTION_CACHE_API_BASE_URL is unset here.
        mock_httpx.assert_called_once()
        call_kwargs = mock_httpx.call_args
        assert "/pipeline" in call_kwargs[0][0]

        body = call_kwargs[1]["json"]
        cmd = body[0]
        assert cmd[0] == "SET"
        assert cmd[1] == "desc:tenant-abc:listing-123:yield_hunter:en"

        value = json.loads(cmd[2])
        assert value["text"] == ""
        assert value["headline"] is None
        assert value["verdict"] == "NEUTRAL"


def test_neutral_verdict_writes_negative_cache_marker_to_postgres(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A NEUTRAL verdict also POSTs a negative-cache marker to the Postgres internal
    endpoint (description='', headline=null, verdict='NEUTRAL') — same shape as a
    FIT write reaches the SAME (tenant, listing, archetype, locale) row, so the
    existing listing.updated invalidation covers it for free."""
    monkeypatch.setenv("DESCRIPTION_CACHE_API_BASE_URL", "https://admin.estalara.test")
    monkeypatch.setenv("DESCRIPTION_CACHE_INTERNAL_SECRET", "test-shared-secret")

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post") as mock_httpx,
    ):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp
        mock_anthropic_cls.return_value = MagicMock(
            messages=MagicMock(create=MagicMock(return_value=_neutral_sonnet_response()))
        )

        _run_job(_make_event())

        # Two httpx.post calls: [0] Redis SET, [1] Postgres internal endpoint POST.
        assert mock_httpx.call_count == 2

        pg_call = mock_httpx.call_args_list[1]
        assert pg_call[0][0] == "https://admin.estalara.test/api/internal/description-cache"
        pg_body = pg_call[1]["json"]
        assert pg_body["tenant_id"] == "tenant-abc"
        assert pg_body["listing_id"] == "listing-123"
        assert pg_body["archetype"] == "yield_hunter"
        assert pg_body["locale"] == "en"
        assert pg_body["description"] == ""
        assert pg_body["headline"] is None
        assert pg_body["verdict"] == "NEUTRAL"


def test_generic_failure_still_writes_nothing_unlike_neutral(mock_redis_post: MagicMock) -> None:
    """
    Regression guard distinguishing the two "empty description" causes: a genuine
    failure (empty Sonnet response) must still write NOTHING — only a NEUTRAL
    verdict is negative-cached.
    """
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


def test_neutral_verdict_end_to_end_via_production_job(mock_redis_post: MagicMock) -> None:
    """
    End-to-end regression guard against the production generate_description()
    function (not the test-only _run_job replica) — proves the real job body
    negative-caches a NEUTRAL verdict via a direct __wrapped__ call, bypassing the
    Modal decorator (mirrors the pattern _run_job avoids Modal infra with).
    """
    from jobs.generate_description import generate_description

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _neutral_sonnet_response()

        # Modal-decorated functions expose the raw function via .local() (Modal's
        # synchronous local-invocation API) for testing without Modal infra.
        generate_description.local(_make_event())

        mock_httpx.assert_called_once()
        cmd = mock_httpx.call_args[1]["json"][0]
        value = json.loads(cmd[2])
        assert value["verdict"] == "NEUTRAL"
        assert value["text"] == ""


# ---------------------------------------------------------------------------
# FOLLOW-188: leak/format fail-safe — _body_violates_contract unit tests
# ---------------------------------------------------------------------------


def test_body_violates_contract_clean_body_passes() -> None:
    """A clean FIT description body must return None (no violation detected)."""
    clean = (
        "A three-bedroom home in Marbella Old Town with a private garden. "
        "Energy performance is strong, keeping running costs predictable. "
        "Three bedrooms give flexibility: family lets, seasonal rentals, or a steady tenancy."
    )
    assert _body_violates_contract(clean) is None


def test_body_violates_contract_my_approach_suppressed() -> None:
    """A body containing 'My approach:' is a reasoning leak -> suppressed."""
    leaked = (
        "My approach: I will first consider the archetype's core needs and then determine "
        "whether this property fits. The property has three bedrooms in Marbella Old Town."
    )
    assert _body_violates_contract(leaked) == "leak_marker"


def test_body_violates_contract_bold_markdown_suppressed() -> None:
    """A body with **bold** markdown -> suppressed as formatted_body."""
    formatted = (
        "**Outstanding investment opportunity.** Three bedrooms in a prime location. "
        "Strong rental demand makes this a reliable income asset."
    )
    assert _body_violates_contract(formatted) == "formatted_body"


def test_body_violates_contract_heading_markdown_suppressed() -> None:
    """A body with a # heading line -> suppressed as formatted_body."""
    with_heading = (
        "# Property Overview\n"
        "Three bedrooms in Marbella Old Town with a private garden and strong EPC rating."
    )
    assert _body_violates_contract(with_heading) == "formatted_body"


def test_body_violates_contract_residual_verified_facts_tag_suppressed() -> None:
    """A residual <verified_facts_used opening tag in the body -> suppressed as residual_tag."""
    with_tag = (
        "A great property in Lisbon. Good transport links.\n"
        "<verified_facts_used>\n"
        '["bedrooms: 2"'
    )
    assert _body_violates_contract(with_tag) == "residual_tag"


def test_body_violates_contract_residual_adaptation_verdict_tag_suppressed() -> None:
    """A residual <adaptation_verdict tag in the body -> suppressed as residual_tag."""
    with_tag = "Good property. <adaptation_verdict>FIT</adaptation_verdict> More text."
    assert _body_violates_contract(with_tag) == "residual_tag"


def test_body_violates_contract_residual_neutral_reason_tag_suppressed() -> None:
    """A residual <neutral_reason tag in the body -> suppressed as residual_tag."""
    with_tag = "A studio flat in a city centre. <neutral_reason>core_need</neutral_reason>"
    assert _body_violates_contract(with_tag) == "residual_tag"


def test_body_violates_contract_non_negotiable_not_suppressed() -> None:
    """
    'non-negotiable' in a real-estate price context must NOT trigger suppression.

    Rationale: 'non-negotiable' is a common English real-estate phrase
    ('the asking price is non-negotiable') and was deliberately excluded from
    the marker list to avoid false positives in legitimate listing prose.
    """
    legitimate = (
        "A two-bedroom flat priced at offers around the guide — the asking price is "
        "non-negotiable. The property is move-in ready with a modern kitchen."
    )
    assert _body_violates_contract(legitimate) is None


def test_body_violates_contract_case_insensitive_marker() -> None:
    """Marker matching is case-insensitive: 'AS AN AI' must still be caught."""
    leaked = "AS AN AI, I cannot write misleading copy about this property."
    assert _body_violates_contract(leaked) == "leak_marker"


# ---------------------------------------------------------------------------
# FOLLOW-188: end-to-end suppression via _generate_with_sonnet
# ---------------------------------------------------------------------------


def _make_fit_response_with_body(body_text: str) -> MagicMock:
    """
    Build a mock Anthropic response with a FIT verdict wrapping the given body text.
    Includes a valid <verified_facts_used> block so parsing proceeds to the contract guard.
    """
    content_block = MagicMock()
    content_block.text = (
        "<adaptation_verdict>FIT</adaptation_verdict>\n"
        f"{body_text}\n"
        "<verified_facts_used>\n"
        '["bedrooms: 3", "location: Marbella Old Town"]\n'
        "</verified_facts_used>"
    )
    resp = MagicMock()
    resp.content = [content_block]
    resp.stop_reason = "end_turn"
    return resp


def test_generate_with_sonnet_leak_marker_returns_empty() -> None:
    """
    FOLLOW-188 AC: a FIT body containing 'My approach:' -> _generate_with_sonnet returns
    ('', []) so the caller skips Redis and the DOM stays neutral.
    """
    resp = _make_fit_response_with_body(
        "My approach: lead with cashflow angle. "
        "Three bedrooms in Marbella Old Town with a private garden."
    )
    with patch("anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = resp

        description, facts, verdict = _generate_with_sonnet(
            archetype="yield_hunter",
            copy_template="",
            original_description="3-bed in Marbella Old Town with garden.",
            listing_context={"bedrooms": 3},
            locale="en",
        )

    assert description == ""
    assert facts == [], "a leak-marker FIT body should still return empty facts"
    assert verdict == "FAILED", "a contract violation is a genuine failure, not NEUTRAL"


def test_generate_with_sonnet_bold_markdown_returns_empty() -> None:
    """
    FOLLOW-188 AC: a FIT body with **bold** markdown -> ('', []) — never stored.
    """
    resp = _make_fit_response_with_body(
        "**Exceptional investment opportunity.** "
        "Three bedrooms in Marbella Old Town with a private garden."
    )
    with patch("anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = resp

        description, facts, verdict = _generate_with_sonnet(
            archetype="yield_hunter",
            copy_template="",
            original_description="3-bed in Marbella Old Town.",
            listing_context={"bedrooms": 3},
            locale="en",
        )

    assert description == ""
    assert facts == []
    assert verdict == "FAILED"


def test_generate_with_sonnet_contract_violation_no_redis_write(
    mock_redis_post: MagicMock,
) -> None:
    """
    FOLLOW-188 AC (end-to-end): a FIT body with a leak marker must not write to Redis.
    """
    resp = _make_fit_response_with_body(
        "As an AI, I will write a description that highlights investment appeal. "
        "Three bedrooms in Marbella Old Town."
    )
    with (
        patch("anthropic.Anthropic") as mock_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = resp

        _run_job(
            _make_event(
                original_description="3-bed in Marbella Old Town.",
                listing_context={"bedrooms": 3},
            )
        )

        mock_httpx.assert_not_called()


def test_generate_with_sonnet_neutral_after_follow188_still_returns_empty() -> None:
    """
    Regression guard: NEUTRAL verdict must still return ('', []) after the
    FOLLOW-188 fail-safe was wired in (the guard must not interfere with NEUTRAL).
    """
    mock_response = MagicMock()
    mock_response.stop_reason = "end_turn"
    mock_response.content = [
        MagicMock(
            text=(
                "<adaptation_verdict>NEUTRAL</adaptation_verdict>\n"
                "<neutral_reason>core_need_contradiction</neutral_reason>"
            )
        )
    ]

    with patch("anthropic.Anthropic") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_response

        description, facts, verdict = _generate_with_sonnet(
            archetype="family_buyer",
            copy_template="",
            original_description="A 2-bed investment condo.",
            listing_context={"bedrooms": 2, "floor": 32},
            locale="en",
        )

    assert description == ""
    assert facts == []
    assert verdict == "NEUTRAL"


# ---------------------------------------------------------------------------
# FOLLOW-169: headline anti-hallucination grounding (AC1 + AC2)
# ---------------------------------------------------------------------------


def test_headline_uses_system_prompt() -> None:
    """
    FOLLOW-169 AC1: _generate_headline passes _HEADLINE_SYSTEM_PROMPT as the
    system parameter to the Anthropic API call (non-test production path).

    Rule H: the system prompt has a runtime caller (_generate_headline, which is
    called from the generate_description job body on every cache-miss description
    generation path) -- this test confirms the wiring.
    """
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response("Good headline")

        _generate_headline(
            archetype="yield_hunter",
            original_description="3-bed flat in Lisbon with sitting tenant.",
            listing_context={"bedrooms": 3, "location": "Lisbon"},
            model=_DEFAULT_GENERATION_MODEL,
        )

        call_kwargs = mock_client.messages.create.call_args[1]
        # The system prompt must be passed and must be the curated _HEADLINE_SYSTEM_PROMPT.
        assert "system" in call_kwargs
        assert call_kwargs["system"] == _HEADLINE_SYSTEM_PROMPT
        assert len(_HEADLINE_SYSTEM_PROMPT) > 100  # sanity: not a placeholder


def test_headline_verified_facts_appear_in_user_prompt() -> None:
    """
    FOLLOW-169 AC1: when verified_facts is provided, the user prompt contains the
    whitelist entries so the model can ground against the already-extracted facts.
    """
    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response("Good headline")

        facts = ["bedrooms: 3", "location: Lisbon", "tenanted: yes"]
        _generate_headline(
            archetype="yield_hunter",
            original_description="3-bed flat in Lisbon with tenant.",
            listing_context={"bedrooms": 3},
            model=_DEFAULT_GENERATION_MODEL,
            verified_facts=facts,
        )

        user_content = mock_client.messages.create.call_args[1]["messages"][0]["content"]
        assert "bedrooms: 3" in user_content
        assert "location: Lisbon" in user_content
        assert "tenanted: yes" in user_content


def test_headline_antihallucination_suppresses_invented_number() -> None:
    """
    FOLLOW-169 AC2: when the model returns a headline containing a specific number
    not present in the grounding sources, _generate_headline must return None
    (fact-check violation -> suppressed).

    Grounding sources: bedrooms=3 and city "Madrid" -- no yield figure.
    Model invents "7.2%" -> post-generation fact check catches it.
    """
    hallucinated_headline = "3-bed Madrid flat with 7.2% gross yield"
    original = "3-bed flat in Madrid"
    context: dict[str, Any] = {"bedrooms": 3, "location": {"city": "Madrid"}}

    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response(hallucinated_headline)

        result = _generate_headline(
            archetype="yield_hunter",
            original_description=original,
            listing_context=context,
            model=_DEFAULT_GENERATION_MODEL,
        )

    # "7.2" does not appear in the grounding text -> suppressed
    assert result is None


def test_headline_antihallucination_suppresses_invented_proper_name() -> None:
    """
    FOLLOW-169 AC2: a headline inventing a proper name absent from grounding
    sources is suppressed by _check_headline_facts.
    """
    original = "3-bed family home near a local primary school"
    context: dict[str, Any] = {"bedrooms": 3, "location": "Bristol"}

    # The model invents "Redland" -- a school name not present in the sources
    hallucinated_headline = "Ideal family home near Redland Primary School in Bristol"

    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response(hallucinated_headline)

        result = _generate_headline(
            archetype="family_buyer",
            original_description=original,
            listing_context=context,
            model=_DEFAULT_GENERATION_MODEL,
        )

    # "Redland" does not appear in the grounding text -> suppressed
    assert result is None


def test_headline_grounded_number_passes_fact_check() -> None:
    """
    FOLLOW-169 AC2: a headline containing a number that IS present in listing_context
    must NOT be suppressed (grounded fact passes through).
    """
    original = "3-bed property with sitting tenant in central area."
    context: dict[str, Any] = {"bedrooms": 3, "location": "Madrid", "yield_pct": 6.2}

    # "3-bed" is grounded (bedrooms: 3 is in listing_context and original)
    grounded_headline = "3-bed Madrid investment property with sitting tenant"

    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = _make_headline_response(grounded_headline)

        result = _generate_headline(
            archetype="yield_hunter",
            original_description=original,
            listing_context=context,
            model=_DEFAULT_GENERATION_MODEL,
        )

    # "3" appears in listing_context (bedrooms: 3) and original -> passes
    assert result is not None
    assert "3-bed" in result


def test_check_headline_facts_digit_absent_returns_violation() -> None:
    """
    _check_headline_facts returns 'hallucinated_number' when the headline contains
    a digit string absent from the grounding sources.
    """
    violation = _check_headline_facts(
        headline="3-bed flat with 7.2% gross yield",
        original_description="3-bed flat in Madrid",
        listing_context={"bedrooms": 3},
    )
    # "7.2" is not in the grounding sources
    assert violation == "hallucinated_number"


def test_check_headline_facts_digit_present_passes() -> None:
    """
    _check_headline_facts returns None when all digits in the headline are
    present in the grounding sources.
    """
    violation = _check_headline_facts(
        headline="3-bed investment flat in Madrid",
        original_description="3-bed flat in Madrid",
        listing_context={"bedrooms": 3},
    )
    # "3" is in both the original description and listing_context -> passes
    assert violation is None


def test_check_headline_facts_proper_name_absent_returns_violation() -> None:
    """
    _check_headline_facts returns 'hallucinated_proper_name' when the headline
    contains a capitalised word (mid-headline) absent from the grounding sources.
    """
    violation = _check_headline_facts(
        headline="Ideal family home near Redland Primary School",
        original_description="3-bed family home near a local primary school",
        listing_context={"bedrooms": 3, "location": "Bristol"},
    )
    # "Redland" is not in the grounding text
    assert violation == "hallucinated_proper_name"


def test_check_headline_facts_proper_name_present_passes() -> None:
    """
    _check_headline_facts returns None when capitalised words in the headline
    are present in the grounding sources.
    """
    violation = _check_headline_facts(
        headline="Prime investment in Lisbon Old Town",
        original_description="3-bed flat in Lisbon Old Town with great views",
        listing_context={"bedrooms": 3, "location": "Lisbon Old Town"},
    )
    # "Lisbon", "Old", "Town" all appear in the grounding text -> passes
    assert violation is None


def test_headline_antihallucination_no_redis_write_on_violation(
    mock_redis_post: MagicMock,
) -> None:
    """
    FOLLOW-169 AC2 end-to-end: when the headline fact-check fires, the description
    is still written to Redis but headline is null -- the hallucinated headline must
    never reach the Redis cache entry.
    """
    description_body = "Body. <verified_facts_used>\n[]\n</verified_facts_used>"
    desc_resp = MagicMock(content=[MagicMock(text=description_body)], stop_reason="end_turn")
    # Headline model invents a yield figure not in the listing data
    hallucinated_hl = "3-bed Madrid flat with 7.2% gross yield"
    hl_resp = _make_headline_response(hallucinated_hl)

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.side_effect = [desc_resp, hl_resp]

        _run_job(
            _make_event(
                original_description="3-bed flat in Madrid",
                listing_context={"bedrooms": 3, "location": "Madrid"},
            )
        )

        # Description must still be written; headline must be null
        mock_httpx.assert_called_once()
        value = json.loads(mock_httpx.call_args[1]["json"][0][2])
        assert "text" in value
        assert value.get("headline") is None


# ---------------------------------------------------------------------------
# FOLLOW-272: tightened _check_headline_facts — digit-boundary + first-word
# proper-name detection.  These are the "red-then-green" precision cases that
# were false-negatives under the previous bare-substring implementation.
# ---------------------------------------------------------------------------


def test_check_headline_facts_digit_coincidence_prevented() -> None:
    """
    FOLLOW-272 AC2: "$1,500" in the headline must NOT pass the fact check when
    the grounding only contains "$1,200".  The old bare-substring check would
    pass a hallucinated "$1,500" because "1" (or even "1,") appears inside "1,200".
    The tightened numeric-boundary check requires the exact token "1,500" to be
    present as a complete numeric unit — which it is not.
    """
    violation = _check_headline_facts(
        headline="Luxury flat at $1,500/mo — stunning views",
        original_description="Luxury flat available for $1,200 per month with stunning views.",
        listing_context={"rent_pcm": 1200, "currency": "USD"},
    )
    # "$1,500" token ("1,500/m" extracted by digit regex) is NOT in grounding
    # (grounding has "1,200" — a different price).
    assert violation == "hallucinated_number"


def test_check_headline_facts_exact_price_passes() -> None:
    """
    FOLLOW-272 AC2 (green side): a price token that IS present as a complete numeric
    unit in the grounding DOES pass the check.  "1,200" in the headline is grounded
    in the original_description which literally contains "1,200".  The tightened
    numeric-boundary pattern (?<![0-9.,])1,200(?![0-9.,]) still finds the match.

    Note: the digit regex extracts a token up to the first non-digit-class character.
    Using "1,200 per month" (space-terminated) ensures the extracted token "1,200"
    matches exactly in the grounding which also contains "1,200 per month".
    """
    violation = _check_headline_facts(
        headline="Luxury flat priced at 1,200 per month — stunning views",
        original_description="Luxury flat available for 1,200 per month with stunning views.",
        listing_context={"rent_pcm": 1200, "currency": "USD"},
    )
    # Token "1,200" is present as a complete numeric unit in the original_description
    assert violation is None


def test_check_headline_facts_proper_name_first_word_caught() -> None:
    """
    FOLLOW-272 AC3: a hallucinated proper name AS THE FIRST WORD of the headline
    must be caught.  Previously words[1:] skipped words[0], so "Reston Heights…"
    escaped detection.  The tightened scan covers all words.
    """
    violation = _check_headline_facts(
        headline="Reston Heights is a great family buy",
        original_description="3-bed detached house in a quiet residential area",
        listing_context={"bedrooms": 3, "location": "Bristol"},
    )
    # "Reston" is not in the grounding text at all — must be caught now
    assert violation == "hallucinated_proper_name"


def test_check_headline_facts_first_word_grounded_proper_name_passes() -> None:
    """
    FOLLOW-272 AC3 (green side): a first-word proper name that IS in the grounding
    must NOT be suppressed.
    """
    violation = _check_headline_facts(
        headline="Bristol family home with 3 bedrooms",
        original_description="3-bed detached house in Bristol — a great area.",
        listing_context={"bedrooms": 3, "location": "Bristol"},
    )
    # "Bristol" IS in both the original description and listing_context
    assert violation is None


def test_check_headline_facts_proper_name_escape_via_substring_prevented() -> None:
    """
    FOLLOW-272 AC3: the bare-substring check admitted a false negative where a
    fact fragment like "est" (a grounded substring of "Bristol") would "verify"
    an unrelated proper name "Reston" (because "est" in "bristol" is True).
    The word-boundary match prevents this: re.search(r'\\bReston\\b', grounding)
    correctly returns no match.
    """
    # grounding contains "Bristol" (which contains "est" but not "Reston")
    violation = _check_headline_facts(
        headline="Ideal family home near Reston Primary",
        original_description="3-bed family home near Bristol Primary school",
        listing_context={"bedrooms": 3, "location": "Bristol"},
    )
    # "Reston" is not a word-boundary match in "Bristol" grounding — must flag
    assert violation == "hallucinated_proper_name"


def test_check_headline_facts_hyphenated_bed_count_passes() -> None:
    """
    FOLLOW-272 AC4: "3-bed" in the headline DOES pass when "3" is in the grounding.
    Word-boundary / numeric-boundary matching must not over-suppress hyphenated
    compound tokens like "3-bed" where the digit is grounded.
    """
    violation = _check_headline_facts(
        headline="3-bed corner unit in a quiet street",
        original_description="3-bed property on a quiet corner street.",
        listing_context={"bedrooms": 3},
    )
    # "3" token is grounded in both original_description and listing_context
    assert violation is None


# ---------------------------------------------------------------------------
# FOLLOW-460: _write_to_postgres_cache — the Modal job's only path to the
# durable Postgres description_cache_persistent table (via the control-plane's
# internal HTTP callback; Modal functions have no direct DB connection).
# ---------------------------------------------------------------------------


def test_write_to_postgres_cache_posts_correct_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When configured, _write_to_postgres_cache POSTs the exact fields the internal
    endpoint expects (see apps/control-plane .../api/internal/description-cache),
    with the shared-secret Bearer token and JSON content type."""
    monkeypatch.setenv("DESCRIPTION_CACHE_API_BASE_URL", "https://admin.estalara.test")
    monkeypatch.setenv("DESCRIPTION_CACHE_INTERNAL_SECRET", "test-shared-secret")

    with patch("httpx.post") as mock_httpx:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp

        _write_to_postgres_cache(
            tenant_id="tenant-abc",
            listing_id="listing-123",
            archetype="yield_hunter",
            locale="en",
            description="A great income property.",
            headline="Strong yield play",
            model="claude-sonnet-4-6",
        )

        mock_httpx.assert_called_once()
        url_arg = mock_httpx.call_args[0][0]
        assert url_arg == "https://admin.estalara.test/api/internal/description-cache"

        call_kwargs = mock_httpx.call_args[1]
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-shared-secret"
        assert call_kwargs["headers"]["Content-Type"] == "application/json"

        body = call_kwargs["json"]
        assert body == {
            "tenant_id": "tenant-abc",
            "listing_id": "listing-123",
            "archetype": "yield_hunter",
            "locale": "en",
            "description": "A great income property.",
            "headline": "Strong yield play",
            "model": "claude-sonnet-4-6",
            "verified_facts_used": [],
        }


def test_write_to_postgres_cache_forwards_verified_facts_used(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FOLLOW-463 / audit F-17: when verified_facts is passed, it is forwarded
    verbatim as `verified_facts_used` so the internal endpoint can persist the
    ClickHouse `description_generations` anti-hallucination audit trail."""
    monkeypatch.setenv("DESCRIPTION_CACHE_API_BASE_URL", "https://admin.estalara.test")
    monkeypatch.setenv("DESCRIPTION_CACHE_INTERNAL_SECRET", "test-shared-secret")

    with patch("httpx.post") as mock_httpx:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp

        _write_to_postgres_cache(
            tenant_id="tenant-abc",
            listing_id="listing-123",
            archetype="yield_hunter",
            locale="en",
            description="A great income property.",
            headline="Strong yield play",
            model="claude-sonnet-4-6",
            verified_facts=["bedrooms: 3", "location: Marbella"],
        )

        body = mock_httpx.call_args[1]["json"]
        assert body["verified_facts_used"] == ["bedrooms: 3", "location: Marbella"]


def test_write_to_postgres_cache_headline_none_forwarded_as_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A None headline is forwarded as JSON null (not omitted) — the internal
    endpoint's Zod schema accepts null."""
    monkeypatch.setenv("DESCRIPTION_CACHE_API_BASE_URL", "https://admin.estalara.test")
    monkeypatch.setenv("DESCRIPTION_CACHE_INTERNAL_SECRET", "test-shared-secret")

    with patch("httpx.post") as mock_httpx:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_httpx.return_value = mock_resp

        _write_to_postgres_cache(
            tenant_id="tenant-abc",
            listing_id="listing-123",
            archetype="yield_hunter",
            locale="en",
            description="A great income property.",
            headline=None,
            model="claude-sonnet-4-6",
        )

        body = mock_httpx.call_args[1]["json"]
        assert body["headline"] is None


def test_write_to_postgres_cache_skipped_when_config_missing() -> None:
    """When DESCRIPTION_CACHE_API_BASE_URL / _INTERNAL_SECRET are unset (dev/CI),
    the function is a no-op — no httpx call, no exception."""
    with patch("httpx.post") as mock_httpx:
        _write_to_postgres_cache(
            tenant_id="tenant-abc",
            listing_id="listing-123",
            archetype="yield_hunter",
            locale="en",
            description="A great income property.",
            headline=None,
            model="claude-sonnet-4-6",
        )
        mock_httpx.assert_not_called()


def test_write_to_postgres_cache_failure_is_non_fatal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A non-2xx response (or network error) from the internal endpoint must not
    raise — the Redis write already completed and is the source of truth for
    this attempt; the read-path backfill is the second chance."""
    monkeypatch.setenv("DESCRIPTION_CACHE_API_BASE_URL", "https://admin.estalara.test")
    monkeypatch.setenv("DESCRIPTION_CACHE_INTERNAL_SECRET", "test-shared-secret")

    with patch("httpx.post") as mock_httpx:
        mock_httpx.side_effect = httpx.ConnectError("connection refused")

        # Must not raise.
        _write_to_postgres_cache(
            tenant_id="tenant-abc",
            listing_id="listing-123",
            archetype="yield_hunter",
            locale="en",
            description="A great income property.",
            headline=None,
            model="claude-sonnet-4-6",
        )


def test_generate_description_job_writes_both_redis_and_postgres(
    mock_sonnet: MagicMock, mock_redis_post: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end (FOLLOW-460 AC1): a successful generation writes to Redis (no
    TTL) AND POSTs to the Postgres internal endpoint, in that order, with the
    same description/headline/model."""
    monkeypatch.setenv("DESCRIPTION_CACHE_API_BASE_URL", "https://admin.estalara.test")
    monkeypatch.setenv("DESCRIPTION_CACHE_INTERNAL_SECRET", "test-shared-secret")

    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event())

        # Two httpx.post calls: [0] Redis SET, [1] Postgres internal endpoint POST.
        assert mock_httpx.call_count == 2

        redis_call = mock_httpx.call_args_list[0]
        assert "/pipeline" in redis_call[0][0]
        redis_cmd = redis_call[1]["json"][0]
        assert len(redis_cmd) == 3, "Redis SET must carry no TTL/EX args"

        pg_call = mock_httpx.call_args_list[1]
        assert pg_call[0][0] == "https://admin.estalara.test/api/internal/description-cache"
        pg_body = pg_call[1]["json"]
        assert pg_body["tenant_id"] == "tenant-abc"
        assert pg_body["listing_id"] == "listing-123"
        assert pg_body["archetype"] == "yield_hunter"
        assert pg_body["locale"] == "en"
        # The same description text and verified_facts_used reached both sinks.
        redis_value = json.loads(redis_cmd[2])
        assert pg_body["description"] == redis_value["text"]
        assert pg_body["verified_facts_used"] == redis_value["verified_facts_used"]


def test_postgres_write_skipped_does_not_block_redis_write(
    mock_sonnet: MagicMock, mock_redis_post: MagicMock
) -> None:
    """When Postgres config is absent, the Redis write still completes normally
    (durability regresses to the pre-FOLLOW-460 read-path backfill, but nothing
    crashes and the hot-path cache is unaffected)."""
    with (
        patch("anthropic.Anthropic") as mock_anthropic_cls,
        patch("httpx.post", return_value=mock_redis_post) as mock_httpx,
    ):
        mock_client = MagicMock()
        mock_anthropic_cls.return_value = mock_client
        mock_client.messages.create.return_value = mock_sonnet

        _run_job(_make_event())

        # Only the Redis call happens — Postgres write is skipped (missing config).
        mock_httpx.assert_called_once()
